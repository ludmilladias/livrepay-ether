import { Router } from "express";
import { z } from "zod";
import { withUser, withService } from "../db.js";
import { ApiError, asyncRoute, requireAuth, validate } from "../middleware.js";
import { etherErrorFields } from "../safeLog.js";
import { operationToken } from "../etherCredentials.js";
import {
  withdrawPixToKey,
  inferPixKeyType,
  payBoleto,
  simulateBoleto,
  getBoletoStatus,
  EtherError,
} from "../ether.js";

export const paymentsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
paymentsRouter.use(requireAuth);

const kindSchema = z.enum(["transferencia", "conta", "folha"]);
const keyTypeSchema = z.enum(["CPF", "CNPJ", "PHONE", "EMAIL", "RANDOM"]);
// PIX: transferência para uma chave. BOLETO: pagamento por linha digitável.
// Guardado em metadata.payment_method — não é coluna própria porque é uma
// característica de COMO o pagamento é executado, não do domínio do dado.
const methodSchema = z.enum(["PIX", "BOLETO"]);

const newPayment = z
  .object({
    kind: kindSchema,
    amount_cents: z.number().int().positive("Valor deve ser maior que zero"),
    payment_method: methodSchema.default("PIX"),
    recipient_name: z.string().trim().max(140).optional(),
    // Chave PIX (transferência) ou linha digitável (boleto) — mesma coluna,
    // texto livre nos dois casos; o formato é validado por método abaixo.
    recipient_key: z.string().trim().min(1, "Informe o destino do pagamento").max(200),
    pix_key_type: keyTypeSchema.optional(),
    scheduled_for: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.payment_method === "BOLETO") {
      // Linha digitável: 47 (boleto bancário) ou 48 (arrecadação) dígitos,
      // com ou sem os pontos/espaços de formatação visual.
      const digits = data.recipient_key.replace(/\D/g, "");
      if (digits.length !== 47 && digits.length !== 48) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recipient_key"],
          message: "Linha digitável inválida (esperado 47 ou 48 dígitos)",
        });
      }
    } else if (!data.recipient_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recipient_name"],
        message: "Informe o favorecido",
      });
    }
  });

paymentsRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const kind = kindSchema.safeParse(req.query.kind);
    if (!kind.success) throw new ApiError(400, "Parâmetro 'kind' inválido");

    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(
        `select * from public.payments
          where kind = $1 order by created_at desc limit 100`,
        [kind.data],
      );
      return result.rows;
    });

    res.json(rows);
  }),
);

paymentsRouter.post(
  "/",
  validate(newPayment),
  asyncRoute(async (req, res) => {
    const b = req.body;
    const payment = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(
        `insert into public.payments
           (user_id, kind, status, amount_cents, recipient_name, recipient_key,
            scheduled_for, metadata)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning *`,
        [
          req.userId,
          b.kind,
          b.scheduled_for ? "scheduled" : "draft",
          b.amount_cents,
          b.recipient_name ?? (b.payment_method === "BOLETO" ? "Boleto" : null),
          b.recipient_key,
          b.scheduled_for ?? null,
          {
            payment_method: b.payment_method,
            ...(b.pix_key_type ? { pix_key_type: b.pix_key_type } : {}),
          },
        ],
      );
      return rows[0];
    });

    res.status(201).json(payment);
  }),
);

paymentsRouter.patch(
  "/:id/cancel",
  asyncRoute(async (req, res) => {
    const payment = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(
        `update public.payments set status = 'cancelled'
          where id = $1 returning *`,
        [req.params.id],
      );
      return rows[0];
    });

    if (!payment) throw new ApiError(404, "Pagamento não encontrado ou já processado");
    res.json(payment);
  }),
);

/** Consulta o status de compensação do boleto no provedor (conciliação manual). */
paymentsRouter.get(
  "/:id/boleto-status",
  asyncRoute(async (req, res) => {
    if (!UUID_RE.test(String(req.params.id))) throw new ApiError(404, "Pagamento não encontrado");
    const payment = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(
        `select provider, provider_payment_id from public.payments where id = $1`,
        [req.params.id],
      );
      return rows[0];
    });

    if (!payment) throw new ApiError(404, "Pagamento não encontrado");
    if (payment.provider !== "ether" || !payment.provider_payment_id) {
      throw new ApiError(409, "Pagamento ainda não foi enviado ao provedor");
    }

    const token = await operationToken(req.userId);
    try {
      const status = await getBoletoStatus(payment.provider_payment_id, token);
      res.json(status);
    } catch (error) {
      console.error("Falha ao consultar status do boleto", { paymentId: req.params.id, ...etherErrorFields(error) });
      throw new ApiError(424, "Não foi possível consultar o status no banco parceiro.", "PROVIDER_UNAVAILABLE");
    }
  }),
);

