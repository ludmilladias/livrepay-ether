// Teste do webhook da Ether: HMAC sobre o CORPO CRU, janela de timestamp e
// idempotência por (provider, event_id). Sem Postgres e sem Ether: `pool.connect`
// é um cliente falso que reproduz a UNIQUE (provider, event_id).
// Uso: node server/tests/webhook-signature.test.js
import crypto from "node:crypto";

process.env.ETHER_CLIENT_ID = "test-client";
process.env.ETHER_CLIENT_SECRET = "test-secret";
process.env.ETHER_BASE_URL = "https://ether.invalid";
process.env.ETHER_WEBHOOK_SECRET = "whsec-test-not-real";
process.env.ETHER_WEBHOOK_URL_TOKEN = "urltoken-test-not-real";
process.env.JWT_SECRET = "test-jwt-secret-not-real-0123456789";
process.env.PGUSER = "test";
process.env.PGPASSWORD = "test";

import express from "express";

const { pool } = await import("../src/db.js");
const { webhookRouter } = await import("../src/routes/webhook.js");
const { errorHandler, captureRawBody } = await import("../src/middleware.js");

const SECRET = process.env.ETHER_WEBHOOK_SECRET;
const URL_TOKEN = process.env.ETHER_WEBHOOK_URL_TOKEN;

// --- banco falso: UNIQUE (provider, event_id) -------------------------------
const seen = new Set();
let inserts = 0;
pool.connect = async () => ({
  query: async (sql, params) => {
    const q = String(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/i.test(q)) return { rows: [] };
    if (q.includes("insert into public.provider_events")) {
      const key = `ether:${params[0]}`;
      if (seen.has(key)) throw Object.assign(new Error("duplicate key"), { code: "23505" });
      seen.add(key);
      inserts++;
      return { rows: [{ id: inserts }] };
    }
    if (q.includes("update public.provider_events")) return { rows: [] };
    throw new Error(`query inesperada no teste: ${q.slice(0, 60)}`);
  },
  release: () => {},
});

const logs = [];
for (const m of ["log", "error", "warn"]) console[m] = (...a) => logs.push(a);
const out = (s) => process.stdout.write(s + "\n");

// Mesma configuração de parser do index.js.
const app = express();
app.use(express.json({ limit: "100kb", verify: captureRawBody }));
app.use("/webhooks", webhookRouter);
app.post("/outra-rota", (req, res) => res.json({ rawBodyRetido: req.rawBody !== undefined }));
app.use(errorHandler);
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;

let FAIL = 0;
const report = [];
function c(label, cond, detail) {
  report.push(`  ${cond ? "OK  " : "FALHA"} ${label}${!cond && detail ? " — " + detail : ""}`);
  if (!cond) FAIL++;
}

const now = () => Math.floor(Date.now() / 1000);
const sign = (ts, raw, secret = SECRET) =>
  crypto.createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
const sigHeader = (ts, raw, secret) => `t=${ts},v1=${sign(ts, raw, secret)}`;

