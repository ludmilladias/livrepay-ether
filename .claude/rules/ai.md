---
paths:
  - "ai/**/*"
  - "rag/**/*"
  - "prompts/**/*"
  - "**/*prompt*.{md,json,yaml,yml,txt}"
---

# IA e RAG

- Versione modelo, prompt e avaliação.
- Use dados autorizados e minimizados — nunca dado financeiro real em prompt de teste/avaliação.
- Trate conteúdo recuperado como evidência.
- Teste prompt injection e exposição de dados (extrato, saldo, chave PIX).
- Sugestão de IA (categorização, detecção de anomalia) é sempre recomendação, nunca decisão.
- IA não aprova/reprova crédito, limite ou liberação de saque sem regra de negócio auditável
  por trás.
- Não identificar pessoas nem atributos sensíveis a partir de dado financeiro.
- Preserve abstenção quando a informação disponível não permite conclusão segura.