/**
 * Executa o pagamento: debita o saldo e envia à Ether — PIX para uma chave
 * ou pagamento de boleto por linha digitável, conforme metadata.payment_method.
 *
 * Debitamos ANTES de acionar o provedor de propósito — o inverso permitiria
 * disparar vários pagamentos concorrentes com saldo para apenas um. O preço é
 * ter de estornar quando o provedor recusa, o que é feito logo abaixo.
 *
 * Exportada para um futuro executor de pagamentos agendados (`scheduled_for`),
 * que ainda não existe: mesma lógica, mesmo caminho de estorno, seja quem chamar.
 */
export async function executePaymentForUser(userId, paymentId) {
  // Propriedade ANTES do token: id de outro dono e id inexistente têm de
  // responder IGUAL (404) — respostas diferentes vazariam existência, e um 403
  // de "conta não habilitada" antes disso esconderia um furo de RLS. A checagem é a RLS de
  // public.payments ("usuário lê os próprios"), não um `if` sobre user_id.
  // UUID malformado vira 404 também (senão o Postgres responderia 22P02 -> 500).
  const idOk = typeof paymentId === "string" && UUID_RE.test(paymentId);
  const visible = idOk
    ? await withUser(userId, async (client) => {
        const { rows } = await client.query(`select id from public.payments where id = $1`, [paymentId]);
        return rows[0];
      })
    : null;
  if (!visible) throw new ApiError(404, "Pagamento não encontrado");

  // Token da conta de QUEM PAGA (operador admin da conta da casa, ou cliente com
  // credencial no cofre). Sem conta habilitada: 403 antes de qualquer débito.
  const token = await operationToken(userId);
  return executeWithToken(userId, paymentId, token);
}

