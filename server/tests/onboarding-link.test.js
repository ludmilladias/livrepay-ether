// Teste da lógica de vínculo/reconciliação de conta Ether — offline, sem
// Postgres nem Ether (dependências injetadas), mesmo espírito dos demais
// arquivos em server/tests/. Cobre o que onboarding-schema.test.js NÃO cobre:
// ordem de gravação dos campos ether_*, 409 de vínculo duplicado, 503 de
// conta órfã e convergência no reenvio, e a reconciliação de status.
// Uso: node server/tests/onboarding-link.test.js
process.env.ETHER_CLIENT_ID = "test-client";
process.env.ETHER_CLIENT_SECRET = "test-secret";
process.env.ETHER_BASE_URL = "https://ether.invalid";
process.env.JWT_SECRET = "test-jwt-secret-not-real-0123456789";
process.env.PGUSER = "test";
process.env.PGPASSWORD = "test";

const { createAndLinkEtherAccount, reconcileOnboardingStatus } = await import("../src/routes/auth.js");

let FAIL = 0;
function check(label, cond, detail) {
  console.log(`  ${cond ? "OK  " : "FALHA"} ${label}${!cond && detail ? " — " + detail : ""}`);
  if (!cond) FAIL++;
}

const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ETHER_ID = "ether-999";

function fakeClient(queries) {
  return { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; } };
}

function deps({ createUserProfile, acceptTerms, submitPepDeclaration, serviceQueries, serviceError }) {
  return {
    createUserProfile: createUserProfile ?? (async () => ({ userId: "ether-abc", status: "pending_documents" })),
    acceptTerms: acceptTerms ?? (async () => ({})),
    submitPepDeclaration: submitPepDeclaration ?? (async () => ({})),
    withService: async (fn) => {
      if (serviceError) throw serviceError;
      return fn(fakeClient(serviceQueries ?? []));
    },
  };
}

const base = { userId: USER_ID, payload: { any: "payload" }, taxId: "12345678900", phone: "11999999999", userAgent: "jest-ua" };

// --- caminho feliz -----------------------------------------------------------
{
  const serviceQueries = [];
  const callOrder = [];
  const d = deps({
    createUserProfile: async () => { callOrder.push("createUserProfile"); return { userId: "ether-abc", status: "pending_documents", documentChecklist: { pending: ["SELFIE_COM_DOC"] } }; },
    acceptTerms: async () => { callOrder.push("acceptTerms"); },
    submitPepDeclaration: async () => { callOrder.push("submitPepDeclaration"); },
    serviceQueries,
  });
  const origWithService = d.withService;
  d.withService = async (fn) => { callOrder.push("withService"); return origWithService(fn); };

  const result = await createAndLinkEtherAccount(base, d);
  check("retorna etherUserId da Ether", result.etherUserId === "ether-abc");
  check("retorna etherStatus cru da Ether", result.etherStatus === "pending_documents");
  check("retorna documentChecklist", result.documentChecklist?.pending?.[0] === "SELFIE_COM_DOC");
  check("recovered=false quando a Ether não sinaliza recovery", result.recovered === false);

  check("grava exatamente 1 UPDATE em profiles", serviceQueries.length === 1);
  const [{ sql, params }] = serviceQueries;
  check("UPDATE atinge public.profiles", /update\s+public\.profiles/i.test(sql));
  check(
    "ordem dos params: id, ether_user_id, ether_account_status, tax_id, phone",
    params[0] === USER_ID && params[1] === "ether-abc" && params[2] === "pending" && params[3] === "12345678900" && params[4] === "11999999999",
    JSON.stringify(params),
  );
  check(
    "ordem das chamadas: Ether cria perfil -> grava vínculo -> aceite de termos -> PEP",
    callOrder.join(",") === "createUserProfile,withService,acceptTerms,submitPepDeclaration",
    callOrder.join(","),
  );
}

// --- mapeamento de status cru da Ether -> enum local (CHECK do banco) -------
{
  for (const [raw, local] of [["pending_documents", "pending"], ["pending_analysis", "pending"], ["active", "full"], ["inactive", "rejected"], ["algo_desconhecido", "pending"]]) {
    const serviceQueries = [];
    const d = deps({ createUserProfile: async () => ({ userId: "ether-x", status: raw }), serviceQueries });
    await createAndLinkEtherAccount(base, d);
    check(`status Ether "${raw}" grava local "${local}"`, serviceQueries[0].params[2] === local);
  }
}

// --- 502: Ether recusa o cadastro -------------------------------------------
{
  const d = deps({ createUserProfile: async () => { throw Object.assign(new Error("recusado"), { body: { message: "CPF inválido" } }); } });
  try {
    await createAndLinkEtherAccount(base, d);
    check("Ether recusando o cadastro lança erro", false);
  } catch (error) {
    check("Ether recusando o cadastro -> 502", error.status === 502);
  }
}

// --- 502: Ether não devolve id -----------------------------------------------
{
  const d = deps({ createUserProfile: async () => ({ status: "pending_documents" }) });
  try {
    await createAndLinkEtherAccount(base, d);
    check("Ether sem userId lança erro", false);
  } catch (error) {
    check("Ether sem userId -> 502", error.status === 502);
  }
}

