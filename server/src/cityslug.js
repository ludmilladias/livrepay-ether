/**
 * Normalização de address.city para o slug que a Ether aceita.
 *
 * POR QUE EXISTE: o único formato de cidade já aceito em teste REAL contra a
 * Ether é o slug ("br-sp-sao-paulo"; PENDING.md). A forma livre ("São Paulo")
 * NUNCA foi aceita em teste real — não sabemos se é recusada. E recusa de
 * cadastro na Ether pode queimar o CPF do lado deles (caso USR_DUP_005: trocar
 * e-mail, telefone e documento não resolveu, só trocar o CPF). Um erro
 * cosmético viraria incidente irreversível, então o backend garante o slug e
 * não depende do frontend nem da sorte.
 *
 * Regra: minúsculas, sem acento, qualquer sequência fora de [a-z0-9] vira um
 * hífen (espaço, apóstrofo, hífen original, ponto...), sem hífen nas pontas,
 * prefixo `br-<uf>-`. Idempotente: entrada que já é slug (`br-xx-...`) só é
 * convertida para minúsculas, nunca re-prefixada.
 */

const SLUG_RE = /^br-[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Slug do nome da cidade, sem o prefixo br-uf. "" se não sobrar nada. */
function slugifyName(name) {
  return String(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove diacríticos (ç -> c, ã -> a)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** true se o valor já tem a forma de slug da Ether (case-insensitive). */
export function isCitySlug(value) {
  return SLUG_RE.test(String(value).trim().toLowerCase());
}

/** UF embutida num slug (`br-sp-...` -> "sp"), ou null. */
export function slugUf(slug) {
  return isCitySlug(slug) ? String(slug).trim().toLowerCase().slice(3, 5) : null;
}

/**
 * Converte cidade + UF em slug. Devolve null se não for possível produzir um
 * slug confiável (UF inválida, cidade sem caracteres úteis, ou slug cuja UF
 * contradiz a UF informada) — quem chama transforma isso em erro 400 em vez de
 * mandar um valor duvidoso à Ether.
 */
export function toCitySlug(city, uf) {
  const ufClean = String(uf ?? "").trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(ufClean)) return null;

  const raw = String(city ?? "").trim().toLowerCase();
  if (isCitySlug(raw)) return raw.slice(3, 5) === ufClean ? raw : null;

  const name = slugifyName(city ?? "");
  return name ? `br-${ufClean}-${name}` : null;
}
