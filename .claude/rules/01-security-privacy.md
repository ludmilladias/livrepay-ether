# Segurança e Privacidade

- Aplique autorização no banco (RLS), não só no backend — a API pode ter bug, o banco é a última
  linha.
- Verifique propriedade de conta, cobrança, pagamento e cartão via policy, nunca via `if` solto.
- Não exponha IDs previsíveis quando isso facilitar enumeração de conta.
- Não registre tokens, segredo de webhook, PAN/CVV, dado pessoal ou saldo em log.
- Use privilégio mínimo: role de aplicação não é dona das tabelas; funções que creditam saldo por
  confirmação de provedor só rodam com role de serviço.
- Bloqueie leitura e escrita de segredos (`JWT_SECRET`, credenciais Ether) fora do servidor.
- Trate corpo de webhook e upload como hostis; valide segredo em tempo constante.
