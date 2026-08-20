/**
 * Cliente HTTP da API do LIVREPAY.
 *
 * Substitui o supabase-js: o browser não fala mais com o banco diretamente.
 * Toda regra de acesso continua no Postgres (RLS) — a API apenas transporta a
 * identidade do usuário para dentro da transação.
 *
 * Sobre armazenamento de token: o access token dura 15 min e o refresh token é
 * rotacionado a cada uso, com detecção de reuso no servidor (um token roubado
 * é invalidado assim que o cliente legítimo renova). Endurecimento futuro:
 * mover o refresh token para cookie httpOnly + SameSite, o que exige tratar
 * CSRF no servidor.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8081";

const ACCESS_KEY = "livrepay.access_token";
const REFRESH_KEY = "livrepay.refresh_token";

export interface SessionUser {
  id: string;
  email: string;
  full_name: string | null;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: SessionUser;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Listener = (user: SessionUser | null) => void;
const listeners = new Set<Listener>();

let currentUser: SessionUser | null = null;

function readToken(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storeSession(session: Session) {
  localStorage.setItem(ACCESS_KEY, session.access_token);
  localStorage.setItem(REFRESH_KEY, session.refresh_token);
  currentUser = session.user;
  listeners.forEach((fn) => fn(currentUser));
}

function clearSession() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  currentUser = null;
  listeners.forEach((fn) => fn(null));
}

export function onAuthChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCurrentUser(): SessionUser | null {
  return currentUser;
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Uma única renovação concorrente: se 3 requests receberem 401 ao mesmo tempo,
// todas aguardam o mesmo refresh em vez de disparar três rotações (o que
// invalidaria as duas últimas por detecção de reuso).
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = readToken(REFRESH_KEY);
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!response.ok) {
        clearSession();
        return false;
      }
      storeSession((await response.json()) as Session);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
): Promise<T> {
  const token = readToken(ACCESS_KEY);
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Access token expirado: renova uma vez e repete a requisição.
  if (response.status === 401 && retry && readToken(REFRESH_KEY)) {
    if (await refreshSession()) return request<T>(method, path, body, false);
    clearSession();
  }

  const payload = await parse(response);

  if (!response.ok) {
    const detail = payload as { error?: string; code?: string } | undefined;
    throw new ApiError(
      response.status,
      detail?.error ?? `Erro na requisição (HTTP ${response.status})`,
      detail?.code,
    );
  }

  return payload as T;
}

// --- Autenticação -----------------------------------------------------------

export const auth = {
  async register(email: string, password: string, fullName: string): Promise<Session> {
    const session = await request<Session>("POST", "/auth/register", {
      email,
      password,
      fullName,
    });
    storeSession(session);
    return session;
  },

  async login(email: string, password: string): Promise<Session> {
    const session = await request<Session>("POST", "/auth/login", { email, password });
    storeSession(session);
    return session;
  },

  async logout(): Promise<void> {
    const refreshToken = readToken(REFRESH_KEY);
    try {
      await request("POST", "/auth/logout", refreshToken ? { refresh_token: refreshToken } : {});
    } finally {
      clearSession();
    }
  },

  /** Restaura a sessão ao carregar a página. */
  async restore(): Promise<SessionUser | null> {
    if (!readToken(REFRESH_KEY)) return null;
    try {
      const profile = await request<{ id: string; full_name: string | null }>("GET", "/auth/me");
      currentUser = {
        id: profile.id,
        email: currentUser?.email ?? "",
        full_name: profile.full_name,
      };
      listeners.forEach((fn) => fn(currentUser));
      return currentUser;
    } catch {
      clearSession();
      return null;
    }
  },

  me: () =>
    request<{
      id: string;
      full_name: string | null;
      tax_id: string | null;
      phone: string | null;
      roles: string[];
    }>("GET", "/auth/me"),
};

// --- Recursos ---------------------------------------------------------------

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
};
