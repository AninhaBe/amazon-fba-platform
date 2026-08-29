/**
 * Salvar o custo de uma linha sem recarregar a tela.
 *
 * ## O defeito que isto substitui
 *
 * Medido em 29/08/2026, na página de produtos da Shopee: salvar um custo
 * chamava `retry()`, que subia um contador de tentativa; o efeito do módulo
 * depende dele e começa zerando o payload, e com o payload nulo a tela INTEIRA
 * vira esqueleto. Não era recarga do navegador — era recarga nossa, e para
 * quem usa dá no mesmo (pior: perde o scroll e o foco do campo). Ainda eram
 * duas idas ao servidor para buscar um valor que o próprio POST já devolvia.
 *
 * A dona do produto pediu o oposto, com estas palavras: "quero apenas digitar,
 * salvar, sem ter nenhum carregamento a partir disso".
 *
 * ## O que mora aqui, e por quê
 *
 * As três regras que somem numa refatoração futura, isoladas do componente
 * para poderem ser testadas por comportamento e não por leitura de código.
 */

/** Vocabulário ÚNICO do estado de salvamento, nas quatro telas. */
export const ROTULO_DO_CUSTO = {
  saving: "Salvando…",
  saved: "Salvo",
  error: "Falha ao salvar",
  pendente: "Pendente",
} as const;

export type EstadoDoCusto = "idle" | "saving" | "saved" | "invalido" | "error";

/**
 * ⚠️ ERRO SÓ SAI DA TELA POR AÇÃO DELA.
 *
 * Antes, a recarga apagava a falha e devolvia o campo ao valor antigo — ela
 * podia sair achando que salvou. Agora "invalido" e "error" só são limpos
 * quando ela mexe no campo (`editou`) ou tenta de novo (`salvou`).
 */
export function proximoEstado(atual: EstadoDoCusto, evento: "editou" | "salvou" | "ok" | "invalido" | "falhou"): EstadoDoCusto {
  switch (evento) {
    case "editou": return "idle";
    case "salvou": return "saving";
    case "ok": return "saved";
    case "invalido": return "invalido";
    case "falhou": return "error";
    default: return atual;
  }
}

/**
 * ⚠️ A CHAVE É O ID DO CUSTO, NUNCA O DA LINHA.
 *
 * Enquanto o custo for por anúncio, um anúncio com várias variações mostra
 * VÁRIAS linhas que compartilham o MESMO custo. A recarga atualizava todas sem
 * querer; um patch por linha atualizaria uma e deixaria as outras com o valor
 * velho na tela — e ela concluiria, com razão, que não salvou.
 */
export function custoExibido(patch: Record<string, number>, linha: { id?: unknown; cost?: unknown }): number | null {
  const chave = typeof linha.id === "string" ? linha.id : null;
  if (chave && chave in patch) return patch[chave];
  return typeof linha.cost === "number" ? linha.cost : null;
}

export function comCustoSalvo(patch: Record<string, number>, chaveDoCusto: string, valor: number): Record<string, number> {
  return { ...patch, [chaveDoCusto]: valor };
}

/** O que veio salvo do servidor: o valor é o DELE, não o que foi digitado. */
export interface CustoSalvo { chave: string; valor: number }

/**
 * Salva e devolve o que o servidor gravou.
 *
 * ⚠️ UMA REQUISIÇÃO, E SÓ UMA. Nada de revalidar depois: a resposta já traz o
 * valor. Foi exatamente a ida extra que virou recarga de tela.
 */
export async function salvarCusto({ url, corpo, buscar }: {
  url: string;
  corpo: Record<string, unknown>;
  buscar: typeof fetch;
}): Promise<CustoSalvo> {
  const resposta = await buscar(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const corpoDaResposta = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = corpoDaResposta as { error?: string; code?: string };
    throw Object.assign(new Error(erro.error || "Não foi possível salvar o custo."), { code: erro.code });
  }
  const entrada = (corpoDaResposta as { entry?: { id?: unknown; cost?: unknown } }).entry;
  return {
    chave: typeof entrada?.id === "string" ? entrada.id : String(corpo.productId ?? ""),
    // Do servidor: ele é quem normaliza. Cair no digitado só quando ele não diz.
    valor: typeof entrada?.cost === "number" ? entrada.cost : Number(corpo.cost),
  };
}

/** O custo digitado é válido? Vazio e negativo não são custo; zero é um fato. */
export function custoValido(rascunho: string): number | null {
  if (!rascunho.trim()) return null;
  const valor = Number(rascunho);
  return Number.isFinite(valor) && valor >= 0 ? valor : null;
}
