// Cliente SP-API: renova o access_token via LWA e faz chamadas assinadas com Bearer.
// A Amazon descontinuou a exigência de AWS SigV4/role ARN — hoje basta o token LWA.
// Multi-conta: o token vem da conta ativa (AsyncLocalStorage); fallback para o .env.

import { currentAccount } from "./accountContext";
import { registrarChamada } from "./integrations/contadorDeChamadas";

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

// --- Erros tipados da SP-API ---
// Traduzem o erro cru da Amazon numa mensagem para a equipe + metadados para o log.
export type SpApiErrorCode =
  | "AMAZON_AUTH_EXPIRED" // 401 / refresh token inválido → reconectar conta
  | "AMAZON_FORBIDDEN" // 403 → verificar roles do app
  | "AMAZON_NOT_FOUND" // 404
  | "AMAZON_RATE_LIMIT" // 429 → tentar de novo
  | "AMAZON_BAD_REQUEST" // 400
  | "AMAZON_UNAVAILABLE" // 5xx → retry
  | "AMAZON_ERROR"; // fallback

export class SpApiError extends Error {
  // ⚠️ Campos declarados e atribuídos à mão, NÃO como parameter properties
  // (`constructor(public code: ...)`). O strip-only do Node — que roda os
  // testes e as sondas — recusa parameter property, e como este erro está na
  // base da cadeia de imports da Amazon, um único `public` aqui torna todo o
  // módulo de overview impossível de carregar fora do build. Mesma correção já
  // feita em `authErrors.ts`.
  readonly code: SpApiErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  /** Mensagem amigável, exibível para a equipe. */
  readonly userMessage: string;
  /** Endpoint chamado (ex.: /orders/v0/orders). */
  readonly endpoint: string;
  /** Detalhe técnico cru da Amazon — só para log, nunca para a UI. */
  readonly technicalDetail: string;
  /** x-amzn-RequestId da Amazon, útil para abrir caso no suporte. */
  readonly amazonRequestId?: string;

  constructor(
    code: SpApiErrorCode,
    status: number,
    retryable: boolean,
    userMessage: string,
    endpoint: string,
    technicalDetail: string,
    amazonRequestId?: string
  ) {
    super(userMessage);
    this.name = "SpApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.userMessage = userMessage;
    this.endpoint = endpoint;
    this.technicalDetail = technicalDetail;
    this.amazonRequestId = amazonRequestId;
  }
}

function friendlyForStatus(status: number): {
  code: SpApiErrorCode;
  retryable: boolean;
  message: string;
} {
  switch (status) {
    case 401:
      return {
        code: "AMAZON_AUTH_EXPIRED",
        retryable: false,
        message: "A conexão com a Amazon precisa ser renovada. Reconecte a conta.",
      };
    case 403:
      return {
        code: "AMAZON_FORBIDDEN",
        retryable: false,
        message:
          "A conexão desta conta não tem permissão para consultar esses dados. Reconecte a conta ou fale com o suporte.",
      };
    case 404:
      return {
        code: "AMAZON_NOT_FOUND",
        retryable: false,
        message: "A Amazon não encontrou esse recurso.",
      };
    case 429:
      return {
        code: "AMAZON_RATE_LIMIT",
        retryable: true,
        message:
          "A Amazon está limitando temporariamente as consultas. Tente novamente em instantes.",
      };
    case 400:
      return {
        code: "AMAZON_BAD_REQUEST",
        retryable: false,
        message: "Não foi possível concluir esta consulta. Verifique os dados e tente novamente.",
      };
    case 500:
    case 502:
    case 503:
    case 504:
      return {
        code: "AMAZON_UNAVAILABLE",
        retryable: true,
        message: "A Amazon está temporariamente indisponível. Tente novamente.",
      };
    default:
      return {
        code: "AMAZON_ERROR",
        retryable: status >= 500,
        message: "Não foi possível carregar os dados da Amazon.",
      };
  }
}

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

/** Credenciais LWA do app do OAuth (app-dash). Caem para as do .env se não definidas. */
export function oauthClientCreds(): { id: string; secret: string } {
  return {
    id: process.env.OAUTH_CLIENT_ID || env("LWA_CLIENT_ID"),
    secret: process.env.OAUTH_CLIENT_SECRET || env("LWA_CLIENT_SECRET"),
  };
}

/** Troca um refresh token por um access token LWA, com as credenciais informadas. */
export async function exchangeRefreshToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const data = await res.json();
  if (!res.ok) {
    // Falha no LWA quase sempre = refresh token revogado/expirado → reconectar.
    throw new SpApiError(
      "AMAZON_AUTH_EXPIRED",
      res.status,
      false,
      "A conexão com a Amazon precisa ser renovada. Reconecte a conta.",
      "lwa/token",
      `${data.error || "erro"}: ${data.error_description || "sem detalhe"}`
    );
  }
  return data.access_token as string;
}

export async function getAccessToken(): Promise<string> {
  const acct = currentAccount();
  let refreshToken: string;
  let clientId: string;
  let clientSecret: string;

  if (acct) {
    // Conta conectada via OAuth → credenciais do app-dash.
    refreshToken = acct.refreshToken;
    const c = oauthClientCreds();
    clientId = c.id;
    clientSecret = c.secret;
  } else {
    // Conta dona → credenciais do .env (app antigo).
    refreshToken = env("LWA_REFRESH_TOKEN");
    clientId = env("LWA_CLIENT_ID");
    clientSecret = env("LWA_CLIENT_SECRET");
  }

  const cached = tokenCache.get(refreshToken);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.value;
  }

  const value = await exchangeRefreshToken(refreshToken, clientId, clientSecret);
  tokenCache.set(refreshToken, { value, expiresAt: Date.now() + 3600 * 1000 });
  return value;
}

export interface SpApiOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

/** Faz uma chamada autenticada à SP-API e retorna o JSON. Lança erro em status >= 400. */
/**
 * Agrupa pelo FORMATO do caminho: `/orders/v0/orders/123-456` vira
 * `/orders/v0/orders/:id`. Contador por valor responderia "quantas vezes chamei
 * ESTE pedido" em vez de "quantas vezes chamei este endpoint".
 */
function caminhoDoEndpoint(path: string): string {
  return path.split("?")[0].replace(/\/[A-Z0-9]{2,}[\w.-]*\d[\w.-]*/gi, "/:id");
}

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
    // Conta CADA tentativa, inclusive as que levam 429 e sao repetidas — e o
    // que a Amazon ve. Ver contadorDeChamadas.ts.
    registrarChamada("amazon", caminhoDoEndpoint(path), {
      status: res.status,
      limite: res.headers.get("x-amzn-RateLimit-Limit"),
      erro: !res.ok,
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
      const amazonRequestId =
        res.headers.get("x-amzn-RequestId") ||
        res.headers.get("x-amzn-requestid") ||
        undefined;
      const f = friendlyForStatus(res.status);
      throw new SpApiError(
        f.code,
        res.status,
        f.retryable,
        f.message,
        path,
        detail,
        amazonRequestId
      );
    }
    return data as T;
  }
}

export function defaultMarketplaceId(): string {
  return process.env.DEFAULT_MARKETPLACE_ID || "A2Q3Y263D00KWC";
}
