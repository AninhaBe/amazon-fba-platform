// Cliente SP-API: renova o access_token via LWA e faz chamadas assinadas com Bearer.
// A Amazon descontinuou a exigência de AWS SigV4/role ARN — hoje basta o token LWA.
// Multi-conta: o token vem da conta ativa (AsyncLocalStorage); fallback para o .env.

import { currentRefreshToken } from "./accountContext";

const REGION_HOSTS: Record<string, string> = {
  NA: "https://sellingpartnerapi-na.amazon.com",
  EU: "https://sellingpartnerapi-eu.amazon.com",
  FE: "https://sellingpartnerapi-fe.amazon.com",
};

const SANDBOX_HOSTS: Record<string, string> = {
  NA: "https://sandbox.sellingpartnerapi-na.amazon.com",
  EU: "https://sandbox.sellingpartnerapi-eu.amazon.com",
  FE: "https://sandbox.sellingpartnerapi-fe.amazon.com",
};

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

function env(name: string, required = true): string {
  const v = process.env[name];
  if (required && !v) {
    throw new Error(
      `Variável de ambiente ausente: ${name}. Configure em .env.local (veja .env.local.example).`
    );
  }
  return v ?? "";
}

function baseUrl(): string {
  const region = (process.env.SPAPI_REGION || "NA").toUpperCase();
  const useSandbox = process.env.SPAPI_USE_SANDBOX === "true";
  const table = useSandbox ? SANDBOX_HOSTS : REGION_HOSTS;
  const host = table[region];
  if (!host) throw new Error(`Região SP-API inválida: ${region} (use NA, EU ou FE).`);
  return host;
}

// --- Cache do access_token por refresh token (expira em ~1h) ---
const tokenCache = new Map<string, { value: string; expiresAt: number }>();

/** Troca um refresh token por um access token LWA. */
export async function exchangeRefreshToken(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env("LWA_CLIENT_ID"),
    client_secret: env("LWA_CLIENT_SECRET"),
  });

  const res = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Falha ao obter access_token LWA (${res.status}): ${data.error_description || data.error || "erro desconhecido"}`
    );
  }
  return data.access_token as string;
}

export async function getAccessToken(): Promise<string> {
  // Token da conta ativa (OAuth); se não houver, usa o do .env (conta dona).
  const refreshToken = currentRefreshToken() || env("LWA_REFRESH_TOKEN");

  const cached = tokenCache.get(refreshToken);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.value;
  }

  const value = await exchangeRefreshToken(refreshToken);
  tokenCache.set(refreshToken, { value, expiresAt: Date.now() + 3600 * 1000 });
  return value;
}

export interface SpApiOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

/** Faz uma chamada autenticada à SP-API e retorna o JSON. Lança erro em status >= 400. */
export async function spapiFetch<T = unknown>(
  path: string,
  opts: SpApiOptions = {}
): Promise<T> {
  const token = await getAccessToken();

  const url = new URL(baseUrl() + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
  }

  const maxRetries = 3;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url.toString(), {
      method: opts.method ?? "GET",
      headers: {
        "x-amz-access-token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });

    // 429 = rate limit; espera e tenta de novo (backoff exponencial).
    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 1000 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    const text = await res.text();
    const data = text ? JSON.parse(text) : {};

    if (!res.ok) {
      const detail =
        data?.errors?.map((e: { message: string }) => e.message).join("; ") ||
        JSON.stringify(data);
      throw new Error(`SP-API ${res.status} em ${path}: ${detail}`);
    }
    return data as T;
  }
}

export function defaultMarketplaceId(): string {
  return process.env.DEFAULT_MARKETPLACE_ID || "A2Q3Y263D00KWC";
}
