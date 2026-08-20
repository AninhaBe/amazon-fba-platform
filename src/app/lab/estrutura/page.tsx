"use client";

import { useState } from "react";
import { Metric } from "@/app/components/Metric";

/**
 * BANCADA DE ESTRUTURA — a anatomia de uma tela de dado do NEXO, montada com os
 * componentes DE PRODUÇÃO, lado a lado com a do peec.ai.
 *
 * Existe pelo mesmo motivo da `/lab/rail`: as 45 telas de dado estão atrás da
 * sessão, e conferir um ajuste de estrutura não pode depender de estar logado.
 *
 * A diferença para `/lab/identidade` é o que está em jogo. Lá a pergunta era de
 * paleta e tipografia; aqui é de ANATOMIA — quantos pixels o número principal
 * tem, se o KPI mora num card ou numa faixa, onde a barra de filtro fica, o que
 * separa uma linha de tabela da seguinte. Trocar a cor de um card não muda a
 * leitura da tela; trocar 27px por 16px muda.
 *
 * O que o peec.ai faz e que esta tela passou a fazer:
 *
 *   1. O número principal tem 16px, não 27px. Quem carrega o peso é a frase
 *      editorial acima da faixa, não o dígito. Um dashboard inteiro de números
 *      grandes não tem hierarquia nenhuma — tudo grita igual.
 *   2. KPI não é card. É uma faixa contínua dividida por filete vertical de 8%,
 *      com ~70px de altura em vez de 126px. Cabe mais tela útil acima da dobra.
 *   3. A variação vai em MONO; o valor fica na sans. Dígito que muda e dígito
 *      que descreve são coisas diferentes e a fonte diz isso.
 *   4. Filtro é uma fila de pills de 28px logo abaixo do topo, não um controle
 *      solto no meio do conteúdo.
 *   5. Tabela: header de 40px em `#f6f6f6`, linha de 41px, número tabular à
 *      direita, e travessão no lugar de célula vazia.
 */

const FILTROS = ["Todo período", "Todos os canais", "Todas as contas", "Todos os produtos"];

const LINHAS = [
  { origem: "Martelo de borracha", tipo: "FBA", unidades: "12", receita: "R$ 334,80", lucro: "R$ 61,49", margem: "18,4%" },
  { origem: "Kit clips 320", tipo: "FBA", unidades: "8", receita: "R$ 191,20", lucro: "R$ 44,10", margem: "23,1%" },
  { origem: "Protetor de pé", tipo: "FBM", unidades: "5", receita: "R$ 108,34", lucro: null, margem: null },
  { origem: "Protetor 4cm", tipo: "FBA", unidades: "3", receita: "R$ 71,70", lucro: "R$ 12,08", margem: "16,8%" },
];

const DOMINIOS = [
  { nome: "Amazon", valor: 55, exibicao: "R$ 1.204,50" },
  { nome: "Mercado Livre", valor: 36, exibicao: "R$ 788,20" },
  { nome: "Shopee", valor: 22, exibicao: "R$ 481,60" },
  { nome: "TikTok Shop", valor: 9, exibicao: "R$ 197,00" },
];

export default function LabEstrutura() {
  const [filtroAtivo, setFiltroAtivo] = useState<string | null>(null);
  const maior = Math.max(...DOMINIOS.map((d) => d.valor));

  return (
    <div className="lab-estrutura">
      <header className="lab-estrutura-topo">
        <p className="lab-estrutura-crumb">
          <span>Amazon</span>
          <span aria-hidden="true">›</span>
          <strong>Visão do canal</strong>
        </p>
        <p className="lab-estrutura-aviso">
          Bancada de estrutura. Componentes de produção, dados estáticos.
        </p>
      </header>

      {/* 4 — filtro é fila de pills logo abaixo do topo */}
      <div className="filter-bar" role="group" aria-label="Filtros">
        {FILTROS.map((f) => (
          <button
            key={f}
            type="button"
            className={`filter-pill${filtroAtivo === f ? " is-active" : ""}`}
            onClick={() => setFiltroAtivo((atual) => (atual === f ? null : f))}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="lab-estrutura-corpo">
        {/* 1 — a frase carrega o peso, não o dígito */}
        <section className="section-lead">
          <h1>Seu lucro caiu 8% e a culpa é do frete</h1>
          <p>Três produtos venderam mais e sobrou menos. A tarifa de logística subiu nos dois com maior giro.</p>
        </section>

        {/* 2 e 3 — faixa de KPI, não grade de cards */}
        <div className="metric-grid" role="group" aria-label="Indicadores do período">
          <Metric label="Faturamento" value="R$ 1.204,50" sub="28 vendas no período" />
          <Metric label="Taxas" value="R$ 218,74" sub="18,2% do faturamento" />
          <Metric label="Custo dos produtos" value="R$ 612,30" sub="Total do período" />
          <Metric label="Lucro" value="R$ 373,46" sub="31,0% de margem" tone="positive" />
        </div>

        {/* 5 — tabela */}
        <section className="lab-estrutura-bloco">
          <div className="lab-estrutura-bloco-topo">
            <h2>Rentabilidade por produto</h2>
            <button type="button" className="filter-pill">Ver todos</button>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Logística</th>
                  <th className="num">Unidades</th>
                  <th className="num">Receita</th>
                  <th className="num">Lucro</th>
                  <th className="num">Margem</th>
                </tr>
              </thead>
              <tbody>
                {LINHAS.map((l) => (
                  <tr key={l.origem}>
                    <td>{l.origem}</td>
                    <td><span className="data-chip">{l.tipo}</span></td>
                    <td className="num">{l.unidades}</td>
                    <td className="num">{l.receita}</td>
                    {/* travessão, não célula vazia: ausência de custo é "não sei",
                        e o dashboard tem que dizer isso em vez de mostrar zero */}
                    <td className="num">{l.lucro ?? <span className="is-empty">—</span>}</td>
                    <td className="num">{l.margem ?? <span className="is-empty">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* a barra É o fundo da linha — não um gráfico separado */}
        <section className="lab-estrutura-bloco">
          <div className="lab-estrutura-bloco-topo">
            <h2>Faturamento por canal</h2>
            <span className="lab-estrutura-nota">No período</span>
          </div>
          <div className="rank-list">
            {DOMINIOS.map((d) => (
              <div className="rank-row" key={d.nome}>
                <div className="rank-track">
                  <span className="rank-fill" style={{ width: `${(d.valor / maior) * 100}%` }} />
                  <span className="rank-label">{d.nome}</span>
                </div>
                <span className="rank-value">{d.exibicao}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
