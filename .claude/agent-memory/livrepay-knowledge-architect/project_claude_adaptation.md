---
name: project-claude-adaptation
description: Estado da adaptação do framework .claude/ genérico para o domínio fintech LivrePay (diagnóstico de 2026-08-20) e lacunas de conhecimento conhecidas
metadata:
  type: project
---

O `.claude/` do LivrePay foi adaptado de um framework genérico (origem GAF/Gennie) em 2026-08-20. Diagnóstico de conhecimento nessa data encontrou: `CLAUDE.md` e `INSTALL.md` referenciados por `MANIFEST.md`, pelos 11 agentes ("fontes obrigatórias") e pelo hook `paf-pretool-guard.ps1`, mas **inexistentes na raiz**; nenhum Decision Ledger ou Knowledge Object real instanciado (só templates); `README.md` da raiz ainda é boilerplate Lovable/Vite, contradizendo a arquitetura real (Postgres puro + server/ + Ether).

**Why:** decisões duras do projeto (débito antes do provedor, não-estorno quando o PIX saiu, revoke de `provider_*` de `authenticated`, ausência de HMAC no webhook) vivem só em prosa em `SECURITY.md`/`PENDING.md`, sem ID, dono nem data de revisão — conhecimento não versionado tende a ser revertido por quem não leu.

**How to apply:** ao propor captura de conhecimento, priorize converter essas decisões em Decision Ledger antes de criar artefatos novos; e verifique se `CLAUDE.md` já existe antes de citá-lo como fonte. Ver [[reference-livrepay-source-docs]].
