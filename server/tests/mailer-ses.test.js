// Teste offline do envio por Amazon SES (cliente falso, sem rede).
// Uso: node server/tests/mailer-ses.test.js
process.env.JWT_SECRET = "test-jwt-secret-not-real-0123456789";
process.env.PGUSER = "test";
process.env.PGPASSWORD = "test";
process.env.AWS_SES_REGION = "us-east-1";
process.env.AWS_SES_ACCESS_KEY_ID = "AKIAFAKEFAKEFAKEFAKE";
process.env.AWS_SES_SECRET_ACCESS_KEY = "segredo-aws-de-teste";
process.env.RESEND_API_KEY = "re_nao_deve_ser_usada";
process.env.MAIL_FROM = "LivrePay <nao-responder@livrepay.digital>";

const { sendPasswordResetEmail, sendPasswordChangedEmail, setSesClientForTest } = await import("../src/mailer.js");

let FAIL = 0;
const check = (label, cond, detail) => {
  console.log(`  ${cond ? "OK  " : "FALHA"} ${label}${!cond && detail ? " — " + detail : ""}`);
  if (!cond) FAIL++;
};

const logs = [];
for (const m of ["error", "warn"]) console[m] = (...a) => logs.push(JSON.stringify(a));

// Resend não pode ser chamado quando o SES está configurado.
const realFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = async (...a) => { fetchCalls++; return realFetch(...a); };

const sent = [];
setSesClientForTest({ send: async (command) => { sent.push(command.input); return {}; } });

const ok = await sendPasswordResetEmail("ana@example.com", "https://app.teste.invalid/redefinir-senha#token=abc", 30);
check("envio pelo SES devolve true", ok === true);
check("destinatário e remetente corretos",
  sent[0]?.Destination?.ToAddresses?.[0] === "ana@example.com" && sent[0]?.FromEmailAddress === process.env.MAIL_FROM);
check("assunto, texto e HTML em UTF-8",
  /Redefinir/.test(sent[0]?.Content?.Simple?.Subject?.Data) &&
  sent[0]?.Content?.Simple?.Body?.Text?.Charset === "UTF-8" &&
  /#token=abc/.test(sent[0]?.Content?.Simple?.Body?.Html?.Data));
check("não usa o Resend quando o SES está configurado", fetchCalls === 0);

await sendPasswordChangedEmail("ana@example.com");
check("e-mail de senha alterada também sai pelo SES", sent.length === 2 && /alterada/.test(sent[1].Content.Simple.Subject.Data));

// Falha do SES: devolve false, loga só nome/status (sem destinatário, sem credencial).
setSesClientForTest({
  send: async () => {
    const e = new Error("Email address is not verified: ana@example.com");
    e.name = "MessageRejected";
    e.$metadata = { httpStatusCode: 400 };
    throw e;
  },
});
const failed = await sendPasswordResetEmail("ana@example.com", "https://x.invalid/#token=zzz", 30);
check("falha do SES devolve false (não estoura)", failed === false);
const logText = logs.join("\n");
check("log tem só nome e status do erro", /MessageRejected/.test(logText) && /400/.test(logText));
check("log não contém e-mail, token nem credenciais",
  !logText.includes("ana@example.com") && !logText.includes("zzz") &&
  !logText.includes("segredo-aws-de-teste") && !logText.includes("AKIAFAKE"));

globalThis.fetch = realFetch;
console.log(FAIL ? `\n${FAIL} falha(s)` : "\nTodos os testes passaram.");
process.exit(FAIL ? 1 : 0);
