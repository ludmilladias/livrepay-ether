---
name: livrepay-evidencia-tres-niveis
description: Ao relatar estado do LivrePay, sempre separar validado em produção real x coberto só por mock x nunca exercitado.
metadata:
  type: feedback
---

Em qualquer inventário, auditoria ou release readiness do LivrePay, classificar cada item em
três níveis: (a) validado contra a Ether de produção; (b) coberto só por teste com mock/local;
(c) implementado e nunca exercitado. Nunca colapsar (a) e (b) em "testado".

**Why:** em 2026-10-02 um bug que derrubaria **toda** chamada à Ether em produção (falta de
header `User-Agent`, bloqueado pelo WAF deles) passou despercebido porque a única cobertura era
`npm run test:ether`, com `fetch` mockado. A usuária (dona do produto) pediu explicitamente essa
distinção como ponto central do levantamento.

**How to apply:** vale também para "o teste real passou" — se o 201 veio de um script avulso e
não da rota HTTP/UI que o usuário usa, isso é nível (c) para a rota. Ver
[[ether-subconta-bloqueio]].
