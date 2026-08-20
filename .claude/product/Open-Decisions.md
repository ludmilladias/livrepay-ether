# Decisões Abertas

Os itens abaixo não devem ser preenchidos por suposição:

1. Provedor para emissão de boleto de cobrança a terceiros (Ether não emite, só paga).
2. Assinatura HMAC do webhook — depende de disponibilidade futura do suporte da Ether.
3. Migração do refresh token de `localStorage` para cookie `httpOnly`+`SameSite` e tratamento
   de CSRF associado.
4. Política final de retenção de dados após encerramento de conta (LGPD).
5. Limites finais de valor por transação, por dia e por tipo de operação (PIX, boleto, folha).
6. Política de KYC/onboarding além da verificação já feita pela Ether.
7. Provedor de hospedagem definitivo de produção.
8. Regras de detecção de fraude/anomalia além das validações de banco já implementadas.
9. Escopo de suporte a moeda além de BRL (cripto, multi-moeda).
10. Política de chargeback/estorno para casos não cobertos pelas regras atuais de pagamento.
11. Eventos analíticos e métricas oficiais do produto.
12. Plano de resposta formal a incidente de segurança além do descrito em SECURITY.md
    (comunicação a usuários, prazos internos).

Toda implementação dependente deve registrar a decisão requerida.
