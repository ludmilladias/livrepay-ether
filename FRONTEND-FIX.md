# 🔧 Como corrigir o frontend em produção

## Problema identificado

O frontend deployado em `https://livrepay.digital` está configurado para chamar `http://localhost:8081` em vez de `https://api.livrepay.digital`. Por isso, todas as chamadas de API falham e você vê dados fictícios ou vazios.

## Solução 1: Configurar variáveis de ambiente no App Platform (recomendado)

1. Acesse o painel da DigitalOcean → Apps → `walrus-app` (ou o nome do app do frontend)
2. Vá em **Settings** → **Environment Variables**
3. Adicione a variável:
   - **Key**: `VITE_API_URL`
   - **Value**: `https://api.livrepay.digital`
   - **Scope**: Build e Runtime
4. Clique em **Save** e **Redeploy** o app

⚠️ **Importante**: Variáveis `VITE_*` são injetadas **no build time**, não em runtime. Você precisa fazer **redeploy** completo após mudar.

## Solução 2: Usar arquivo .env.production no repositório

Se você prefere versionar a configuração de produção (sem segredos):

1. Commit o arquivo `.env.production` que acabei de criar:
   ```bash
   git add .env.production
   git commit -m "fix: configurar API de produção no frontend"
   git push
   ```

2. Configure o App Platform para usar este arquivo no build:
   - **Build Command**: `npm run build` (já está correto)
   - O Vite automaticamente carrega `.env.production` quando `NODE_ENV=production`

3. Redeploy o app

## Verificação

Após o redeploy, abra o DevTools (F12) na tela de Dashboard:

1. **Network tab** → recarregue a página
2. Procure por requisições a `/accounts/balance`
3. Deve aparecer `https://api.livrepay.digital/accounts/balance` (não `localhost`)
4. A resposta deve ser `{"balance_cents": 0}` para conta nova

Se ainda mostrar localhost, o cache do navegador pode estar servindo o bundle antigo — force reload (Ctrl+Shift+R).

## Estado esperado após correção

✅ Saldo real: R$ 0,00 (conta nova)  
✅ Alertas e transações: arrays vazios (conta sem movimentação)  
✅ Dashboard renderizando dados da API, não mock  

## Estado atual (antes da correção)

❌ Frontend chama `http://localhost:8081` → falha de rede → nenhum dado renderizado  
❌ Ou mostra dados em cache/fallback de build anterior  

---

**Próximo passo**: Execute uma das soluções acima e me avise para validar que o frontend está buscando dados reais.
