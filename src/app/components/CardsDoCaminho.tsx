"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { ordenaPorMargem } from "./caminhoDoDinheiro";

/**
 * OS CARDS DO CAMINHO DO DINHEIRO — a casca comum e os tres do canvas.
 *
 * ⚠️ NENHUM DELES CALCULA. Valores chegam formatados e as contas moram em
 * `caminhoDoDinheiro.ts`, onde da para testa-las pelo comportamento. A unica
 * coisa que estas pecas decidem e ORDEM e FORMA.
 */

export function CardDoCaminho({ titulo, meta, children, rodape }: {
  titulo: string;
  /** A linha da direita do cabecalho: contagem, escopo ou alternador. */
  meta?: ReactNode;
  children: ReactNode;
  rodape?: ReactNode;
}) {
  return (
    <section className="card-caminho">
      <header className="card-cab">
        <h2>{titulo}</h2>
        {meta ? <span className="card-meta">{meta}</span> : null}
      </header>
      {children}
      {rodape}
    </section>
  );
}

/* ── 1. DE ONDE VEIO A VENDA ─────────────────────────────────────────────── */

export type OrdemDoRanking = "faturamento" | "unidades" | "margem";

export interface ProdutoDoRanking {
  id: string;
  titulo: string;
  /** Ja formatado: "55 un". */
  unidades: string;
  /** Ja formatado: "1.583,50". */
  faturamento: string;
  marginPct: number | null;
  /** So para ordenar; nunca vai para a tela. */
  ordemFaturamento: number;
  ordemUnidades: number;
}

/**
 * O ranking, com o alternador do canvas.
 *
 * ⚠️ ORDENAR POR MARGEM POE O DESCONHECIDO NO FIM, MARCADO — e nao entre os
 * piores. `null` ordenado como 0% acusaria de prejuizo um produto sobre o qual
 * nada se sabe; a vendedora leria "este e o pior" quando a verdade e "este eu
 * nao cadastrei". A regra vive em `ordenaPorMargem`, testada com `null` no meio
 * da lista.
 */