// --- 409: ether_user_id já vinculado a outro perfil (índice único) ---------
{
  const d = deps({ serviceError: Object.assign(new Error("duplicate key"), { code: "23505" }) });
  try {
    await createAndLinkEtherAccount(base, d);
    check("conflito de vínculo lança erro", false);
  } catch (error) {
    check("ether_user_id já vinculado -> 409", error.status === 409);
    check("409 carrega o código ETHER_ACCOUNT_ALREADY_LINKED", error.code === "ETHER_ACCOUNT_ALREADY_LINKED");
  }
}

// --- 503: conta criada na Ether mas a gravação local falha (órfã) ----------
{
  const d = deps({ serviceError: new Error("connection reset") });
  try {
    await createAndLinkEtherAccount(base, d);
    check("falha de gravação local lança erro", false);
  } catch (error) {
    check("gravação local falha -> 503 (reenviar reconcilia)", error.status === 503);
    check("503 carrega o código ETHER_LINK_PENDING", error.code === "ETHER_LINK_PENDING");
  }
}

// --- convergência no reenvio: 1ª tentativa órfã, 2ª recupera sem duplicar --
{
  const serviceQueries = [];
  let attempt = 0;
  const d1 = deps({
    createUserProfile: async () => { attempt++; return { userId: "ether-abc", status: "pending_documents", recovery: attempt > 1 }; },
    serviceError: new Error("timeout"),
  });
  try {
    await createAndLinkEtherAccount(base, d1);
    check("1ª tentativa (DB fora) lança erro", false);
  } catch (error) {
    check("1ª tentativa -> 503, conta já existe na Ether (órfã)", error.status === 503);
  }

  // 2ª tentativa: mesmo usuário reenvia; a Ether faz upsert por e-mail e
  // devolve recovery:true com o MESMO userId; desta vez a gravação local
  // funciona — não deve haver 409 nem duplicação, e recovered deve ser true.
  const d2 = deps({
    createUserProfile: d1.createUserProfile,
    serviceQueries,
  });
  const result = await createAndLinkEtherAccount(base, d2);
  check("2ª tentativa converge: mesmo etherUserId", result.etherUserId === "ether-abc");
  check("2ª tentativa converge: recovered=true", result.recovered === true);
  check("2ª tentativa grava exatamente 1 UPDATE (sem duplicar)", serviceQueries.length === 1);
}

// --- falha em accept-terms/pep-declaration não invalida o cadastro já criado
{
  const calls = [];
  const d = deps({
    acceptTerms: async () => { calls.push("accept-terms"); throw new Error("Ether fora do ar"); },
    submitPepDeclaration: async () => { calls.push("pep-declaration"); throw new Error("Ether fora do ar"); },
  });
  const result = await createAndLinkEtherAccount(base, d);
  check("accept-terms e pep-declaration tentados mesmo após falha do outro", calls.join(",") === "accept-terms,pep-declaration");
  check("cadastro já vinculado não é revertido por falha pós-vínculo", result.etherUserId === "ether-abc");
}

// -----------------------------------------------------------------------------
// reconcileOnboardingStatus — GET /auth/onboarding/status
// -----------------------------------------------------------------------------

const profileLinked = { ether_user_id: "ether-abc", ether_account_status: "pending", ether_pix_key: "chave", ether_pix_key_type: "EMAIL" };

{
  const body = await reconcileOnboardingStatus(USER_ID, null, { getAccountStatus: async () => ({}), withService: async () => {} });
  check("perfil sem ether_user_id -> not_started", body.status === "not_started");
}

{
  const body = await reconcileOnboardingStatus(USER_ID, { ether_user_id: null }, { getAccountStatus: async () => ({}), withService: async () => {} });
  check("profiles.ether_user_id null -> not_started", body.status === "not_started");
}

{
  // status mudou na Ether (pending -> active): deve persistir e refletir no corpo.
  const serviceQueries = [];
  const body = await reconcileOnboardingStatus(USER_ID, profileLinked, {
    getAccountStatus: async () => ({ status: "active", documentChecklist: { pending: [] } }),
    withService: async (fn) => fn(fakeClient(serviceQueries)),
  });
  check("status mudou -> grava ether_account_status local mapeado (full)", serviceQueries.length === 1 && serviceQueries[0].params[1] === "full");
  check("corpo devolve o status CRU da Ether (não o mapeado)", body.status === "active");
  check("userId correto no UPDATE", serviceQueries[0].params[0] === USER_ID);
}

{
  // status não mudou: não deve escrever no banco.
  const serviceQueries = [];
  await reconcileOnboardingStatus(USER_ID, profileLinked, {
    getAccountStatus: async () => ({ status: "pending_documents" }), // mapeia para "pending", igual ao atual
    withService: async (fn) => fn(fakeClient(serviceQueries)),
  });
  check("status local inalterado -> nenhum UPDATE (evita escrita desnecessária)", serviceQueries.length === 0);
}

{
  // Ether indisponível: degrada para o último status conhecido, sem lançar erro.
  const body = await reconcileOnboardingStatus(USER_ID, profileLinked, {
    getAccountStatus: async () => { throw new Error("ETIMEDOUT"); },
    withService: async () => { throw new Error("não deveria ser chamado"); },
  });
  check("Ether fora do ar -> devolve último status conhecido, sem lançar", body.status === "pending");
  check("Ether fora do ar -> checklist null (não inventa dado)", body.checklist === null);
  check("Ether fora do ar -> pix_key preservada do perfil local", body.pix_key === "chave");
}

console.log(FAIL ? `\n${FAIL} falha(s)` : "\ntudo ok");
process.exit(FAIL ? 1 : 0);
