import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNext } from "./safe-redirect.ts";

const ORIGIN = "https://app.livrepay.test";

test("rejeita open redirect (volta para /)", () => {
  for (const raw of [
    "/\\x", //          /\x
    "/\\/x", //         /\/x
    "/%5Cx", //         /%5Cx
    "/%5cx", //         minúsculo
    "//x", //           protocolo-relativo
    "https://x", //     absoluta
    "http://x/a",
    "javascript:alert(1)",
    "x", //             relativo sem barra
    "/\t/x", //         caractere de controle
    "/\n/x",
    "/.//x", //         segmentos de ponto normalizam para //x
    "/..//x",
    "/a/../..//x",
    "",
    null,
    undefined,
  ]) {
    assert.equal(safeNext(raw as string | null, ORIGIN), "/", `deveria rejeitar ${JSON.stringify(raw)}`);
  }
});

test("aceita caminho interno, preservando query e hash", () => {
  assert.equal(safeNext("/ok?a=1", ORIGIN), "/ok?a=1");
  assert.equal(safeNext("/cobranca/pix", ORIGIN), "/cobranca/pix");
  assert.equal(safeNext("/a/b?x=1&y=2#z", ORIGIN), "/a/b?x=1&y=2#z");
  assert.equal(safeNext("/", ORIGIN), "/");
});

test("não devolve /auth (evita laço)", () => {
  assert.equal(safeNext("/auth", ORIGIN), "/");
  assert.equal(safeNext("/auth?next=/x", ORIGIN), "/");
});