export function RankingDaVenda({ produtos, ordemInicial = "faturamento", vazio }: {
  produtos: ProdutoDoRanking[];
  ordemInicial?: OrdemDoRanking;
  vazio: string;
}) {
  const [ordem, setOrdem] = useState<OrdemDoRanking>(ordemInicial);

  const ordenados = ordem === "margem"
    ? ordenaPorMargem(produtos)
    : [...produtos].sort((a, b) =>
        ordem === "unidades" ? b.ordemUnidades - a.ordemUnidades : b.ordemFaturamento - a.ordemFaturamento);

  const opcoes: Array<[OrdemDoRanking, string]> = [
    ["faturamento", "faturamento"],
    ["unidades", "unidades"],
    ["margem", "margem"],
  ];

  return (
    <CardDoCaminho
      titulo="De onde veio a venda"
      meta={
        <span className="card-alternador" role="group" aria-label="Ordenar por">
          {opcoes.map(([valor, rotulo], indice) => (
            <span key={valor}>
              {indice > 0 ? <i aria-hidden="true"> · </i> : null}
              <button
                type="button"
                aria-pressed={ordem === valor}
                className={ordem === valor ? "is-ativo" : ""}
                onClick={() => setOrdem(valor)}
              >
                {rotulo}
              </button>
            </span>
          ))}
        </span>
      }
    >
      {ordenados.length === 0 ? <p className="card-vazio">{vazio}</p> : (
        <table className="card-ranking">
          <tbody>
            {ordenados.map((produto, indice) => (
              <tr key={produto.id}>
                <td className="rk-pos">{indice + 1}</td>
                {/* Uma linha com reticencias; o texto inteiro no `title`. */}
                <td className="rk-nome" title={produto.titulo}>{produto.titulo}</td>
                <td className="rk-un">{produto.unidades}</td>
                <td className="rk-val">{produto.faturamento}</td>
                <td className={`rk-mg${produto.marginPct == null ? " is-desconhecida" : produto.marginPct < 0 ? " is-negativa" : " is-positiva"}`}>
                  {/* ⚠️ Sem custo cadastrado, a margem e AUSENCIA — traco,
                      nunca 0%. Um zero aqui viraria "vendeu sem lucrar". */}
                  {produto.marginPct == null
                    ? "—"
                    : `${produto.marginPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </CardDoCaminho>
  );
}

/* ── 2. O QUE O CUSTO ESCONDE ────────────────────────────────────────────── */

export interface ComponenteDoCusto {
  id: string;
  rotulo: string;
  /** Ja formatado, ou "—" quando desconhecido. */
  valor: string;
  /** Fracao da venda, 0–100. `null` = sem divisor valido; a celula fica vazia. */
  sobreAVendaPct: number | null;
  /** A situacao, curta e com numero quando ha o que apontar. */
  situacao: string;
  tomDaSituacao?: "ok" | "acao" | "atencao" | "neutro";
  /** A cor da fatia na barra. Fatia sem valor conhecido nao entra na barra. */
  cor: string;
}

/**
 * A decomposicao do custo, com a barra de proporcao em cima.
 *
 * ⚠️ A BARRA OMITE O QUE NAO SE SABE. Parcela desconhecida nao vira fatia — uma
 * barra que soma o que ninguem apurou mente com a autoridade de um desenho, e a
 * soma das larguras deixaria de bater com a conta ao lado.
 */
export function DecomposicaoDoCusto({ componentes, sobreQuanto, explicacao, sobrouPct, sobrouRotulo }: {
  componentes: ComponenteDoCusto[];
  /** "sobre R$ 2.819,90 vendidos" */
  sobreQuanto: string;
  explicacao: ReactNode;
  /**
   * A fatia verde do fim, em pontos percentuais. `null` quando a conta NAO
   * fecha — e ai o branco que sobra na barra e o desconhecido. Quem decide isso
   * e `fatiaDoSobrou`, no modulo testado.
   */
  sobrouPct?: number | null;
  sobrouRotulo?: string;
}) {
  const naBarra = componentes.filter((c) => c.sobreAVendaPct != null && c.sobreAVendaPct > 0);

  return (
    <CardDoCaminho titulo="O que o custo esconde" meta={sobreQuanto}>
      {naBarra.length > 0 && (
        <div className="card-cascata" aria-hidden="true">
          {naBarra.map((c) => (
            <i key={c.id} style={{ width: `${c.sobreAVendaPct}%`, background: c.cor }} title={c.rotulo} />
          ))}
          {/* A fatia verde so aparece quando a conta fecha; ver `fatiaDoSobrou`. */}
          {sobrouPct == null ? null : (
            <i style={{ width: `${sobrouPct}%`, background: "var(--ml-verde)" }} title={sobrouRotulo ?? "Sobrou"} />
          )}
        </div>
      )}
      <p className="card-explica">{explicacao}</p>
      <table className="card-tabela">
        <thead>
          <tr>
            <th scope="col">Componente</th>
            <th scope="col" className="dir">Valor</th>
            <th scope="col" className="dir">Sobre a venda</th>
            <th scope="col">Situação</th>
          </tr>
        </thead>
        <tbody>
          {componentes.map((c) => (
            <tr key={c.id}>
              <td>
                <span className="card-marca" aria-hidden="true" style={{ background: c.cor }} />
                {c.rotulo}
              </td>
              <td className="dir num">{c.valor}</td>
              {/* Sem divisor valido nao ha porcentagem: celula vazia, nunca NaN%. */}
              <td className="dir num">{c.sobreAVendaPct == null ? "—" : `${c.sobreAVendaPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</td>
              <td><span className={`card-tag is-${c.tomDaSituacao ?? "neutro"}`}>{c.situacao}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardDoCaminho>
  );
}

/* ── 3. QUANTO SOBROU EM CADA VENDA ──────────────────────────────────────── */

export interface VendaDaTabela {
  id: string;
  produto: string;
  /** "#…927990" — o final do numero, como no canvas. */
  pedido: string;
  venda: string;
  custos: string;
  sobrou: string;
  marginPct: number | null;
  /** `true` quando o resultado da venda e negativo. */
  negativa?: boolean;
}

export function TabelaDeVendas({ vendas, escopo, rodape, vazio }: {
  vendas: VendaDaTabela[];
  /** "81 de 81 com cálculo completo" */
  escopo: ReactNode;
  rodape?: ReactNode;
  vazio: string;
}) {
  return (
    <CardDoCaminho titulo="Quanto sobrou em cada venda" meta={escopo} rodape={rodape}>
      {vendas.length === 0 ? <p className="card-vazio">{vazio}</p> : (
        <table className="card-tabela">
          <thead>
            <tr>
              <th scope="col">Produto</th>
              <th scope="col">Pedido</th>
              <th scope="col" className="dir">Venda</th>
              <th scope="col" className="dir">Custos</th>
              <th scope="col" className="dir">Sobrou</th>
              <th scope="col" className="dir">Margem</th>
            </tr>
          </thead>
          <tbody>
            {vendas.map((venda) => (
              <tr key={venda.id}>
                <td className="tb-nome" title={venda.produto}>{venda.produto}</td>
                <td className="tb-ped">{venda.pedido}</td>
                <td className="dir num">{venda.venda}</td>
                <td className="dir num">{venda.custos}</td>
                <td className={`dir num${venda.negativa ? " is-negativa" : ""}`}>{venda.sobrou}</td>
                <td className={`dir num${venda.marginPct == null ? " is-desconhecida" : venda.marginPct < 0 ? " is-negativa" : ""}`}>
                  {venda.marginPct == null
                    ? "—"
                    : `${venda.marginPct.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </CardDoCaminho>
  );
}

/* ── 4. RITMO DOS ULTIMOS 7 DIAS ─────────────────────────────────────────── */

export type SerieDoRitmo = "lucro" | "faturamento" | "pedidos" | "unidades";

export interface DiaDoRitmo {
  id: string;
  /** "seg", "hoje" — quem chama decide, porque so ele sabe que dia e hoje. */
  rotulo: string;
  destaque: boolean;
  /**
   * Uma entrada por serie. `valor` `null` = desconhecido: NAO desenha coluna.
   * `compacto` e o rotulo curto em cima; `completo` e o nome acessivel.
   */
  series: Record<SerieDoRitmo, { valor: number | null; compacto: string; completo: string }>;
}

/**
 * O RITMO — a mesma semana por quatro angulos, num alternador so.
 *
 * ⚠️ O CORTE APROVADO FOI "2 GRAFICOS -> 1 COM ALTERNADOR". Antes a
 * pagina tinha o lucro por dia e o grafico de evolucao dizendo coisas parecidas
 * em dois lugares; agora e um bloco que troca de serie. Isso so foi possivel
 * porque o contrato do backend passou a entregar `profit` por dia — sem ele,
 * "lucro" seria a unica opcao sem dado.
 *
 * ⚠️ E A REGRA DO `null` VALE POR SERIE, nao pelo bloco. Um dia pode ter
 * faturamento conhecido e lucro desconhecido ao mesmo tempo: no "faturamento"
 * ele desenha coluna, no "lucro" ele mostra o traco. Amarrar a ausencia ao dia
 * em vez de ao par dia+serie apagaria colunas que existem.
 */
export function RitmoDosDias({ dias, serieInicial = "lucro" }: {
  dias: DiaDoRitmo[];
  serieInicial?: SerieDoRitmo;
}) {
  const [serie, setSerie] = useState<SerieDoRitmo>(serieInicial);
  if (dias.length === 0) return null;

  // A escala sai do maior valor CONHECIDO da serie exibida: um dia sem dado nao
  // pode encolher os outros, porque ele nao tem tamanho.
  const maior = Math.max(...dias.map((dia) => {
    const valor = dia.series[serie].valor;
    return valor == null ? 0 : Math.abs(valor);
  }), 0);

  const opcoes: Array<[SerieDoRitmo, string]> = [
    ["lucro", "lucro"],
    ["faturamento", "faturamento"],
    ["pedidos", "pedidos"],
    ["unidades", "unidades"],
  ];

  return (
    <CardDoCaminho
      titulo="Ritmo dos últimos 7 dias"
      meta={
        <span className="card-alternador" role="group" aria-label="Série do gráfico">
          {opcoes.map(([valor, rotulo], indice) => (
            <span key={valor}>
              {indice > 0 ? <i aria-hidden="true"> · </i> : null}
              <button
                type="button"
                aria-pressed={serie === valor}
                className={serie === valor ? "is-ativo" : ""}
                onClick={() => setSerie(valor)}
              >
                {rotulo}
              </button>
            </span>
          ))}
        </span>
      }
    >
      <ol className="ritmo-colunas">
        {dias.map((dia) => {
          const { valor, compacto, completo } = dia.series[serie];
          const fracao = maior > 0 && valor != null ? Math.abs(valor) / maior : 0;
          const negativo = valor != null && valor < 0;
          return (
            <li
              key={dia.id}
              className={`ritmo-coluna${dia.destaque ? " is-destaque" : ""}${valor == null ? " is-desconhecido" : ""}${negativo ? " is-negativo" : ""}`}
              aria-label={completo}
            >
              <span className="ritmo-valor" aria-hidden="true">{compacto}</span>
              <span className="ritmo-barra" style={{ "--fracao": fracao } as CSSProperties} aria-hidden="true" />
              <span className="ritmo-dia" aria-hidden="true">{dia.rotulo}</span>
            </li>
          );
        })}
      </ol>
    </CardDoCaminho>
  );
}

/* ── 5. ANUNCIOS PAGOS ───────────────────────────────────────────────────── */

export interface AnuncioDaTabela {
  id: string;
  produto: string;
  /** Ja formatados por quem chama. "—" quando a fonte nao informou. */
  impressoes: string;
  cliques: string;
  gasto: string;
  /** "R$ 75,80 · 2" ou o texto de ausencia ("sem venda"). */
  vendasAtribuidas: string;
  /** `true` quando nao houve venda atribuida: as colunas de retorno ficam vazias. */
  semVenda: boolean;
  acos: string;
  roas: string;
  marginPct: number | null;
}

/**
 * ANUNCIOS PAGOS — o gasto de midia ao lado da margem real do produto.
 *
 * ⚠️ TACOS NAO E ACOS, e a diferenca e a pergunta que cada um responde.
 * ACOS e gasto sobre a venda que O ANUNCIO gerou — mede se aquele anuncio se
 * pagou. TACOS e sobre o faturamento INTEIRO da loja — mede dependencia de
 * midia. Rotular um com o nome do outro troca a pergunta sem trocar o numero.
 *
 * ⚠️ E O QUE ESTA AQUI NAO ESTA NO LUCRO. No Mercado Livre o seller
 * desconta o anuncio depois, no fechamento dele, e a decisao da Ana de
 * 30/08/2026 e que o lucro do canal NAO subtrai esse gasto. O card divide; o
 * lucro nao subtrai. Se o texto der a entender o contrario, ele contradiz a
 * faixa de 4 etapas logo acima.
 *
 * ⚠️ A COLUNA QUE JUSTIFICA O CARD E A "MARGEM REAL": ACOS e ROAS vem do
 * Mercado Livre e falam da venda atribuida; a margem real cruza o gasto com o
 * custo e as tarifas que so o NEXO conhece. E a unica coluna que responde "o
 * anuncio valeu".
 */
export function AnunciosPagos({ titulo, resumo, anuncios, explicacao, rodape, vazio }: {
  titulo: string;
  /** "85 SKUs · gasto R$ 34,99 · vendas atribuídas R$ 75,80 · TACOS 1,24%" */
  resumo: ReactNode;
  anuncios: AnuncioDaTabela[];
  explicacao: ReactNode;
  rodape?: ReactNode;
  vazio: string;
}) {
  return (
    <CardDoCaminho titulo={titulo} meta={resumo} rodape={rodape}>
      <p className="card-explica">{explicacao}</p>
      {anuncios.length === 0 ? <p className="card-vazio">{vazio}</p> : (
        <table className="card-tabela card-tabela-ads">
          <thead>
            <tr>
              <th scope="col">Produto</th>
              <th scope="col" className="dir">Impressões</th>
              <th scope="col" className="dir">Cliques</th>
              <th scope="col" className="dir">Gasto</th>
              <th scope="col" className="dir">Vendas atribuídas</th>
              <th scope="col" className="dir">ACOS</th>
              <th scope="col" className="dir">ROAS</th>
              <th scope="col" className="dir">Margem real</th>
            </tr>
          </thead>
          <tbody>
            {anuncios.map((anuncio) => (
              <tr key={anuncio.id}>
                <td className="tb-nome" title={anuncio.produto}>{anuncio.produto}</td>
                <td className="dir num">{anuncio.impressoes}</td>
                <td className="dir num">{anuncio.cliques}</td>
                <td className="dir num">{anuncio.gasto}</td>
                {/* ⚠️ SEM VENDA ATRIBUIDA, o texto ocupa as tres colunas
                    de retorno em vez de escrever "0%" em cada uma. Zero de ACOS
                    seria lido como "otimo", quando o fato e que nao houve venda
                    para dividir — sao coisas opostas. */}
                {anuncio.semVenda ? (
                  <td className="dir ads-sem-venda" colSpan={3}>{anuncio.vendasAtribuidas}</td>
                ) : (
                  <>
                    <td className="dir num">{anuncio.vendasAtribuidas}</td>
                    <td className="dir num">{anuncio.acos}</td>
                    <td className="dir num">{anuncio.roas}</td>
                  </>
                )}
                <td className={`dir num${anuncio.marginPct == null ? " is-desconhecida" : anuncio.marginPct < 0 ? " is-negativa" : ""}`}>
                  {anuncio.marginPct == null
                    ? "—"
                    : `${anuncio.marginPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </CardDoCaminho>
  );
}
