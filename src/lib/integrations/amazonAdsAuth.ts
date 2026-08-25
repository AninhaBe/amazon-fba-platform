import { dbQuery } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { protectSecret, revealSecret } from "./secrets";

// OAuth da Amazon Ads API (Login with Amazon, Authorization Code grant).
//
// Por que NÃO usa `workspace_integrations` como os canais: publicidade não é um
// canal de venda. Não tem pedido, não tem produto, não entra no modelo canônico
// (ADR-001) e não deve aparecer na lista de lojas conectadas. Guardar aqui
// evitaria criar um `provider` fantasma que o sync e o dashboard teriam de
// aprender a ignorar em todo lugar.
//
// A conta de publicidade é *vinculada* ao vendedor, não é o vendedor — um
// perfil de Ads cobre um marketplace inteiro e é escolhido por `profileId`.
//
// ⚠️ O `refresh_token` da Amazon **não rotaciona** (diferente do Mercado Livre,
// ver docs/conexoes-que-expiram.md): o mesmo valor segue válido até ser revogado.
// O `access_token` vale 1 hora e é sempre derivado dele na hora do uso.

const TOKEN_ENDPOINT = "https://api.amazon.com/auth/o2/token";
const AUTHORIZE_ENDPOINT = "https://www.amazon.com.br/ap/oa";
const SCOPE = "advertising::campaign_management";

export const ADS_SETTING_KEY = "amazon_ads_oauth";

export interface AmazonAdsCredentials {
  refreshToken: string;
  /** Perfil escolhido (um por marketplace). `null` até a primeira listagem. */
  profileId: string | null;
  connectedAt: string;
  updatedAt: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface AdsProfile {
  profileId: number;
  countryCode: string;
  currencyCode: string;
  accountInfo?: { id?: string; type?: string; name?: string };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ausente — a integração de Ads não está configurada.`);
  return value;
}

/** URL de consentimento. `state` é do chamador e volta no callback (anti-CSRF). */
export function amazonAdsAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requiredEnv("ADS_CLIENT_ID"),
    scope: SCOPE,
    response_type: "code",
    redirect_uri: requiredEnv("ADS_REDIRECT_URI"),
    state,
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...body,
      client_id: requiredEnv("ADS_CLIENT_ID"),
      client_secret: requiredEnv("ADS_CLIENT_SECRET"),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const texto = await res.text();
  if (!res.ok) {
    // O corpo traz `error_description`, mas pode conter eco de parâmetros —
    // recortado para não vazar credencial em log.
    throw new Error(`Token da Amazon Ads recusado (HTTP ${res.status}): ${texto.slice(0, 200)}`);
  }
  return JSON.parse(texto) as TokenResponse;
}

export async function exchangeAdsCode(code: string): Promise<TokenResponse> {
  return postToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: requiredEnv("ADS_REDIRECT_URI"),
  });
}

/** Access token novo a partir do refresh guardado. Nunca é persistido. */
export async function adsAccessToken(refreshToken: string): Promise<string> {
  const token = await postToken({ grant_type: "refresh_token", refresh_token: refreshToken });
  return token.access_token;
}

/** Perfis de publicidade visíveis para esta autorização (um por marketplace). */
export async function listAdsProfiles(accessToken: string): Promise<AdsProfile[]> {
  const res = await fetch(`${requiredEnv("ADS_API_HOST")}/v2/profiles`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": requiredEnv("ADS_CLIENT_ID"),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Listagem de perfis falhou (HTTP ${res.status}).`);
  return (await res.json()) as AdsProfile[];
}

/**
 * ⚠️ O REFRESH TOKEN É CIFRADO ANTES DE ENCOSTAR NO BANCO.
 *
 * Este token não lê dado: ele **gasta dinheiro**. Com ele dá para criar campanha,
 * subir lance e esvaziar o orçamento de anúncio da vendedora. É a credencial mais
 * perigosa do produto, e era a única guardada em claro — 609 caracteres de JSON
 * legível em `workspace_settings`, enquanto Amazon, ML, Shopee e TikTok já passavam
 * por `protectSecret`/`revealSecret` (AES-256-GCM, prefixo `enc:v1:`).
 *
 * Corrigido em 25/08/2026, no mesmo dia em que o primeiro token foi emitido.
 */
export async function saveAdsCredentials(credentials: AmazonAdsCredentials): Promise<void> {
  const protegidas = { ...credentials, refreshToken: protectSecret(credentials.refreshToken) };
  await dbQuery(
    `INSERT INTO workspace_settings (workspace_id,key,value,updated_at)
     VALUES ($1,$2,$3::jsonb,now())
     ON CONFLICT (workspace_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
    [currentWorkspaceId(), ADS_SETTING_KEY, JSON.stringify(protegidas)],
  );
}

export async function getAdsCredentials(): Promise<AmazonAdsCredentials | null> {
  const rows = await dbQuery<{ value: AmazonAdsCredentials }>(
    `SELECT value FROM workspace_settings WHERE workspace_id=$1 AND key=$2`,
    [currentWorkspaceId(), ADS_SETTING_KEY],
  );
  const stored = rows[0]?.value;
  if (!stored || typeof stored.refreshToken !== "string") return null;
  // `revealSecret` devolve o texto puro quando o valor NÃO tem o prefixo `enc:v1:`
  // — é o que faz o token gravado antes desta mudança continuar funcionando.
  // Ele é reescrito cifrado no próximo `saveAdsCredentials`.
  const refreshToken = revealSecret(stored.refreshToken);
  return refreshToken ? { ...stored, refreshToken } : null;
}
