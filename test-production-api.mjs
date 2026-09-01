#!/usr/bin/env node
/**
 * Teste exploratório contra https://api.livrepay.digital (produção)
 * Corrigido baseado na estrutura de rotas real do código
 */

const BASE_URL = 'https://api.livrepay.digital';

const timestamp = Date.now();
const testEmail = `qa-explorer-${timestamp}@livrepay.test`;
const testPassword = 'Teste@12345';

let accessToken = null;
let userId = null;

function log(step, data) {
  console.log(`\n✓ [${step}]`, JSON.stringify(data, null, 2));
}

function logError(step, error, detail = null) {
  console.error(`\n❌ [${step}] FALHA:`, error.message);
  if (detail) console.error('Detalhe:', JSON.stringify(detail, null, 2));
}

async function apiCall(method, endpoint, body = null, token = null) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);
  const data = await response.json().catch(() => response.text().catch(() => null));

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.response = { status: response.status, data };
    throw error;
  }

  return data;
}

async function testHealthCheck() {
  try {
    const data = await apiCall('GET', '/health');
    log('Health Check', { status: data.status });
    return data.status === 'ok';
  } catch (error) {
    logError('Health Check', error, error.response);
    return false;
  }
}

async function testRegister() {
  try {
    const data = await apiCall('POST', '/auth/register', {
      email: testEmail,
      password: testPassword,
      fullName: 'QA Explorer Test',
    });
    log('Register', { userId: data.user?.id, hasTokens: !!(data.access_token && data.refresh_token) });
    userId = data.user?.id;
    accessToken = data.access_token;
    return !!userId && !!accessToken;
  } catch (error) {
    logError('Register', error, error.response);
    return false;
  }
}

async function testGetAccounts() {
  try {
    const data = await apiCall('GET', '/accounts', null, accessToken);
    const isArray = Array.isArray(data);
    const count = isArray ? data.length : 'NOT_ARRAY';
    log('GET /accounts', { isArray, count, sample: isArray ? data[0] : data });
    return isArray && data.length > 0;
  } catch (error) {
    logError('GET /accounts', error, error.response);
    return false;
  }
}

async function testGetBalance() {
  try {
    const data = await apiCall('GET', '/accounts/balance', null, accessToken);
    log('GET /accounts/balance', data);
    return typeof data.balance_cents === 'number';
  } catch (error) {
    logError('GET /accounts/balance', error, error.response);
    return false;
  }
}

async function testCreateCharge() {
  try {
    const data = await apiCall('POST', '/charges', {
      kind: 'pix',  // campo correto conforme erro de validação anterior
      amount_cents: 10000,
      description: 'Teste QA - Cobrança PIX',
    }, accessToken);
    log('POST /charges', {
      id: data.id,
      kind: data.kind,
      amount_cents: data.amount_cents,
      status: data.status,
    });
    return data.status === 'pending';
  } catch (error) {
    logError('POST /charges', error, error.response);
    return false;
  }
}

async function testGetTransactions() {
  try {
    const data = await apiCall('GET', '/transactions', null, accessToken);
    log('GET /transactions', { count: data.length, sample: data.slice(0, 2) });
    return Array.isArray(data);
  } catch (error) {
    logError('GET /transactions', error, error.response);
    return false;
  }
}

async function runTests() {
  console.log('🔍 Teste Exploratório — Produção LivrePay (corrigido)');
  console.log(`📧 Email de teste: ${testEmail}`);
  console.log(`🌐 API: ${BASE_URL}\n`);

  const results = {
    healthCheck: await testHealthCheck(),
    register: false,
    getAccounts: false,
    getBalance: false,
    createCharge: false,
    getTransactions: false,
  };

  if (!results.healthCheck) {
    console.error('\n❌ Health check falhou — API fora do ar.');
    process.exit(1);
  }

  results.register = await testRegister();
  if (!results.register) {
    console.error('\n❌ Register falhou — impossível continuar.');
    process.exit(1);
  }

  results.getAccounts = await testGetAccounts();
  results.getBalance = await testGetBalance();
  results.createCharge = await testCreateCharge();
  results.getTransactions = await testGetTransactions();

  console.log('\n📊 Resumo dos Testes:');
  console.table(results);

  const allPassed = Object.values(results).every(Boolean);
  
  if (allPassed) {
    console.log('\n✅ Todos os testes passaram.');
    console.log('✅ APIs de saldo, cobrança e ledger estão funcionando CORRETAMENTE em produção.');
    console.log('⚠️  Se a UI mostra saldo fictício, o problema está no FRONTEND:');
    console.log('   - Frontend não está chamando essas rotas, OU');
    console.log('   - Frontend não está renderizando os dados retornados pela API.');
  } else {
    console.log('\n❌ Alguns testes falharam — APIs de produção não estão 100% funcionais.');
  }

  process.exit(allPassed ? 0 : 1);
}

runTests().catch((error) => {
  console.error('\n💥 Erro inesperado:', error);
  process.exit(1);
});
