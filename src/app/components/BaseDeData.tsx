import { brDate } from "@/lib/datetime";

/**
 * Qual data cada número usa.
 *
 * Nasceu de uma pergunta da Ana em 27/08/2026: o monitor dizia "hoje R$ 194,25"
 * e o dashboard dizia "hoje R$ 56,90". Os dois estavam certos — um conta pela
 * data em que a VENDA foi feita, o outro pela data em que o marketplace LANÇOU
 * o dinheiro —, mas nenhuma das telas dizia qual era qual. "Não tá claro."
 *
 * ⚠️ POR QUE UMA LINHA DA SEÇÃO, E NÃO UM SUFIXO NO RÓTULO
 *
 * O contrato sugeria "Faturamento (por data do pedido)". Não cabe: `.metric-label-text`
 * é `white-space: nowrap` com reticências dentro de uma faixa que rola na
 * horizontal, então a parte cortada seria justamente a base — o único pedaço que
 * importa. E a faixa da Amazon não aceita texto embaixo do número por decisão
 * dela (24/08/2026: "todos esses textos que estão embaixo... pode colocar no i").
 * Uma linha por seção diz a mesma coisa uma vez só, não trunca, e é a MESMA
 * frase nos quatro canais — que é o que faz duas telas pararem de se contradizer.
 *
 * Regra do contrato que esta linha existe para cumprir: nunca colocar as duas
 * bases lado a lado sem rótulo.
 */

export type Base = "pedido" | "lancamento" | "pedido-extrato";

const TEXTO: Record<Base, { titulo: string; explica: string }> = {
  pedido: {
    titulo: "por data do pedido",
    // Sem jargão: não diz "occurred_at" nem "base pedido", diz o que acontece.
    explica: "entram no dia da venda, mesmo que o marketplace ainda não tenha lançado o dinheiro",
  },
  lancamento: {
    titulo: "por data do lançamento",
    explica: "entram no dia em que o dinheiro foi lançado, mesmo que a venda seja de outro dia",
  },
  // A pegadinha do TikTok: o extrato oficial troca a AUTORIDADE do valor, não a
  // data. Quem lê "extrato" espera data de repasse e recebe data de pedido.
  "pedido-extrato": {
    titulo: "por data do pedido",
    explica: "o extrato oficial confirma o valor, mas a data continua sendo a da venda",
  },
};

export function BaseDeData({ base, prefixo = "Valores" }: { base: Base; prefixo?: string }) {
  const { titulo, explica } = TEXTO[base];
  return (
    <p className="base-de-data" role="note">
      {prefixo} <strong>{titulo}</strong>: {explica}.
    </p>
  );
}

/** Mesma frase, para caber num `info` de card sem repetir texto. */
export function explicacaoDaBase(base: Base): string {
  const { titulo, explica } = TEXTO[base];
  return `Contado ${titulo}: ${explica}.`;
}

/**
 * Progresso da importação e alcance do histórico — UMA linha, não duas faixas.
 *
 * Hoje o dashboard empilha dois blocos de largura total que dizem partes da
 * mesma frase: o `sync-chip` ("Histórico: N% importado") e a
 * `integration-message` ("Os números abaixo cobrem a partir de DD/MM"). Dois
 * avisos de PROGRESSO com o peso visual de alarme, um debaixo do outro, antes
 * do primeiro número — parte do acúmulo que a Ana apontou em 28/08/2026.
 *
 * Nada foi removido: toda frase que existia continua aqui, e cada uma aparece
 * exatamente na mesma condição de antes. O que muda é que elas ocupam uma linha
 * discreta em vez de duas caixas, e ficam coladas na faixa de métricas que
 * explicam. A barra fina do progresso sobrevive — ela comunica em 88px o que o
 * texto levava uma faixa inteira para dizer.
 */
export function ProgressoDaImportacao({ progresso, cobreDesde, emImportacao, pedidosImportados }: {
  /** `null` quando o backfill terminou ou o canal não informa. */
  progresso?: number | null;
  /** Data em que o histórico importado começa; `null` quando cobre o período. */
  cobreDesde?: string | null;
  emImportacao?: boolean;
  pedidosImportados?: number | null;
}) {
  const temProgresso = typeof progresso === "number";
  if (!temProgresso && !cobreDesde) return null;

  const importados = pedidosImportados ?? 0;
  return (
    <p className="base-de-data progresso-da-importacao" role="status">
      {temProgresso && (
        <span className="sync-chip-track" aria-hidden="true">
          <i style={{ width: `${progresso}%` }} />
        </span>
      )}
      <span>
        {temProgresso && <>Histórico <strong>{progresso}% importado</strong></>}
        {temProgresso && cobreDesde && " — "}
        {cobreDesde && (
          <>
            os números abaixo cobrem a partir de <strong>{brDate(new Date(cobreDesde))}</strong>
            {emImportacao
              ? <> ({importados.toLocaleString("pt-BR")} pedido(s) já importado(s))</>
              : <> — o histórico importado começa aí</>}
          </>
        )}
        {temProgresso && !cobreDesde && <> — os números abaixo já estão disponíveis</>}
        .
      </span>
    </p>
  );
}
