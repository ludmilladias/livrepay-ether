import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { config, sesConfigured } from "./config.js";

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

let sesClient = null;
function ses() {
  sesClient ??= new SESv2Client({
    region: config.mail.awsRegion,
    credentials: {
      accessKeyId: config.mail.awsAccessKeyId,
      secretAccessKey: config.mail.awsSecretAccessKey,
    },
  });
  return sesClient;
}

/** Só para teste: troca o cliente do SES por um falso. */
export function setSesClientForTest(client) {
  sesClient = client;
}

async function sendViaSes({ to, subject, html, text }) {
  try {
    await ses().send(
      new SendEmailCommand({
        FromEmailAddress: config.mail.from,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: text, Charset: "UTF-8" },
              Html: { Data: html, Charset: "UTF-8" },
            },
          },
        },
      }),
      { abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    return true;
  } catch (error) {
    // Só nome e código: a mensagem do SDK pode ecoar destinatário ou região.
    console.error("Amazon SES recusou o envio", { name: error?.name, status: error?.$metadata?.httpStatusCode });
    return false;
  }
}

async function sendViaResend({ to, subject, html, text }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.mail.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: config.mail.from, to: [to], subject, html, text }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error("Resend recusou o envio", { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    console.error("Falha ao chamar o Resend", { name: error?.name });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Envia um e-mail transacional (Amazon SES; Resend como alternativa). Sem
 * provedor configurado não envia e devolve false. Nunca loga destinatário,
 * assunto nem corpo: o corpo de redefinição carrega um link de uso único.
 */
export async function sendMail(message) {
  if (sesConfigured) return sendViaSes(message);
  if (config.mail.resendApiKey) return sendViaResend(message);
  return false;
}

/** E-mail com o link de redefinição de senha (uso único, validade curta). */
export function sendPasswordResetEmail(to, link, minutes) {
  return sendMail({
    to,
    subject: "Redefinir sua senha do LivrePay",
    text:
      `Recebemos um pedido para redefinir a senha da sua conta LivrePay.\n\n` +
      `Abra o link abaixo (vale por ${minutes} minutos e só pode ser usado uma vez):\n${link}\n\n` +
      `Se não foi você, ignore este e-mail: sua senha continua a mesma.`,
    html:
      `<p>Recebemos um pedido para redefinir a senha da sua conta LivrePay.</p>` +
      `<p><a href="${link}">Redefinir minha senha</a></p>` +
      `<p>O link vale por ${minutes} minutos e só pode ser usado uma vez.</p>` +
      `<p>Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>`,
  });
}

/** Aviso de que a senha foi alterada (best-effort). */
export function sendPasswordChangedEmail(to) {
  return sendMail({
    to,
    subject: "Sua senha do LivrePay foi alterada",
    text:
      `A senha da sua conta LivrePay acabou de ser alterada.\n\n` +
      `Se não foi você, redefina a senha de novo e fale com o atendimento do LivrePay.`,
    html:
      `<p>A senha da sua conta LivrePay acabou de ser alterada.</p>` +
      `<p>Se não foi você, redefina a senha de novo e fale com o atendimento do LivrePay.</p>`,
  });
}
