import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { pool } from "./db.js";
import { errorHandler } from "./middleware.js";
import { authRouter } from "./routes/auth.js";
import { chargesRouter } from "./routes/charges.js";
import { paymentsRouter } from "./routes/payments.js";
import { receivableContractsRouter, receivablesRouter } from "./routes/receivables.js";
import { coreRouter } from "./routes/core.js";
import { webhookRouter } from "./routes/webhook.js";
import { adminRouter } from "./routes/admin.js";

const app = express();

// Atrás do nginx: confia no primeiro proxy para obter o IP real (rate limit).
app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      // Sem Origin = chamada servidor-a-servidor (curl, webhook): liberada.
      if (!origin) return callback(null, true);
      if (config.allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Origem não permitida pelo CORS"));
    },
    credentials: true,
  }),
);

// Limite de corpo: bloqueia payload gigante como vetor de DoS.
app.use(express.json({ limit: "100kb" }));

// Teto global por IP; as rotas de login têm limite próprio, mais rígido.
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.get("/health", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "degraded", database: "unreachable" });
  }
});

app.use("/auth", authRouter);
app.use("/charges", chargesRouter);
app.use("/payments", paymentsRouter);
app.use("/receivable-contracts", receivableContractsRouter);
app.use("/receivables", receivablesRouter);
app.use("/webhooks", webhookRouter);
app.use("/admin", adminRouter);
app.use("/", coreRouter);

app.use((_req, res) => res.status(404).json({ error: "Rota não encontrada" }));
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`LIVREPAY API ouvindo na porta ${config.port}`);
});

// Encerramento limpo: para de aceitar conexões e fecha o pool antes de sair,
// evitando transação abortada no meio de um pagamento.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`${signal} recebido, encerrando...`);
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
