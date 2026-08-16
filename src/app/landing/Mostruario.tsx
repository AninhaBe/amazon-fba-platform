/**
 * UI do produto renderizada em HTML — o que faz o dub.co e o midday.ai
 * funcionarem. Print não serve: não escala, não tem movimento e envelhece.
 *
 * Os números aqui são os REAIS da operação (16/08/2026), não `lorem` nem valor
 * redondo inventado: R$ 39,80 de faturamento com R$ 2,21 de cupom, saldo de
 * −R$ 6,12 com liberação em 18 e 24/08. Landing que mostra número falso ensina
 * o visitante a não confiar no que a tela do produto vai dizer depois.
 */

/** Pilar 1 — a cascata financeira, com o cupom aparecendo como dedução real. */
export function MostraFinanceiro() {
  const linhas: Array<[string, string, string?]> = [
    ["Faturamento (preço de tabela)", "R$ 42,01"],
    ["Cupons e promoções", "− R$ 2,21", "menos"],
    ["Faturamento líquido", "= R$ 39,80", "subtotal"],
    ["Taxas Amazon", "− R$ 6,12", "menos"],
    ["Custo dos produtos", "− R$ 13,64", "menos"],
  ];
  return (
    <div className="lp-ui" aria-hidden="true">
      <div className="lp-ui-topo"><span /><span /><span /><em>Financeiro conciliado</em></div>
      <div className="lp-fluxo">
        {linhas.map(([rotulo, valor, tipo]) => (
          <div key={rotulo} className={tipo === "subtotal" ? "is-subtotal" : ""}>
            <span>{rotulo}</span>
            <strong className={tipo === "menos" ? "is-menos" : ""}>{valor}</strong>
          </div>
        ))}
        <div className="is-resultado">
          <span>Lucro estimado</span>
          <strong>R$ 20,04</strong>
        </div>
        <div className="is-margem"><span>Margem</span><strong>50,4%</strong></div>
      </div>
    </div>
  );
}

/** Pilar 2 — saldo e o cronograma de liberação, com datas de verdade. */
export function MostraSaldo() {
  return (
    <div className="lp-ui" aria-hidden="true">
      <div className="lp-ui-topo"><span /><span /><span /><em>Saldo na Amazon</em></div>
      <div className="lp-saldo-cards">
        <div className="is-cobranca">
          <small>Disponível agora</small>
          <strong>− R$ 6,12</strong>
          <em>a Amazon cobra no fechamento</em>
        </div>
        <div>
          <small>Retido</small>
          <strong>R$ 39,80</strong>
          <em>libera entre 18 e 24/08</em>
        </div>
      </div>
      <ol className="lp-liberacoes">
        <li><span>18/08</span><strong>R$ 19,90</strong><small>1 pedido</small></li>
        <li><span>24/08</span><strong>R$ 19,90</strong><small>1 pedido</small></li>
      </ol>
    </div>
  );
}

/** Pilar 3 — a auditoria, mostrando as duas fontes lado a lado. */
export function MostraAuditoria() {
  return (
    <div className="lp-ui" aria-hidden="true">
      <div className="lp-ui-topo"><span /><span /><span /><em>Pedidos a revisar</em></div>
      <table className="lp-tabela">
        <thead>
          <tr><th>Pedido</th><th>Previsto</th><th>Cobrado</th><th>Diferença</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>2000017874507858<small>você R$ 6,65 + comprador R$ 16,99</small></td>
            <td>R$ 23,64</td><td>R$ 23,64</td><td className="is-ok">bate</td>
          </tr>
          <tr>
            <td>2000017961842033<small>você R$ 8,05 + comprador R$ 0,00</small></td>
            <td>R$ 8,05</td><td>R$ 14,41</td><td className="is-alerta">+ R$ 6,36</td>
          </tr>
          <tr>
            <td>2000017952118470<small>você R$ 6,65 + comprador R$ 10,99</small></td>
            <td>R$ 17,64</td><td>R$ 17,64</td><td className="is-ok">bate</td>
          </tr>
        </tbody>
      </table>
      <p className="lp-tabela-nota">Só entra na lista quando as duas pontas não fecham.</p>
    </div>
  );
}
