import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { ApiError, asyncRoute, requireAuth } from "../middleware.js";
import { sharedRateLimitStore } from "../rateLimitStore.js";
import { UPLOAD_DOCUMENT_TYPES } from "../ether.js";
import { etherErrorFields } from "../safeLog.js";

/**
 * POST /auth/onboarding/documents/:type — envia UM documento de KYC à Ether.
 *
 * Caminho mais sensível do sistema: trafega imagem de documento de identidade
 * e selfie. Decisões:
 *
 *  - Corpo BINÁRIO BRUTO (Content-Type: application/pdf | image/jpeg |
 *    image/png), tipo do documento no path. Sem multipart: o projeto não tem
 *    parser multipart (multer/busboy) e não se adicionou dependência só para
 *    isso. `express.raw` já acompanha o express, fica em memória (nunca em
 *    disco) e tem limite de tamanho nativo. Um arquivo por requisição por
 *    construção; não há campos de formulário (portanto nenhum `userId` no
 *    corpo é sequer lido).
 *  - O userId da Ether vem de profiles.ether_user_id do usuário do JWT.
 *  - O MIME declarado pelo cliente é hostil: conferido contra os magic bytes.
 *    O nome do arquivo do cliente nunca é lido; enviamos um nome gerado.
 *  - Nada do arquivo, do nome ou do corpo de erro da Ether vai para log.
 *  - Sem estado local: a fonte de verdade do que falta é o checklist da Ether
 *    (devolvido na resposta). Trilha: linha de log estruturada sem PII.
 *
 * As dependências (banco, Ether) são injetadas para o teste não precisar de
 * Postgres nem de rede.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // mesmo teto do ether.js
const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png"];
const EXTENSION = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

/** Detecta o tipo real pelos primeiros bytes. null se não for PDF/JPEG/PNG. */
export function sniffMime(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return "image/png";
  return null;
}

const typeParam = z.enum([...UPLOAD_DOCUMENT_TYPES]);

/** Converte falhas do body-parser (tamanho etc.) em ApiError, sem 500. */
function rawBody(req, res, next) {
  express.raw({ type: ALLOWED_MIME, limit: MAX_UPLOAD_BYTES })(req, res, (err) => {
    if (!err) return next();
    if (err.type === "entity.too.large") {
      return next(new ApiError(413, "Arquivo acima de 5MB", "FILE_TOO_LARGE"));
    }
    return next(new ApiError(400, "Corpo da requisição inválido", "INVALID_BODY"));
  });
}

export function createDocumentUploadRouter({ loadProfile, syncLocalStatus, ether }) {
  const router = Router();

  const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.userId, // roda após requireAuth
    message: { error: "Muitos envios. Tente novamente em alguns minutos." },
    store: sharedRateLimitStore("rl:kycdoc:"),
  });

  router.post(
    "/:type",
    requireAuth,
    uploadLimiter,
    asyncRoute(async (req, _res, next) => {
      // Tudo que não precisa do arquivo é decidido ANTES de aceitar bytes.
      const parsedType = typeParam.safeParse(req.params.type);
      if (!parsedType.success) {
        throw new ApiError(400, `Tipo de documento inválido. Aceitos: ${[...UPLOAD_DOCUMENT_TYPES].join(", ")}`, "VALIDATION_ERROR");
      }
      req.docType = parsedType.data;

      const profile = await loadProfile(req.userId);
      if (!profile?.ether_user_id) {
        throw new ApiError(409, "Faça o cadastro de abertura de conta antes de enviar documentos.", "ONBOARDING_REQUIRED");
      }
      if (profile.ether_account_status === "rejected" || profile.ether_account_status === "full") {
        throw new ApiError(409, "Esta conta não aceita mais documentos.", "ACCOUNT_NOT_PENDING");
      }
      req.etherProfile = profile;
      next();
    }),
    rawBody,
    asyncRoute(async (req, res) => {
      const { docType } = req;
      const profile = req.etherProfile;

      const buf = req.body;
      if (!Buffer.isBuffer(buf)) {
        throw new ApiError(415, "Envie o arquivo como corpo da requisição (Content-Type: PDF, JPEG ou PNG).", "UNSUPPORTED_MEDIA_TYPE");
      }
      if (buf.length === 0) throw new ApiError(400, "Arquivo vazio", "EMPTY_FILE");

      const declared = String(req.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const real = sniffMime(buf);
      if (!real || real !== declared) {
        throw new ApiError(415, "O conteúdo não corresponde a um PDF, JPEG ou PNG válido.", "UNSUPPORTED_MEDIA_TYPE");
      }

      // userId da Ether: SEMPRE do perfil do usuário autenticado.
      try {
        await ether.uploadDocument(profile.ether_user_id, docType, buf, {
          filename: `${docType.toLowerCase()}.${EXTENSION[real]}`,
          mimeType: real,
        });
      } catch (error) {
        console.error("Ether recusou o upload de documento", {
          userId: req.userId,
          type: docType,
          bytes: buf.length,
          ...etherErrorFields(error),
        });
        const rejected = error?.status === 400 || error?.status === 409 || error?.status === 422;
        throw new ApiError(
          rejected ? 422 : 502,
          rejected
            ? "O documento foi recusado. Verifique o arquivo e tente novamente."
            : "Não foi possível enviar o documento agora. Tente novamente em instantes.",
          rejected ? "DOCUMENT_REJECTED" : "PROVIDER_UNAVAILABLE",
        );
      }

      console.log("kyc_document_uploaded", { userId: req.userId, type: docType, bytes: buf.length });

      // Quanto falta: lido da Ether. Falha aqui não desfaz o envio.
      let status = profile.ether_account_status;
      let checklist = null;
      try {
        const current = await ether.getAccountStatus(profile.ether_user_id);
        if (current?.status) {
          status = current.status;
          await syncLocalStatus(req.userId, current.status, profile.ether_account_status);
        }
        checklist = current?.documentChecklist ?? null;
      } catch (error) {
        console.error("Falha ao reconsultar status após upload", { userId: req.userId, status: error?.status });
      }

      res.status(201).json({
        uploaded_type: docType,
        ether_user_id: profile.ether_user_id,
        status,
        pix_key: profile.ether_pix_key,
        pix_key_type: profile.ether_pix_key_type,
        checklist,
      });
    }),
  );

  return router;
}
