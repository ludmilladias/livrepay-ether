# Matriz de Guardrails

| Área | Permitido | Exige confirmação | Proibido |
|---|---|---|---|
| Código | Alterar em branch autorizada | Nova dependência | Push forçado |
| Produção | Analisar evidências | Deploy humano | Exclusão autônoma |
| Pagamento | Usar fixture/mock sintético | Chamada real à Ether com dinheiro real | Automatizar saque/pagamento real |
| Ledger | Consultar | Migração revisada | UPDATE/DELETE em `transactions` |
| IA | Gerar sugestão editável | Alterar política de risco/limite | Aprovar crédito/saque sozinha |
| Dados | Consulta local/teste | Migração revisada | DROP/TRUNCATE autônomo |
| Conformidade | Recomendar classificação de risco | Bloqueio de conta revisado | Bloqueio irrevogável autônomo |
| Configuração | Ler | Alterar GAF/settings | Enfraquecer Constituição |
