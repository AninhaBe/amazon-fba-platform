export interface ProviderReadIssue {
  status: "attention";
  code: "OWNERSHIP_CONFLICT" | "PROVIDER_READ_FAILED";
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

export function providerReadIssue(error: unknown, provider?: "tiktok_shop"): ProviderReadIssue {
  if (provider === "tiktok_shop" && error instanceof Error && error.name === "TiktokOwnershipConflictError") {
    return TIKTOK_OWNERSHIP_ISSUE;
  }
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
