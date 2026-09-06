import { ChipDeMargem } from "./ChipDeMargem";

/**
 * LINHA DE TOP PRODUTO — uma entrada da lista da direita da faixa.
 *
 * ⚠️ O TITULO E UMA LINHA SO, com reticencias, e o `min-width: 0` do CSS e o
 * que faz isso funcionar num item flex: sem ele o item nao encolhe abaixo do
 * proprio conteudo, a linha estica e a lista vaza para fora da coluna. O texto
 * inteiro fica no atributo `title`, senao o corte esconde qual produto e.
 *
 * Valores chegam FORMATADOS: moeda e locale sao decisao de quem monta a tela,
 * nao da peca. E o mesmo contrato do resto do sistema.
 */
export interface LinhaDeTopProdutoProps {
  posicao: number;
  titulo: string;
  /** Ja formatado: "30 un." */
  unidades: string;
  /** Ja formatado: "R$ 867,00" */
  faturamento: string;
  margemPct: number | null;
}

export function LinhaDeTopProduto({ posicao, titulo, unidades, faturamento, margemPct }: LinhaDeTopProdutoProps) {
  return (
    <li>
      <span className="top-faixa-rank" aria-hidden="true">{posicao}</span>
      <span className="top-faixa-titulo" title={titulo}>{titulo}</span>
      <span className="top-faixa-unidades">{unidades}</span>
      <strong className="top-faixa-valor">{faturamento}</strong>
      <ChipDeMargem margemPct={margemPct} />
    </li>
  );
}

/** A lista com o cabecalho e o rodape — a coluna direita inteira da faixa. */
export function ListaDeTopProdutos({ titulo, contagem, acao, linhas, vazio }: {
  titulo: string;
  /** "8 produtos" — ja pluralizado por quem chama. */
  contagem: string;
  /** O link "Ver produtos →". Entra como no, para o pacote nao depender de rota. */
  acao?: React.ReactNode;
  linhas: LinhaDeTopProdutoProps[];
  vazio: string;
}) {
  return (
    <section className="top-faixa" aria-label={titulo}>
      <header className="top-faixa-cabecalho">
        <p className="cockpit-kicker">{titulo}</p>
        <p className="top-faixa-meta">{contagem}{acao ? <> · {acao}</> : null}</p>
      </header>
      {linhas.length === 0 ? (
        <p className="top-faixa-vazio">{vazio}</p>
      ) : (
        <>
          <ol className="top-faixa-lista">
            {linhas.map((linha) => <LinhaDeTopProduto key={linha.posicao} {...linha} />)}
          </ol>
          <p className="top-faixa-nota">Margem depende do custo cadastrado; valor desconhecido continua “—”.</p>
        </>
      )}
    </section>
  );
}
