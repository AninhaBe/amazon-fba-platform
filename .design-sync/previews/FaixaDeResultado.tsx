import {
  FaixaDeResultado, LinhaDePendencias, ListaDeTopProdutos, ReguaDeDias,
} from "@nexo/ds";

// A peça central do dashboard: lucro à esquerda com a cascata de parcelas,
// régua de dias abaixo, top produtos na coluna direita. Números de exemplo,
// redondos; a parcela desconhecida fica FORA da barra de propósito.
const PARCELAS = [
  { id: "fees", rotulo: "Taxas R$ 240,00", valor: 240, cor: "#FF8585" },
  { id: "cogs", rotulo: "Custo R$ 920,00", valor: 920, cor: "#FF0000" },
  { id: "shipping", rotulo: "Frete R$ 460,00", valor: 460, cor: "#FF4D4D" },
  { id: "taxes", rotulo: "Impostos —", valor: null, cor: "#FFC2C2" },
  { id: "result", rotulo: "Lucro R$ 240,00", valor: 240, cor: "#337129" },
];

const DIAS = [
  { id: "1", rotulo: "seg", valor: 700, compacto: "700", completo: "01/09: R$ 700,00", destaque: false },
  { id: "2", rotulo: "ter", valor: 1000, compacto: "1.000", completo: "02/09: R$ 1.000,00", destaque: false },
  { id: "3", rotulo: "qua", valor: 900, compacto: "900", completo: "03/09: R$ 900,00", destaque: false },
  { id: "4", rotulo: "qui", valor: 0, compacto: "0", completo: "04/09: R$ 0,00", destaque: false },
  { id: "5", rotulo: "sex", valor: null, compacto: "—", completo: "05/09: lucro ainda desconhecido", destaque: false },
  { id: "6", rotulo: "sáb", valor: -140, compacto: "-140", completo: "06/09: prejuízo de R$ 140,00", destaque: false },
  { id: "7", rotulo: "hoje", valor: 240, compacto: "240", completo: "07/09: R$ 240,00", destaque: true },
];

const PRODUTOS = [
  { posicao: 1, titulo: "Produto de exemplo A — nome longo o bastante para ser cortado pelas reticências", unidades: "30 un.", faturamento: "R$ 900,00", margemPct: 12.6 },
  { posicao: 2, titulo: "Produto de exemplo B", unidades: "8 un.", faturamento: "R$ 300,00", margemPct: -5.5 },
  { posicao: 3, titulo: "Produto de exemplo C", unidades: "4 un.", faturamento: "R$ 230,00", margemPct: 19.2 },
  { posicao: 4, titulo: "Produto de exemplo D (sem custo cadastrado)", unidades: "2 un.", faturamento: "R$ 80,00", margemPct: null },
];

export function ResultadoDoDia() {
  return (
    <FaixaDeResultado
      titulo="Resultado — Hoje"
      lucro={240}
      lucroFormatado="R$ 240,00"
      frase={<>de lucro em <strong>50 venda(s)</strong> · margem <strong>11,8%</strong></>}
      parcelas={PARCELAS}
      abaixoDaLegenda={<ReguaDeDias titulo="Lucro por dia — últimos 7" dias={DIAS} />}
      aoLado={
        <ListaDeTopProdutos
          titulo="Top produtos — Hoje"
          contagem="4 produtos"
          acao={<a href="#">Ver produtos →</a>}
          linhas={PRODUTOS}
          vazio="Sem vendas no período para ranquear."
        />
      }
    />
  );
}

export function ComPendencias() {
  return (
    <FaixaDeResultado
      titulo="Resultado — 7 dias"
      lucro={-140}
      lucroFormatado="−R$ 140,00"
      frase={<>de prejuízo em <strong>12 venda(s)</strong></>}
      parcelas={PARCELAS}
      abaixoDaLegenda={
        <LinhaDePendencias
          itens={[
            { label: "Cadastrar custo de 5 produto(s)", href: "#", tone: "pendencia" },
            { label: "2 pedido(s) cancelado(s) no período", href: "#", tone: "alerta" },
          ]}
        />
      }
    />
  );
}
