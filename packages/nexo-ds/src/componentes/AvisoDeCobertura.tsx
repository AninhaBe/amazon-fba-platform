/**
 * AVISO DE COBERTURA — "os numeros abaixo cobrem a partir de DD/MM".
 *
 * ⚠️ ELE SO FALA QUANDO OS NUMEROS NAO COBREM O PERIODO PEDIDO, e essa condicao
 * e o componente. Ate 06/09/2026 a peca tambem anunciava o caso bom
 * ("Historico 99% importado — os numeros abaixo ja estao disponiveis") e a dona
 * mandou tirar: *"esse dado aqui nao tem relevancia alguma, nossa arquitetura
 * tem que ter todos os dados, estamos assumindo isso"*. Estado normal nao e
 * noticia, e celebrar o normal treina a pessoa a ignorar a faixa no dia em que
 * ela diz algo.
 *
 * ⚠️ O QUE FICOU E O QUE SEPARA "NAO VENDEU" DE "NAO IMPORTEI" — a unica
 * confusao que faria a vendedora achar que teve um dia ruim quando teve um dia
 * nao importado.
 *
 * As duas clausulas finais dizem coisas DIFERENTES e as duas existem: "ainda
 * esta sendo importado" promete mais historico; "comeca ai" diz que nao vem.
 */
export interface AvisoDeCoberturaProps {
  /** Data em que o historico comeca, ja formatada ("12/08/2026"). */
  cobreDesde: string;
  /** `null` quando o backfill terminou ou o canal nao informa. */
  progresso?: number | null;
  /** Ha mais historico a caminho para o inicio deste periodo. */
  emImportacao?: boolean;
  /** Ja formatado por quem chama (locale e dele). */
  pedidosImportados?: string;
}

export function AvisoDeCobertura({ cobreDesde, progresso, emImportacao, pedidosImportados }: AvisoDeCoberturaProps) {
  const temProgresso = typeof progresso === "number";
  return (
    <p className="base-de-data progresso-da-importacao" role="status">
      {temProgresso && (
        <span className="sync-chip-track" aria-hidden="true"><i style={{ width: `${progresso}%` }} /></span>
      )}
      <span>
        {temProgresso && <>Histórico <strong>{progresso}% importado</strong> — </>}
        os números abaixo cobrem a partir de <strong>{cobreDesde}</strong>
        {emImportacao
          ? <> — o início do período ainda está sendo importado ({pedidosImportados ?? "0"} pedido(s) já importado(s))</>
          : <> — o histórico importado começa aí</>}
        .
      </span>
    </p>
  );
}

/**
 * BASE DE DATA — qual data cada numero usa.
 *
 * ⚠️ Nasceu de uma pergunta dela em 27/08/2026: o monitor dizia "hoje R$ 194,25"
 * e o dashboard dizia "hoje R$ 56,90". Os dois estavam certos — um conta pela
 * data da VENDA, o outro pela data em que o marketplace LANCOU o dinheiro —,
 * mas nenhuma das telas dizia qual era qual. *"Nao ta claro."*
 *
 * E uma linha da secao, e nao um sufixo no rotulo, porque o rotulo do card e
 * `nowrap` com reticencias: a parte cortada seria justamente a base.
 */
export type Base = "pedido" | "lancamento" | "pedido-extrato";

const TEXTO: Record<Base, { titulo: string; explica: string }> = {
  pedido: {
    titulo: "por data do pedido",
    explica: "entram no dia da venda, mesmo que o marketplace ainda não tenha lançado o dinheiro",
  },
  lancamento: {
    titulo: "por data do lançamento",
    explica: "entram no dia em que o dinheiro foi lançado, mesmo que a venda seja de outro dia",
  },
  // A pegadinha do TikTok: o extrato oficial troca a AUTORIDADE do valor, nao a
  // data. Quem le "extrato" espera data de repasse e recebe data de pedido.
  "pedido-extrato": {
    titulo: "por data do pedido",
    explica: "o extrato oficial confirma o valor, mas a data continua sendo a da venda",
  },
};

export function BaseDeData({ base, prefixo = "Valores" }: { base: Base; prefixo?: string }) {
  const { titulo, explica } = TEXTO[base];
  return <p className="base-de-data" role="note">{prefixo} <strong>{titulo}</strong>: {explica}.</p>;
}
