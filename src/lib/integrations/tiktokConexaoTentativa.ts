import type { AppDoTikTok } from "./tiktokApps";

/**
 * REGISTRO DE TENTATIVA DE CONEXÃO DO TIKTOK.
 *
 * ⚠️ POR QUE ISTO EXISTE (11/09/2026). O primeiro vendedor real tentou conectar
 * quatro vezes e as quatro falharam. Para descobrir o que aconteceu foi preciso
 * arqueologia: os logs do Fly **não têm linha por requisição**, e a única pista
 * durável veio de um contador de chamadas criado para outro fim (o alerta da
 * Shopee de 29/08). A pergunta "o callback chegou a ser chamado?" não tinha
 * resposta direta.
 *
 * Com 50–70 vendedores, uma conexão que falha sem deixar rastro é uma
 * investigação por pessoa. Este módulo troca isso por uma linha.
 *
 * ═══ O QUE NUNCA ENTRA AQUI ═══
 *
 * Token, refresh token, `shop_cipher`, nome ou id da loja, e nada do comprador.
 * O `workspace` entra abreviado: serve para correlacionar duas linhas do mesmo
 * atendimento, não para identificar o inquilino. A regra de 02/09/2026 vale
 * inteira — o que sai de um lugar sem escopo é agregado, nunca identificador.
 */

/** O que aconteceu com a tentativa. Um código por caminho, sem ambiguidade. */
export type DesfechoDaConexao =
  /** Gravou a conexão. O único desfecho bom. */
  | "conectada"
  /** A TikTok autorizou, mas a lista de lojas veio vazia mesmo após as tentativas. */
  | "sem_lojas"
  /** A loja já pertence a outra conta do NEXO — isolamento entre inquilinos. */
  | "loja_de_outra_conta"
  /** Chegou sem o nosso `state`: entrada por fora (App Store do TikTok). */
  | "sem_state"
  /** Veio `state`, mas ele não bate com o cookie desta sessão. */
  | "state_invalido"
  /** Voltou sem `code` — consentimento incompleto. */
  | "codigo_ausente"
  /** A própria TikTok devolveu erro no retorno (vendedor cancelou, por exemplo). */
  | "recusado_na_tiktok"
  /** Qualquer falha não prevista. O `motivo` carrega o nome do erro. */
  | "erro";

export interface TentativaDeConexao {
  desfecho: DesfechoDaConexao;
  /** Qual app assinou. Ausente quando a tentativa morreu antes de haver app. */
  app?: AppDoTikTok;
  /** Quantas lojas a TikTok devolveu. `undefined` = nem chegou a perguntar. */
  lojas?: number;
  /** Quantas voltas o retry deu até desistir ou conseguir. */
  tentativas?: number;
  /** Workspace abreviado, só para correlacionar linhas do mesmo atendimento. */
  workspace?: string;
  /** Nome do erro, quando houver. Nunca a mensagem crua do provedor. */
  motivo?: string;
}

/** Prefixo estável: é por ele que se filtra o log no Fly. */
export const MARCA_DA_TENTATIVA = "[tiktok-conexao]";

/**
 * Monta a linha. Separada do `console` de propósito: assim o teste exercita o
 * COMPORTAMENTO (o que a linha diz) em vez de espionar efeito colateral.
 */
export function linhaDaTentativa(t: TentativaDeConexao): string {
  const partes = [`desfecho=${t.desfecho}`];
  if (t.app) partes.push(`app=${t.app}`);
  if (t.lojas !== undefined) partes.push(`lojas=${t.lojas}`);
  if (t.tentativas !== undefined) partes.push(`tentativas=${t.tentativas}`);
  if (t.workspace) partes.push(`ws=${t.workspace.slice(0, 8)}`);
  if (t.motivo) partes.push(`motivo=${t.motivo.replace(/\s+/g, "_").slice(0, 60)}`);
  return `${MARCA_DA_TENTATIVA} ${partes.join(" ")}`;
}

/**
 * Registra a tentativa.
 *
 * ⚠️ NUNCA LANÇA. Instrumentação que derruba o fluxo que ela observa é pior que
 * instrumentação nenhuma — e este fluxo é o de um vendedor conectando a loja.
 */
export function registrarTentativaDeConexao(t: TentativaDeConexao): void {
  try {
    console.log(linhaDaTentativa(t));
  } catch {
    // Registro é melhor-esforço, por desenho.
  }
}
