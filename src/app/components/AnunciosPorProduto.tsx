"use client";

import { useState } from "react";
import Link from "next/link";

import { avaliarAnuncio, type LinhaDeAnuncio, type SituacaoDoAnuncio } from "@/lib/anuncioContraMargem";
import { EmptyState } from "./EmptyState";

/**
 * Anúncios por produto — o que o painel do canal não consegue mostrar.
 *
 * A Amazon sabe o que a campanha vendeu; ela NÃO sabe o custo do produto nem as
 * tarifas que cobrou depois. Aqui as duas metades se encontram, e por isso cada
 * coluna diz DE ONDE vem: ACOS e ROAS são "da Amazon" (gravados como a fonte
 * entrega, migration 0016) e a margem é "do NEXO". Sem esses rótulos, a
 * vendedora compararia com o painel deles e acharia que divergimos.
 *
 * ⚠️ Esta tela NOMEIA produto com prejuízo. É o que estava invisível.
 */

export interface AnuncioDeProduto extends LinhaDeAnuncio {
  productId: string;
  sku: string | null;
  title: string | null;
  impressions: number;
  clicks: number;
  roas: number | null;
  currency: string;
}

/** Pior caso primeiro — mas os bons continuam na lista (ver `VISIVEIS`). */
const PESO: Record<SituacaoDoAnuncio, number> = {
  "gasto-sem-venda": 0,
  "paga-para-vender": 1,
  "margem-desconhecida": 2,
  lucra: 3,
  "sem-atividade": 4,
};

/**
 * Quantas linhas antes do "ver todos".
 *
 * ⚠️ O corte é por TAMANHO, nunca por situação: a tela não pode virar só lista
 * de problema, senão deixa de ser leitura de operação e vira cobrança (decisão
 * do cérebro, 28/08/2026). Produto que lucra aparece junto — é a prova de que a
 * campanha está funcionando.
 */
const VISIVEIS = 8;

