// Teste offline do schema de POST /auth/onboarding (sem Ether, sem banco).
// Uso: node server/tests/onboarding-schema.test.js
process.env.ETHER_CLIENT_ID = "test-client";
process.env.ETHER_CLIENT_SECRET = "test-secret";
process.env.ETHER_BASE_URL = "https://ether.invalid";
process.env.JWT_SECRET = "test-jwt-secret-not-real-0123456789";
process.env.PGUSER = "test";
process.env.PGPASSWORD = "test";

const { onboardingSchema, buildOnboardingPayload } = await import("../src/routes/auth.js");

let FAIL = 0;
function check(label, cond, detail) {
  console.log(`  ${cond ? "OK  " : "FALHA"} ${label}${!cond && detail ? " — " + detail : ""}`);
  if (!cond) FAIL++;
}

const address = { addressType: "residencial", zipcode: "90020007", street: "Rua A", number: "1", district: "Centro", city: "Porto Alegre", state: "RS" };
const pf = {
  taxId: "12345678900", personType: "FISICA", phone: "11999999999", dateBirth: "1990-05-15",
  documentNumber: "123", documentIssuingAgency: "SSP/RS", documentIssueDate: "2015-10-20", documentIssueState: "RS",
  nationality: "brasileiro", maritalStatus: "single", monthlyIncome: "5000.00", hometown: "Porto Alegre",
  address,
};
const pj = {
  taxId: "12345678000190", personType: "JURIDICA", phone: "11999999999", dateBirth: "2010-01-01",
  documentNumber: "123", website: "https://x.com.br", socialNetwork: "@x",
  address, maritalStatus: "SOLTEIRO(A)",
  companyInfo: { tradeName: "X", openingDate: "2010-01-01", revenue: "1000", responsible: { fullName: "A B", email: "a@b.com", phone: "11999999999" } },
};

let r = onboardingSchema.safeParse(pf);
check("PF mínimo (sem gender/education/socialName) é válido", r.success, JSON.stringify(r.error?.issues));
check("defaults: country=BR, caixaPostal=0, anoResidencia=5, isPreferred=true",
  r.success && r.data.address.country === "BR" && r.data.address.caixaPostal === 0 &&
  r.data.address.anoResidencia === 5 && r.data.address.isPreferred === true);
check("normaliza: single -> SOLTEIRO(A), brasileiro -> Brasileiro, residencial -> RESIDENCIAL",
  r.success && r.data.maritalStatus === "SOLTEIRO(A)" && r.data.nationality === "Brasileiro" && r.data.address.addressType === "RESIDENCIAL");

r = onboardingSchema.safeParse({ ...pf, education: "ENSINO_SUPERIOR_COMPLETO" });
check("education com underscores normaliza p/ forma do dicionário", r.success && r.data.education === "ENSINO SUPERIOR COMPLETO");
r = onboardingSchema.safeParse({ ...pf, education: "ensino superior completo", maritalStatus: "UNIAO_ESTAVEL" });
check("espaços/sem acento aceitos (UNIÃO ESTÁVEL)", r.success && r.data.maritalStatus === "UNIÃO ESTÁVEL");
r = onboardingSchema.safeParse({ ...pf, gender: "HOMEM_CISGENERO" });
check("gender válido", r.success && r.data.gender === "HOMEM_CISGENERO");
check("gender inválido rejeitado", !onboardingSchema.safeParse({ ...pf, gender: "X" }).success);
check("nationality fora de Brasileiro/Brasileira rejeitada", !onboardingSchema.safeParse({ ...pf, nationality: "Argentino" }).success);
check("phone de 10 dígitos rejeitado", !onboardingSchema.safeParse({ ...pf, phone: "1199999999" }).success);
for (const f of ["nationality", "maritalStatus", "monthlyIncome", "hometown"]) {
  const { [f]: _omit, ...rest } = pf;
  check(`PF sem ${f} rejeitado`, !onboardingSchema.safeParse(rest).success);
}
check("country 'Brasil' aceito", onboardingSchema.safeParse({ ...pf, address: { ...address, country: "Brasil" } }).success);
check("country 'US' rejeitado", !onboardingSchema.safeParse({ ...pf, address: { ...address, country: "US" } }).success);

r = onboardingSchema.safeParse(pj);
check("PJ completo é válido (sem hometown)", r.success, JSON.stringify(r.error?.issues));
for (const f of ["website", "socialNetwork", "companyInfo"]) {
  const { [f]: _omit, ...rest } = pj;
  check(`PJ sem ${f} rejeitado`, !onboardingSchema.safeParse(rest).success);
}
// CARTAO_CNPJ vale no upload/checklist, NUNCA em document.type (dois vocabulários distintos).
check("document.type CARTAO_CNPJ continua rejeitado", !onboardingSchema.safeParse({ ...pj, documentType: "CARTAO_CNPJ" }).success);
check("PJ sem documentType é válido (default vale p/ PF e PJ)", onboardingSchema.safeParse(pj).success);

const titular = { full_name: "Fulano", email: "f@x.com" };
const parse = (v) => onboardingSchema.parse(v);

let pay = buildOnboardingPayload(parse(pj), titular);
check("PJ: document.type = CARTEIRA_IDENTIDADE (representante legal)", pay.document.type === "CARTEIRA_IDENTIDADE");
check("PF: document.type = CARTEIRA_IDENTIDADE por padrão", buildOnboardingPayload(parse(pf), titular).document.type === "CARTEIRA_IDENTIDADE");
check("accountType NOMINAL", pay.accountType === "NOMINAL");

pay = buildOnboardingPayload(parse({ ...pj, cnaeId: "6204000", assessment: "simples_nacional", legalNature: "206-2", socialName: "Razao Social LTDA" }), titular);
check("PJ: cnaeId/assessment/legalNature dentro de profile (assessment normalizado)",
  pay.profile.cnaeId === "6204000" && pay.profile.assessment === "SIMPLES_NACIONAL" && pay.profile.legalNature === "206-2");
check("PJ: maritalStatus/gender/education descartados; companyInfo presente",
  !("maritalStatus" in pay.profile) && !("gender" in pay.profile) && !("education" in pay.profile) && !!pay.companyInfo);
check("PJ: cnaeId/assessment/legalNature opcionais (ausentes => não enviados)",
  !("cnaeId" in buildOnboardingPayload(parse(pj), titular).profile));
check("assessment inválido rejeitado", !onboardingSchema.safeParse({ ...pj, assessment: "MEI" }).success);

pay = buildOnboardingPayload(
  parse({ ...pf, gender: "HOMEM_CISGENERO", cnaeId: "6204000", assessment: "LUCRO_REAL", legalNature: "206-2", companyInfo: pj.companyInfo }),
  titular,
);
check("PF: cnaeId/assessment/legalNature descartados do profile",
  !("cnaeId" in pay.profile) && !("assessment" in pay.profile) && !("legalNature" in pay.profile));
check("PF: companyInfo descartado", !("companyInfo" in pay));
check("PF: gender/maritalStatus mantidos", pay.profile.gender === "HOMEM_CISGENERO" && pay.profile.maritalStatus === "SOLTEIRO(A)");
check("taxId segue sem máscara no payload", pay.profile.taxId === "12345678900");

console.log(FAIL ? `\n${FAIL} falha(s)` : "\ntudo ok");
process.exit(FAIL ? 1 : 0);
