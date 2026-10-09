/**
 * Destino pós-login seguro (evita open redirect).
 *
 * Só aceita caminho interno da MESMA origem. O parser de URL do navegador trata
 * `\` como `/` em esquemas especiais, então `/\evil.com` vira `//evil.com`
 * (outra origem) — por isso não basta checar `startsWith("/")` e `"//"`.
 * Validamos resolvendo com `new URL(raw, origin)` e exigindo a mesma origem, e
 * por cautela rejeitamos qualquer barra invertida (crua ou %5C) e caracteres de
 * controle no valor recebido. Rejeitado => "/".
 */
export function safeNext(raw: string | null | undefined, origin?: string): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw) || /%5c/i.test(raw)) return "/";

  const base = origin ?? window.location.origin;
  try {
    const url = new URL(raw, base);
    if (url.origin !== new URL(base).origin) return "/";
    // Segmentos de ponto ("/.//evil.com") normalizam para "//evil.com", que um
    // navegador/roteador pode tratar como protocolo-relativo (outra origem).
    if (url.pathname.startsWith("//")) return "/";
    const target = `${url.pathname}${url.search}${url.hash}`;
    // Evita laço: quem já está logado em /auth não deve voltar para /auth.
    if (url.pathname === "/auth" || url.pathname.startsWith("/auth/")) return "/";
    return target;
  } catch {
    return "/";
  }
}
