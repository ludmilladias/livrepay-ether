---
name: reference-livrepay-source-docs
description: Onde vive a verdade sobre segurança, pendências e infraestrutura do LivrePay fora do .claude/
metadata:
  type: reference
---

Fontes autoritativas na raiz do projeto (não em `.claude/`):

- `SECURITY.md` — modelo de segurança real: camadas front/API/Postgres, RLS deny-by-default, ledger append-only, barreira `provider_*` restrita a `service_role` (testes T14/T26), webhook sem HMAC, checklist de produção, alerta de log `FALHA CRÍTICA`.
- `PENDING.md` — snapshot verificado do estado do código (última datação lida: 2026-08-11): bloqueio `AUTH_KEY_001` na Ether (conta não `active`), módulos com dado fictício, itens abertos de segurança e infraestrutura.
- `ESTIMATIVA-INFRAESTRUTURA.md` — plano de produção referenciado por `PENDING.md`.

Contagens de testes divergem entre os dois arquivos (e2e: 37 em SECURITY.md vs 48 em PENDING.md) — confirme rodando `npm run db:test` / `server/tests/e2e.sh` antes de citar número.
