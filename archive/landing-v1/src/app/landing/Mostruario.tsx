"use client";

import { useEntradaEmLoop } from "./entradaEmLoop";

/**
 * UI do produto renderizada em HTML — o que faz o dub.co e o midday.ai
 * funcionarem. Print não serve: não escala, não tem movimento e envelhece.
 *
 * Os números aqui são os REAIS da operação (16/08/2026), não `lorem` nem valor
 * redondo inventado: R$ 39,80 de faturamento com R$ 2,21 de cupom, saldo de
 * −R$ 6,12 com liberação em 18 e 24/08. Landing que mostra número falso ensina
 * o visitante a não confiar no que a tela do produto vai dizer depois.
 *
 * Cada tela tem a SUA animação, como no dub — e ela conta o que aquela parte do
 * produto faz: o saldo revela primeiro o que está retido e depois cada data de
 * liberação; a auditoria compara linha a linha até parar na que não fecha.
 * Técnica de loop do midday, igual às outras (`AnimacaoConciliacao.tsx`).
 */

/** Pilar 2 — saldo e o cronograma de liberação, com datas de verdade. */
export function MostraSaldo() {
  // 2 cartões + 2 liberações.
  const visiveis = useEntradaEmLoop(4, 320, 8000);

  return (
    <div className="lp-ui" aria-hidden="true">
      <div className="lp-ui-topo"><span /><span /><span /><em>Saldo na Amazon</em></div>
      <div className="lp-saldo-cards">
        <div className={`is-cobranca${visiveis > 0 ? " is-visivel" : ""}`}>
          <small>Disponível agora</small>
          <strong>− R$ 6,12</strong>
          <em>a Amazon cobra no fechamento</em>
        </div>
        <div className={visiveis > 1 ? "is-visivel" : ""}>
          <small>Retido</small>
          <strong>R$ 39,80</strong>
          <em>libera entre 18 e 24/08</em>
        </div>
      </div>
      <ol className="lp-liberacoes">
        <li className={visiveis > 2 ? "is-visivel" : ""}>
          <span>18/08</span><strong>R$ 19,90</strong><small>1 pedido</small>
        </li>
        <li className={visiveis > 3 ? "is-visivel" : ""}>
          <span>24/08</span><strong>R$ 19,90</strong><small>1 pedido</small>
        </li>
      </ol>
    </div>
  );
}

type LinhaAuditoria = {
  pedido: string;
  origem: string;
  previsto: string;
  cobrado: string;
  diferenca: string;
  bate: boolean;
};

const AUDITADOS: LinhaAuditoria[] = [
  {
    pedido: "2000017874507858",
    origem: "você R$ 6,65 + comprador R$ 16,99",
    previsto: "R$ 23,64", cobrado: "R$ 23,64", diferenca: "bate", bate: true,
  },
  {
    pedido: "2000017961842033",
    origem: "você R$ 8,05 + comprador R$ 0,00",
    previsto: "R$ 8,05", cobrado: "R$ 14,41", diferenca: "+ R$ 6,36", bate: false,
  },
  {
    pedido: "2000017952118470",
    origem: "você R$ 6,65 + comprador R$ 10,99",
    previsto: "R$ 17,64", cobrado: "R$ 17,64", diferenca: "bate", bate: true,
  },
];

/** Pilar 3 — a auditoria, mostrando as duas fontes lado a lado. */
export function MostraAuditoria() {
  // Passo mais longo que o do saldo: aqui a graça é ver a comparação acontecer.
  const visiveis = useEntradaEmLoop(AUDITADOS.length, 620, 8000);

  return (
    <div className="lp-ui" aria-hidden="true">
      <div className="lp-ui-topo"><span /><span /><span /><em>Pedidos a revisar</em></div>
      <div className="lp-tabela-scroll">
        <table className="lp-tabela">
          <thead>
            <tr><th>Pedido</th><th>Previsto</th><th>Cobrado</th><th>Diferença</th></tr>
          </thead>
          <tbody>
            {AUDITADOS.map((linha, i) => (
              <tr key={linha.pedido} className={i < visiveis ? "is-visivel" : ""}>
                <td>{linha.pedido}<small>{linha.origem}</small></td>
                <td>{linha.previsto}</td>
                <td>{linha.cobrado}</td>
                <td className={linha.bate ? "is-ok" : "is-alerta"}>{linha.diferenca}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lp-tabela-nota">Só entra na lista quando as duas pontas não fecham.</p>
    </div>
  );
}