async function post(path, raw, headers = {}, contentType = "application/json") {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": contentType, ...headers },
    body: raw,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

let n = 0;
const event = () => `evt-${++n}`;
// Corpo com espaçamento, ordem de chave e escape de unicode que JSON.stringify
// NÃO reproduz — exatamente o que um emissor real pode enviar.
const rawSpaced = (id) =>
  `{ "eventType" : "pix.created",\n  "id":"${id}", "data":{"data":{"descricao":"pagamento \\u00e7 \\u00e3o"}} }`;

// 1) Assinatura sobre os bytes recebidos confere.
let id = event();
let raw = rawSpaced(id);
let ts = now();
c("pré-condição: corpo cru difere do re-serializado", raw !== JSON.stringify(JSON.parse(raw)));
let r = await post("/webhooks/ether", raw, { "X-Signature": sigHeader(ts, raw) });
c("assinatura sobre o corpo CRU confere -> 200 ok", r.status === 200 && r.json.status === "ok", JSON.stringify(r));

// 2) Assinatura sobre o corpo re-serializado NÃO confere.
id = event();
raw = rawSpaced(id);
const reserialized = JSON.stringify(JSON.parse(raw));
r = await post("/webhooks/ether", raw, { "X-Signature": sigHeader(ts, reserialized) });
c("assinatura sobre o corpo RE-SERIALIZADO -> 401", r.status === 401 && r.json.error === "assinatura inválida", JSON.stringify(r));
c("evento rejeitado não foi gravado", !seen.has(`ether:${id}`));

// 3) Corpo compacto idêntico ao re-serializado também funciona (caso comum).
id = event();
raw = JSON.stringify({ id, eventType: "pix.created", data: { data: {} } });
r = await post("/webhooks/ether", raw, { "X-Signature": sigHeader(ts, raw) });
c("corpo compacto assinado -> 200", r.status === 200 && r.json.status === "ok", JSON.stringify(r));

// 4) Corpo adulterado após assinar, e segredo errado.
id = event();
raw = rawSpaced(id);
r = await post("/webhooks/ether", raw.replace("pagamento", "pagamentX"), { "X-Signature": sigHeader(ts, raw) });
c("corpo adulterado após assinar -> 401", r.status === 401, JSON.stringify(r));
r = await post("/webhooks/ether", raw, { "X-Signature": sigHeader(ts, raw, "outro-segredo") });
c("assinatura com segredo errado -> 401", r.status === 401, JSON.stringify(r));

// 5) Janela de timestamp.
id = event(); raw = rawSpaced(id);
r = await post("/webhooks/ether", raw, { "X-Signature": sigHeader(now() - 600, raw) });
c("timestamp 10 min no passado -> 401 expirada", r.status === 401 && r.json.error === "assinatura expirada", JSON.stringify(r));
r = await post("/webhooks/ether", raw, { "X-Signature": sigHeader(now() + 300, raw) });
c("timestamp 5 min NO FUTURO -> 401 expirada (antes passava por Math.abs)", r.status === 401 && r.json.error === "assinatura expirada", JSON.stringify(r));
r = await post("/webhooks/ether", raw, { "X-Signature": sigHeader(now() + 3600, raw) });
c("timestamp 1h no futuro -> 401", r.status === 401, JSON.stringify(r));
r = await post("/webhooks/ether", raw, { "X-Signature": sigHeader(now() + 30, raw) });
c("desvio de relógio pequeno (+30s) é tolerado -> 200", r.status === 200, JSON.stringify(r));
id = event(); raw = rawSpaced(id);
r = await post("/webhooks/ether", raw, { "X-Signature": sigHeader(now() - 200, raw) });
c("200s no passado (dentro de 5 min) -> 200", r.status === 200, JSON.stringify(r));
id = event(); raw = rawSpaced(id);
r = await post("/webhooks/ether", raw, { "X-Signature": `t=abc,v1=${sign("abc", raw)}` });
c("timestamp não numérico -> 401", r.status === 401, JSON.stringify(r));
r = await post("/webhooks/ether", raw, { "X-Signature": "lixo" });
c("cabeçalho malformado -> 401", r.status === 401, JSON.stringify(r));

// 6) Falha fechada sem corpo cru (Content-Type que o express.json não lê).
id = event(); raw = rawSpaced(id);
r = await post("/webhooks/ether", raw, { "X-Signature": sigHeader(now(), raw) }, "text/plain");
c("sem buffer cru (não-JSON) -> 401, nunca 500", r.status === 401, JSON.stringify(r));

// 7) Idempotência continua valendo: reentrega do mesmo evento assinado.
id = event(); raw = rawSpaced(id);
const before = inserts;
r = await post("/webhooks/ether", raw, { "X-Signature": sigHeader(now(), raw) });
const again = await post("/webhooks/ether", raw, { "X-Signature": sigHeader(now(), raw) });
c("reentrega do mesmo event_id -> 200 duplicate_ignored, 1 só gravação",
  r.json.status === "ok" && again.status === 200 && again.json.status === "duplicate_ignored" && inserts === before + 1,
  JSON.stringify({ r, again }));

// 8) Rota com token na URL e caminho legado por header.
id = event(); raw = rawSpaced(id);
r = await post(`/webhooks/ether/${URL_TOKEN}`, raw);
c("rota /ether/:token sem X-Signature -> 200", r.status === 200 && r.json.status === "ok", JSON.stringify(r));
id = event(); raw = rawSpaced(id);
r = await post(`/webhooks/ether/${URL_TOKEN}`, raw, { "X-Signature": sigHeader(now(), raw) });
c("rota /ether/:token com X-Signature válida sobre corpo cru -> 200", r.status === 200, JSON.stringify(r));
id = event(); raw = rawSpaced(id);
r = await post(`/webhooks/ether/${URL_TOKEN}`, raw, { "X-Signature": sigHeader(now(), JSON.stringify(JSON.parse(raw))) });
c("rota /ether/:token com X-Signature sobre re-serializado -> 401", r.status === 401, JSON.stringify(r));
r = await post("/webhooks/ether/token-errado", raw);
c("token de URL errado -> 401", r.status === 401, JSON.stringify(r));
id = event(); raw = rawSpaced(id);
r = await post("/webhooks/ether", raw, { "x-webhook-secret": SECRET });
c("legado x-webhook-secret correto -> 200", r.status === 200, JSON.stringify(r));
r = await post("/webhooks/ether", raw, { "x-webhook-secret": "errado" });
c("legado x-webhook-secret errado -> 401", r.status === 401, JSON.stringify(r));
r = await post("/webhooks/ether", raw);
c("sem nenhuma credencial -> 401", r.status === 401, JSON.stringify(r));

// 9) Outras rotas não retêm o buffer cru e o parser segue funcionando.
r = await post("/outra-rota", JSON.stringify({ a: 1 }));
c("fora de /webhooks o corpo cru não é retido", r.status === 200 && r.json.rawBodyRetido === false, JSON.stringify(r));

// 10) Segredo/assinatura nunca vão para log.
const logText = JSON.stringify(logs);
c("segredo e assinatura não aparecem em log", !logText.includes(SECRET) && !logText.includes(URL_TOKEN));

server.close();
out(report.join("\n"));
out(FAIL === 0 ? "\nTodos os testes passaram." : `\n${FAIL} falha(s).`);
process.exit(FAIL === 0 ? 0 : 1);
