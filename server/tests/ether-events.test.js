// Teste do normalizador de payload de eventos PIX da Ether (formato plano da
// spec e formato aninhado do guia). Dados sintéticos, sem rede nem banco.
//
// Uso: node server/tests/ether-events.test.js

import { normalizePixPayload } from "../src/etherEvents.js";

let FAIL = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  OK   ${label}`);
  else {
    console.log(`  FALHA ${label} — esperado ${e}, veio ${a}`);
    FAIL++;
  }
}

check(
  "formato plano (spec)",
  normalizePixPayload({ pixId: "p-1", uuid: "u-1", amount: 100, status: "CONFIRMED", e2e: "E1" }),
  { ids: ["p-1", "u-1"], amount: 100, status: "CONFIRMED", e2e: "E1" },
);

check(
  "formato aninhado (guia privatedocs)",
  normalizePixPayload({
    pix: { id: "p-2", uuid: "u-2", amount: 500, status: "CONFIRMED", e2e: "E2" },
    timestamp: "2026-01-01T00:00:00.000Z",
  }),
  { ids: ["p-2", "u-2"], amount: 500, status: "CONFIRMED", e2e: "E2" },
);

check(
  "ids repetidos são deduplicados",
  normalizePixPayload({ pix: { id: "x", uuid: "x", amount: 1 } }).ids,
  ["x"],
);

check(
  "payload vazio não inventa id nem valor",
  normalizePixPayload({}),
  { ids: [], amount: null, status: null, e2e: null },
);

check(
  "amount como string é rejeitado (null)",
  normalizePixPayload({ pixId: "p", amount: "100" }).amount,
  null,
);

check("payload undefined não estoura", normalizePixPayload(undefined).ids, []);

if (FAIL) {
  console.log(`\n${FAIL} falha(s)`);
  process.exit(1);
}
console.log("\nTodos os testes passaram");