export function AnunciosPorProduto({
  linhas,
  contabilizadoAte,
  canal = "Amazon",
  baseDeProdutos = "/produtos",
}: {
  linhas: AnuncioDeProduto[];
  /** "Anúncio contabilizado até DD/MM — faltam N dias", quando a janela não fechou. */
  contabilizadoAte?: string | null;
  /** De onde vêm ACOS e ROAS. O painel é o mesmo nos canais; a origem muda. */
  canal?: string;
  /**
   * Onde se cadastra custo NESTE canal — cada um tem sua página, e o custo é
   * por (canal, SKU). Mandar a pessoa para a página do canal errado seria pior
   * que não linkar: ela cadastraria o custo no lugar que não afeta esta tela.
   */
  baseDeProdutos?: string;
}) {
  const [verTodos, setVerTodos] = useState(false);

  // ⚠️ TRÊS ESTADOS DE VAZIO, e eles NÃO significam a mesma coisa (28/08/2026).
  //
  // Um vazio genérico faria a vendedora ler defeito nosso onde há fato dela. O
  // caso que motivou: a conta de Mercado Livre da dona tem 10 anúncios
  // cadastrados e R$ 0,00 de gasto — anúncio existe, mas não veicula. Dizer
  // "nenhum produto anunciado" ali seria falso; dizer "carregando" seria pior.
  const semLinha = linhas.length === 0;
  const tudoZerado = !semLinha && linhas.every((linha) => linha.cost <= 0 && linha.clicks <= 0 && linha.impressions <= 0);
  if (semLinha || tudoZerado) {
    return (
      <section className="listing-table-shell channel-module-table-shell" aria-labelledby="ads-produto-titulo">
        <header><div><p className="section-kicker">Anúncios por produto</p><h2 id="ads-produto-titulo">Resultado por SKU anunciado</h2></div></header>
        {tudoZerado ? (
          <EmptyState
            compact
            title="Anúncios sem veiculação no período"
            description={`Há ${linhas.length} anúncio(s) cadastrado(s) nesta conta, mas nenhum recebeu impressão ou clique no período — não houve gasto. Ative ou ajuste as campanhas no ${canal} para elas voltarem a aparecer aqui.`}
          />
        ) : (
          <EmptyState
            compact
            title="Nenhum dado de anúncio no período"
            description={`A sincronização ainda não trouxe métricas de anúncio para este período. Quando trouxer, cada SKU aparece aqui com o ACOS do ${canal} ao lado da margem real do produto.`}
          />
        )}
      </section>
    );
  }

  const avaliadas = linhas
    .map((linha) => ({ linha, veredito: avaliarAnuncio(linha) }))
    .sort((a, b) => PESO[a.veredito.situacao] - PESO[b.veredito.situacao] || b.linha.cost - a.linha.cost);
  const visiveis = verTodos ? avaliadas : avaliadas.slice(0, VISIVEIS);

  return (
    <section className="listing-table-shell channel-module-table-shell" aria-labelledby="ads-produto-titulo">
      <header>
        <div>
          <p className="section-kicker">Anúncios por produto</p>
          <h2 id="ads-produto-titulo">Resultado por SKU anunciado</h2>
        </div>
        <p>{avaliadas.length} produto(s) anunciado(s)</p>
      </header>

      {/* A janela do gasto fica VISÍVEL AQUI, não só no card lá em cima: quem lê
          a tabela pode não ter lido o card (ajuste do cérebro, 28/08/2026). */}
      {contabilizadoAte && <p className="channel-module-method">{contabilizadoAte}.</p>}

      <div className="overflow-x-auto">
        <table className="listing-table channel-module-table">
          <caption className="sr-only">Desempenho de anúncio por produto, com a margem real de cada SKU</caption>
          <thead>
            <tr>
              <th scope="col">Produto</th>
              <th scope="col">Impressões</th>
              <th scope="col">Cliques</th>
              <th scope="col">Gasto</th>
              <th scope="col">Vendas atribuídas</th>
              {/* Os rótulos de origem são o que evita a leitura de "o NEXO
                  diverge do painel do canal": um lado é dele, o outro é nosso.
                  Por isso o nome do canal entra aqui, e não fica fixo. */}
              <th scope="col">ACOS <small>d{canal === "Amazon" ? "a" : "o"} {canal}</small></th>
              <th scope="col">ROAS <small>d{canal === "Amazon" ? "a" : "o"} {canal}</small></th>
              <th scope="col">Margem real <small>do NEXO: custo + tarifas</small></th>
              <th scope="col">Veredito</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map(({ linha, veredito }) => (
              <tr key={`${linha.productId}:${linha.sku ?? ""}`}>
                <td>
                  <strong className="block max-w-[280px] truncate" title={linha.title ?? undefined}>{linha.title ?? linha.productId}</strong>
                  {linha.sku && <small className="font-mono text-xs">{linha.sku}</small>}
                </td>
                <td className="tabular-nums">{inteiro(linha.impressions)}</td>
                <td className="tabular-nums">{inteiro(linha.clicks)}</td>
                <td className="tabular-nums">{dinheiro(linha.cost, linha.currency)}</td>
                {/* Venda atribuída com ZERO pedido não é "R$ 0,00 de venda": é
                    ausência de venda, e a coluna do lado já diz isso. */}
                <td className="tabular-nums">{linha.purchases > 0 ? `${dinheiro(linha.sales, linha.currency)} · ${linha.purchases}` : "—"}</td>
                {/* ⚠️ acos=0 vindo da fonte NÃO vira "0%": sem venda atribuída,
                    o número não significa desempenho (o zero que não é zero). */}
                <td className="tabular-nums">{linha.purchases > 0 && linha.acos != null ? percento(linha.acos) : "—"}</td>
                <td className="tabular-nums">{linha.purchases > 0 && linha.roas != null ? `${linha.roas.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—"}</td>
                <td className="tabular-nums">{linha.margemRealPct == null ? "—" : percento(linha.margemRealPct)}</td>
                <td>
                  <span className={`stock-status ${classeDoVeredito(veredito.situacao)}`}>{veredito.frase}</span>
                  {veredito.situacao === "margem-desconhecida" && linha.margemRealPct == null ? (
                    // Pendência com dono e link: cai NO produto, não na lista inteira.
                    <Link className="block text-xs" href={`${baseDeProdutos}?q=${encodeURIComponent(linha.sku ?? linha.productId)}`}>
                      Custo não cadastrado — cadastrar este produto <span aria-hidden="true">→</span>
                    </Link>
                  ) : veredito.acao ? (
                    <small className="block">{veredito.acao}</small>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {avaliadas.length > VISIVEIS && (
        <div className="listing-pagination">
          <button type="button" className="listing-refresh" onClick={() => setVerTodos((v) => !v)}>
            {verTodos ? `Mostrar só os ${VISIVEIS} primeiros` : `Ver todos os ${avaliadas.length} produtos`}
          </button>
        </div>
      )}
    </section>
  );
}

function classeDoVeredito(situacao: SituacaoDoAnuncio): string {
  if (situacao === "gasto-sem-venda" || situacao === "paga-para-vender") return "is-critical";
  if (situacao === "lucra") return "is-ok";
  return "is-idle";
}

function percento(valor: number): string {
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function inteiro(valor: number): string {
  return valor.toLocaleString("pt-BR");
}

function dinheiro(valor: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(valor);
}
