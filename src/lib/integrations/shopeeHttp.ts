import { registrarChamada } from "./contadorDeChamadas";

/** Erro sanitizado da Open Platform, com metadados suficientes para retry/log. */
export class ShopeeApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, requestId?: string, status?: number, retryable = false) {
    super(message);
    this.name = "ShopeeApiError";
    this.code = code;
    this.requestId = requestId;
    this.status = status;
    this.retryable = retryable;
  }
}

export interface ShopeeEnvelope {
  error?: string;
  message?: string;
  request_id?: string;
  response?: unknown;
  [key: string]: unknown;
}

export function invalidShopeeResponse(status?: number): ShopeeApiError {
  return new ShopeeApiError(
    "invalid_response",
    "A Shopee retornou uma resposta inválida. Tente novamente em instantes.",
    undefined,
    status,
    true
  );
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Contabiliza a requisicao COMO A SHOPEE A VE — aqui dentro, e nao em
 * `shopeeFetch`, de proposito: este laco tenta ate tres vezes, e a plataforma
 * conta cada tentativa. Contar uma camada acima esconderia justamente as
 * repeticoes, que sao o que um alerta de comportamento anormal enxerga.
 *
 * O caminho e o endpoint (sem query, que carrega assinatura e token); o
 * `shop_id` identifica a loja, que e a unidade do limite deles.
 */
function contar(url: string, status: number | null, erro: boolean): void {
  try {
    const parsed = new URL(url);
    registrarChamada("shopee", parsed.pathname, {
      status,
      // A Shopee nao documenta cabecalho de limite; se um dia mandar, aparece aqui.
      erro,
      connectionId: parsed.searchParams.get("shop_id")
        ? `shopee:${parsed.searchParams.get("shop_id")}`
        : null,
    });
  } catch {
    // Instrumentacao nunca derruba a chamada que ela observa.
  }
}

/** HTTP fail-closed: resposta não-ok ou não-JSON jamais vira sucesso vazio. */
export async function requestShopeeJson(
  url: string,
  init?: RequestInit,
  pause: (milliseconds: number) => Promise<void> = wait
): Promise<ShopeeEnvelope> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(15_000) });
      contar(url, response.status, !response.ok);
    } catch (error) {
      contar(url, null, true);
      if (attempt < 2) {
        await pause(350 * 2 ** attempt);
        continue;
      }
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new ShopeeApiError("network_timeout", "A Shopee demorou para responder. Tente novamente em instantes.", undefined, undefined, true);
      }
      throw new ShopeeApiError("network_error", "Não foi possível falar com a Shopee. Tente novamente em instantes.", undefined, undefined, true);
    }

    const transient = response.status === 429 || response.status >= 500;
    if (transient && attempt < 2) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await pause(Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1_000, 30_000)
        : 500 * 2 ** attempt);
      continue;
    }

    let payload: ShopeeEnvelope;
    try {
      const parsed = JSON.parse(await response.text()) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalidShopeeResponse(response.status);
      payload = parsed as ShopeeEnvelope;
    } catch (error) {
      if (error instanceof ShopeeApiError) throw error;
      throw invalidShopeeResponse(response.status);
    }

    if (!response.ok) {
      throw new ShopeeApiError(
        typeof payload.error === "string" && payload.error ? payload.error : `http_${response.status}`,
        transient ? "A Shopee está temporariamente indisponível. Tente novamente em instantes." : "A Shopee recusou a solicitação.",
        typeof payload.request_id === "string" ? payload.request_id : undefined,
        response.status,
        transient
      );
    }
    return payload;
  }
  throw new ShopeeApiError("retry_exhausted", "A Shopee está temporariamente indisponível. Tente novamente em instantes.", undefined, undefined, true);
}
