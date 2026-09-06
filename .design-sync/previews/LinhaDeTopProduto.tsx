import { LinhaDeTopProduto } from "@nexo/ds";

// Uma linha do ranking, no seu trilho real (ol.top-faixa-lista, dentro de
// .cockpit-faixa — onde --ml-verde existe).
export function ComMargemPositiva() {
  return (
    <div className="cockpit-faixa" style={{ border: 0 }}>
      <ol className="top-faixa-lista" style={{ width: "100%" }}>
        <LinhaDeTopProduto posicao={1} titulo="Produto de exemplo C" unidades="4 un." faturamento="R$ 230,00" margemPct={19.2} />
      </ol>
    </div>
  );
}

export function SemCustoCadastrado() {
  return (
    <div className="cockpit-faixa" style={{ border: 0 }}>
      <ol className="top-faixa-lista" style={{ width: "100%" }}>
        <LinhaDeTopProduto posicao={4} titulo="Produto de exemplo D (sem custo cadastrado)" unidades="2 un." faturamento="R$ 80,00" margemPct={null} />
      </ol>
    </div>
  );
}