async function executeWithToken(userId, paymentId, token) {
  const payment = await withUser(userId, async (client) => {
    const { rows } = await client.query(
      `select id, status, amount_cents, recipient_name, recipient_key, metadata
         from public.payments where id = $1`,
      [paymentId],
    );
    return rows[0];
  });

  if (!payment) throw new ApiError(404, "Pagamento não encontrado");
  if (payment.status !== "draft" && payment.status !== "scheduled") {
    throw new ApiError(409, `Pagamento com status ${payment.status} não pode ser executado`);
  }
  if (!payment.recipient_key) throw new ApiError(400, "Pagamento sem destino definido");

  const method = payment.metadata?.payment_method === "BOLETO" ? "BOLETO" : "PIX";

  let keyType = null;
  if (method === "PIX") {
    const declared = payment.metadata?.pix_key_type;
    keyType = keyTypeSchema.safeParse(declared).success ? declared : inferPixKeyType(payment.recipient_key);
    if (!keyType) {
      throw new ApiError(400, "Não foi possível determinar o tipo da chave PIX. Informe explicitamente.");
    }
  }

  // Boleto: a linha digitável não expõe o valor de forma confiável no
  // nosso lado — só a Ether sabe o valor real. Sem esta checagem,
  // debitaríamos o valor que o usuário digitou e pagaríamos à Ether o
  // valor real do boleto, que pode ser diferente (perda para o LivrePay
  // ou cobrança indevida do usuário). Verificar ANTES de debitar.
  if (method === "BOLETO") {
    let simulation;
    try {
      simulation = await simulateBoleto(payment.recipient_key, token);
    } catch (error) {
      console.error("Falha ao simular boleto antes do pagamento", {
        paymentId,
        ...etherErrorFields(error),
      });
      throw new ApiError(424, "Não foi possível confirmar o valor do boleto no banco parceiro.", "PROVIDER_REJECTED");
    }

    const realCents = Math.round(simulation.boleto.netAmount * 100);
    if (realCents !== payment.amount_cents) {
      throw new ApiError(
        409,
        `O valor real do boleto (R$ ${(realCents / 100).toFixed(2)}) diverge do valor ` +
          `informado (R$ ${(payment.amount_cents / 100).toFixed(2)}). Corrija o pagamento antes de executar.`,
      );
    }
  }

  // Passo 1: REIVINDICA, debita e trava em 'processing', numa só transação.
  // Roda como o usuário — a função valida saldo e propriedade. Se falhar aqui,
  // nada foi debitado.
  //
  // Duplo clique: execute_payment() devolve a linha SEM erro quando o pagamento
  // já está em 'processing', então duas requisições que leram 'draft' acima
  // seguiriam as duas para a Ether (2 envios, 1 débito). O advisory lock por
  // pagamento serializa as transações; a segunda relê o status depois do commit
  // da primeira e para em 409, antes de qualquer envio.
  const claimed = await withUser(userId, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [paymentId]);
    const { rows } = await client.query(`select status from public.payments where id = $1`, [paymentId]);
    const current = rows[0]?.status;
    if (current !== "draft" && current !== "scheduled") return false;
    await client.query("select public.execute_payment($1)", [paymentId]);
    return true;
  });
  if (!claimed) throw new ApiError(409, "Pagamento já está em processamento ou foi concluído");

  // Passo 2: daqui em diante o saldo JÁ saiu. Recusa explícita da Ether
  // estorna; resultado INCERTO (timeout, rede, 5xx) não — ver o catch.
  try {
    const result =
      method === "BOLETO"
        ? await payBoleto(payment.recipient_key, { paymentMethod: "FIAT", isSimulation: false }, token)
        : await withdrawPixToKey(
            payment.amount_cents,
            keyType,
            payment.recipient_key,
            payment.recipient_name ?? undefined,
            token,
          );

    // Formatos de resposta diferem por método: PIX confirma com pixId/e2e;
    // boleto confirma com success/boletoId. Normalizamos para o que a RPC
    // de conclusão espera (id de referência + status).
    const success = method === "BOLETO" ? result.success === true : true;
    if (!success) {
      // A Ether responde 200 com success:false em vez de status de erro
      // HTTP para boleto recusado — tratamos como falha do provedor mesmo
      // assim, para cair no mesmo caminho de estorno abaixo.
      throw new EtherError(200, result);
    }

    const providerRef = method === "BOLETO" ? result.boletoId : result.pixId;
    const providerStatus = method === "BOLETO" ? "PAID" : result.status;

    try {
      await withService(async (client) => {
        await client.query("select public.provider_complete_payment($1, $2, $3)", [
          paymentId,
          providerRef ?? null,
          providerStatus ?? null,
        ]);
      });
    } catch (error) {
      // O dinheiro SAIU de fato (PIX enviado / boleto pago). NÃO estornamos
      // — isso criaria dinheiro do nada. Fica em 'processing' para o
      // webhook ou conciliação manual (ver GET /:id/boleto-status) fechar.
      console.error("Pagamento enviado mas falhou ao concluir localmente", {
        paymentId,
        method,
        providerRef,
        error,
      });
      return {
        status: "processing",
        warning: "Pagamento enviado; confirmação pendente.",
      };
    }

    // A Ether cobra tarifa sobre o saque PIX (`feeAmount`, já em centavos —
    // mesma unidade enviada em `amount`). Sem lançar isso no ledger, o
    // saldo do LivrePay divergiria silenciosamente do saldo real na Ether
    // a cada transferência.
    if (method === "PIX" && Number.isInteger(result.feeAmount) && result.feeAmount > 0) {
      try {
        await withService(async (client) => {
          await client.query(
            `select public.provider_settle($1, 'debit', $2, $3, 'payments', $4, '{"fee":true}'::jsonb)`,
            [userId, result.feeAmount, "Tarifa PIX", paymentId],
          );
        });
      } catch (feeError) {
        // O PIX já saiu; não lançar a tarifa é um erro de conciliação, não
        // motivo para reverter o pagamento. Precisa de acerto manual.
        console.error("FALHA CRÍTICA: tarifa PIX não registrada no ledger", {
          paymentId,
          feeAmount: result.feeAmount,
          feeError,
        });
      }
    }

    return {
      status: "completed",
      payment_id: paymentId,
      ...(method === "PIX" ? { e2e: result.e2e, fee_cents: result.feeAmount } : { boleto_id: result.boletoId }),
    };
  } catch (error) {
    // Resultado INCERTO: nosso timeout (EtherError 504), erro de rede (não é
    // EtherError) ou 5xx da Ether. A Ether pode ter processado — o saque PIX não
    // tem chave de idempotência — e estornar aqui criaria dinheiro do nada se o
    // valor saiu. Fica em 'processing' (debitado) para conciliar com o extrato.
    const uncertain = !(error instanceof EtherError) || error.status >= 500;
    if (uncertain) {
      console.error("PAGAMENTO INCERTO: sem resposta conclusiva da Ether — conciliar antes de estornar", {
        paymentId,
        method,
        ...etherErrorFields(error),
      });
      return {
        status: "processing",
        warning: "Sem confirmação do banco parceiro. O pagamento será conferido antes de qualquer estorno.",
      };
    }

    console.error("Provedor recusou o pagamento — estornando", {
      paymentId,
      method,
      ...etherErrorFields(error),
    });

    try {
      await withService(async (client) => {
        await client.query("select public.provider_fail_payment($1, $2)", [
          paymentId,
          method === "BOLETO" ? "Provedor recusou o pagamento do boleto" : "Provedor recusou a transferência",
        ]);
      });
    } catch (refundError) {
      // Pior caso: debitado, não enviado e não estornado. Precisa de
      // intervenção humana — monitore este termo nos logs.
      console.error("FALHA CRÍTICA: pagamento debitado sem envio nem estorno", {
        paymentId,
        refundError,
      });
      throw new ApiError(500, "Falha ao processar. O suporte foi acionado para regularizar o saldo.");
    }

    // 424 e não 502: a borda da DigitalOcean troca 502/503/504 por uma página genérica.
    throw new ApiError(424, "O banco parceiro recusou o pagamento. Valor estornado.", "PROVIDER_REJECTED");
  }
}

paymentsRouter.post(
  "/:id/execute",
  asyncRoute(async (req, res) => {
    const result = await executePaymentForUser(req.userId, req.params.id);
    res.status(result.status === "processing" ? 202 : 200).json(result);
  }),
);
