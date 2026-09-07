"use client";

import { useState, type ReactNode } from "react";
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
export function DecomposicaoDoCusto({ componentes, sobreQuanto, explicacao }: {
  componentes: ComponenteDoCusto[];
  /** "sobre R$ 2.819,90 vendidos" */
  sobreQuanto: string;
  explicacao: ReactNode;
}) {
  const naBarra = componentes.filter((c) => c.sobreAVendaPct != null && c.sobreAVendaPct > 0);

  return (
    <CardDoCaminho titulo="O que o custo esconde" meta={sobreQuanto}>
      {naBarra.length > 0 && (
        <div className="card-cascata" aria-hidden="true">
          {naBarra.map((c) => (
            <i key={c.id} style={{ width: `${c.sobreAVendaPct}%`, background: c.cor }} title={c.rotulo} />
          ))}
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
