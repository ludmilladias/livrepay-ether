---
name: revisao-seguranca-onboarding-ether
description: Revisões de segurança do onboarding Ether/PII e do cadastro/frontend (2026-10-06, 2026-10-09 x2) — o que fechou e o que segue aberto
metadata:
  type: project
---

**2026-10-06** (onboarding Ether/PII + credenciais):
- Trigger `prevent_ether_field_tampering` — FECHADO (migration `20260906000000_fix_ether_tamper_trigger.sql`).
- Credenciais Ether em `nao-subir*` dentro do OneDrive; rotação do clientSecret e senha admin pendentes.
- Segredo de webhook ainda não entregue pela Ether (guard rejeita tudo: inoperante, não inseguro).

**2026-10-09, 2ª revisão (diff não commitado de hardening)** — FECHADOS com teste:
dummy hash 60 chars, lockout sem 423, DV CPF/CNPJ (front e back equivalentes, 4M vetores),
rate limit /auth/onboarding (5/h user+IP), token de webhook mascarado em log, /health sem err.message.
Seguem ABERTOS / novos:
- `safeNext` ainda devolve `//evil.com` para `/.//evil.com` e `/..//evil.com` (normalização do
  `new URL`). Hoje não explorável só porque Auth usa `navigate(..., {replace:true})` → replaceState
  lança SecurityError; com push (fallback `location.assign`) ou `location.replace` vira open redirect.
- Rate limit por IP 5/h com CGNAT (comum em móvel BR) e `trust proxy 1` (topologia de prod não verificada).
- Refresh: reuso não revoga a família; SECURITY.md continua afirmando que revoga.
- Rascunho em localStorage guarda razão social (MEI antigo = nome + CPF).
- Sem verificação de e-mail; /auth/register 409 enumera; sem gate KYC; CSP/HSTS do SPA fora do repo.
- CNPJ alfanumérico (RFB, desde jul/2026) rejeitado por ambos validadores — funcional, a confirmar com Ether.

**Why:** a usuária quer revisão independente antes do formulário público de cadastro PF/PJ.

**How to apply:** em revisões futuras, começar por [[SECURITY.md]] e checar os itens abertos acima
antes de relatar algo novo.
