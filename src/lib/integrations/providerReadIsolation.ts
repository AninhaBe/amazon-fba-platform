export interface ProviderReadIssue {
  status: "attention";
  code: "OWNERSHIP_CONFLICT" | "PROVIDER_READ_FAILED" | "INFRA_INDISPONIVEL";
  message: string;
}

export interface ProviderReadResult<T> {
  value: T;
  issue?: ProviderReadIssue;
}

const GENERIC_READ_ISSUE: ProviderReadIssue = {
  status: "attention",
  code: "PROVIDER_READ_FAILED",
  message: "Não foi possível carregar este canal agora.",
};

const TIKTOK_OWNERSHIP_ISSUE: ProviderReadIssue = {
  status: "attention",
  code: "OWNERSHIP_CONFLICT",
  message: "Esta loja TikTok está vinculada a mais de um workspace. A conexão foi bloqueada para proteger o isolamento dos dados.",
};

/**
 * FALHA NOSSA, de infraestrutura — nao problema da conexao dela.
 *
 * ⚠️ Por que este codigo existe (29/08/2026): quando o banco nao respondia, a
 * guarda de isolamento fechava (comportamento CERTO — guarda que libera sem
 * conseguir verificar seria vazamento entre inquilinos) e a tela dizia "Canal
 * TikTok requer atencao" com um botao grande "Gerenciar conexoes".
 *
 * Ou seja: transformava "o banco nao respondeu" em "a sua conexao tem problema"
 * e oferecia o caminho de MEXER na conexao. Se ela clicasse e reconectasse,
 * queimaria uma autorizacao PERFEITA — e o TikTok e justamente o canal com app
 * publico em review. Uma mensagem errada nossa podia custar credencial real.
 *
 * Oferecer acao destrutiva com base numa duvida e o pior desenho possivel.
 */
const INFRA_ISSUE: ProviderReadIssue = {
  status: "attention",
  code: "INFRA_INDISPONIVEL",
  message: "O problema é nosso e é temporário: não conseguimos consultar os dados agora. A sua conexão está intacta — não precisa reconectar nada.",
};

/** Erros que sao NOSSOS (banco/pool/rede interna), nunca da conexao dela. */
function ehFalhaDeInfra(error: unknown): boolean {
  const texto = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return /timeout exceeded when trying to connect|ECHECKOUTTIMEOUT|statement timeout|canceling statement|ECONNREFUSED|ETIMEDOUT|Connection terminated|pool/i.test(texto);
}

export function providerReadIssue(error: unknown, provider?: "tiktok_shop"): ProviderReadIssue {
  if (provider === "tiktok_shop" && error instanceof Error && error.name === "TiktokOwnershipConflictError") {
    return TIKTOK_OWNERSHIP_ISSUE;
  }
  // A verificacao NAO CONSEGUIU RODAR: nao da para culpar a conexao dela.
  if (ehFalhaDeInfra(error)) return INFRA_ISSUE;
  return GENERIC_READ_ISSUE;
}

/**
 * Isola uma leitura de canal. O fallback deve ser vazio e nunca pode reutilizar
 * dados de outro workspace; a falha continua visivel no issue sanitizado.
 */
export async function isolateProviderRead<T>(
  read: () => Promise<T>,
  fallback: T,
  provider?: "tiktok_shop",
): Promise<ProviderReadResult<T>> {
  try {
    return { value: await read() };
  } catch (error) {
    return { value: fallback, issue: providerReadIssue(error, provider) };
  }
}
