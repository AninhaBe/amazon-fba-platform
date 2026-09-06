import { ListaDeTopProdutos } from "@nexo/ds";

const PRODUTOS = [
  { posicao: 1, titulo: "Produto de exemplo A — nome longo o bastante para ser cortado pelas reticências", unidades: "30 un.", faturamento: "R$ 900,00", margemPct: 12.6 },
  { posicao: 2, titulo: "Produto de exemplo B", unidades: "8 un.", faturamento: "R$ 300,00", margemPct: -5.5 },
  { posicao: 3, titulo: "Produto de exemplo C", unidades: "4 un.", faturamento: "R$ 230,00", margemPct: 19.2 },
  { posicao: 4, titulo: "Produto de exemplo D (sem custo cadastrado)", unidades: "2 un.", faturamento: "R$ 80,00", margemPct: null },
];

// O wrapper .cockpit-faixa é o contexto real da lista no app — é nele que a
// variável --ml-verde (chip de margem positiva) está definida.
export function ComQuatroProdutos() {
  return (
    <div className="cockpit-faixa" style={{ border: 0 }}>
    <ListaDeTopProdutos
      titulo="Top produtos — Hoje"
      contagem="4 produtos"
      acao={<a href="#">Ver produtos →</a>}
      linhas={PRODUTOS}
      vazio="Sem vendas no período para ranquear."
    />
    </div>
  );
}

export function SemVendas() {
  return <ListaDeTopProdutos titulo="Top produtos — Hoje" contagem="" linhas={[]} vazio="Sem vendas no período para ranquear." />;
}
