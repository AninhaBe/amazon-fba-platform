/**
 * EXEMPLOS DE USO — cada componente exportado renderiza SOZINHO aqui.
 *
 * ⚠️ NUMERO DE EXEMPLO E NEUTRO E SE ANUNCIA COMO EXEMPLO. Nada aqui pode ser
 * confundido com a operacao real de ninguem: os produtos sao genericos, os
 * valores sao redondos, e todo bloco tem pelo menos um caso de DADO
 * DESCONHECIDO — porque e nele que o sistema tem regra ("—", nunca 0), e um
 * exemplo so com o caso feliz esconde metade do design.
 *
 * ⚠️ E ESTE ARQUIVO E A GUARDA. `scripts/verificaExemplos.mjs` exige que todo
 * export do `index.ts` apareca aqui: export sem exemplo e componente que
 * ninguem sabe montar.
 */
import {
  AcaoPrimaria, AvisoDeCobertura, BaseDeData, CartaoDeMetrica, ChipDeMargem, Esqueleto,
  EstadoVazio, FaixaDeResultado, LinhaDePendencias, LinhaDeRentabilidade, LinhaDeTopProduto,
  ListaDeTopProdutos, MensagemDoNexo, ReguaDeDias, ReguaDeMetricas, SeletorDePeriodo, tomDaMargem,
} from "../index";

export function ExemploMensagemDoNexo() {
  return (
    <MensagemDoNexo
      paragrafos={[
        "Seu lucro de hoje está em R$ 240,00, com margem de 11,8% — abaixo dos 15% do mês passado.",
        "O que mais pesou foi o custo dos produtos.",
      ]}
      rodape={<AcaoPrimaria href="#">Ver detalhes</AcaoPrimaria>}
    />
  );
}

export function ExemploMensagemDoNexoCarregando() {
  return <MensagemDoNexo paragrafos={[]} carregando />;
}

export function ExemploReguaDeMetricas() {
  return (
    <ReguaDeMetricas rotulo="Resumo do período (exemplo)">
      <CartaoDeMetrica label="Faturamento" value="R$ 2.000,00" sub="50 aprovadas + 2 canceladas" />
      <CartaoDeMetrica label="Taxas" value="R$ 240,00" info="O que o marketplace cobrou nas vendas processadas." />
      {/* O caso que importa: desconhecido e traco, nunca R$ 0,00. */}
      <CartaoDeMetrica label="Impostos" value="—" sub="alíquota não cadastrada" tone="warn" />
      <CartaoDeMetrica label="Lucro" value="R$ 240,00" tone="positive" />
    </ReguaDeMetricas>
  );
}

export function ExemploChipDeMargem() {
  // Os quatro estados da regra, incluindo os dois lados da fronteira de 12%.
  return (
    <p style={{ display: "flex", gap: 8 }}>
      <ChipDeMargem margemPct={30} />
      <ChipDeMargem margemPct={13.6} />
      <ChipDeMargem margemPct={11.9} />
      <ChipDeMargem margemPct={null} />
    </p>
  );
}

export function ExemploTomDaMargem() {
  return <code>tomDaMargem(11.9) devolve {tomDaMargem(11.9)}</code>;
}

const PARCELAS = [
  { id: "fees", rotulo: "Taxas R$ 240,00", valor: 240, cor: "#FF8585" },
  { id: "cogs", rotulo: "Custo R$ 920,00", valor: 920, cor: "#FF0000" },
  { id: "shipping", rotulo: "Frete R$ 460,00", valor: 460, cor: "#FF4D4D" },
  // Parcela desconhecida: fica FORA da barra e da legenda, de proposito.
  { id: "taxes", rotulo: "Impostos —", valor: null, cor: "#FFC2C2" },
  { id: "result", rotulo: "Lucro R$ 240,00", valor: 240, cor: "#337129" },
];

export function ExemploFaixaDeResultado() {
  return (
    <FaixaDeResultado
      titulo="Resultado — Hoje"
      lucro={240}
      lucroFormatado="R$ 240,00"
      frase={<>de lucro em <strong>50 venda(s)</strong> · margem <strong>11,8%</strong></>}
      parcelas={PARCELAS}
      abaixoDaLegenda={<ExemploReguaDeDias />}
      aoLado={<ExemploListaDeTopProdutos />}
    />
  );
}

export function ExemploLinhaDePendencias() {
  return (
    <LinhaDePendencias
      itens={[
        { label: "Cadastrar custo de 5 produto(s)", href: "#", tone: "pendencia" },
        { label: "2 pedido(s) cancelado(s) no período", href: "#", tone: "alerta" },
      ]}
    />
  );
}

export function ExemploReguaDeDias() {
  return (
    <ReguaDeDias
      titulo="Lucro por dia — últimos 7"
      dias={[
        { id: "1", rotulo: "seg", valor: 700, compacto: "700", completo: "01/09: R$ 700,00", destaque: false },
        { id: "2", rotulo: "ter", valor: 1000, compacto: "1.000", completo: "02/09: R$ 1.000,00", destaque: false },
        { id: "3", rotulo: "qua", valor: 900, compacto: "900", completo: "03/09: R$ 900,00", destaque: false },
        // Dia sem venda: zero e FATO, e a coluna encosta no chao.
        { id: "4", rotulo: "qui", valor: 0, compacto: "0", completo: "04/09: R$ 0,00", destaque: false },
        // Dia desconhecido: NAO desenha coluna. Zero aqui pareceria uma queda.
        { id: "5", rotulo: "sex", valor: null, compacto: "—", completo: "05/09: lucro ainda desconhecido", destaque: false },
        { id: "6", rotulo: "sáb", valor: -140, compacto: "-140", completo: "06/09: prejuízo de R$ 140,00", destaque: false },
        { id: "7", rotulo: "hoje", valor: 240, compacto: "240", completo: "07/09: R$ 240,00", destaque: true },
      ]}
    />
  );
}

const PRODUTOS = [
  { posicao: 1, titulo: "Produto de exemplo A — nome longo o bastante para ser cortado pelas reticências", unidades: "30 un.", faturamento: "R$ 900,00", margemPct: 12.6 },
  { posicao: 2, titulo: "Produto de exemplo B", unidades: "8 un.", faturamento: "R$ 300,00", margemPct: -5.5 },
  { posicao: 3, titulo: "Produto de exemplo C", unidades: "4 un.", faturamento: "R$ 230,00", margemPct: 19.2 },
  // Sem custo cadastrado: a margem e desconhecida, e o chip mostra o traco.
  { posicao: 4, titulo: "Produto de exemplo D (sem custo cadastrado)", unidades: "2 un.", faturamento: "R$ 80,00", margemPct: null },
];

export function ExemploListaDeTopProdutos() {
  return (
    <ListaDeTopProdutos
      titulo="Top produtos — Hoje"
      contagem="4 produtos"
      acao={<a href="#">Ver produtos →</a>}
      linhas={PRODUTOS}
      vazio="Sem vendas no período para ranquear."
    />
  );
}

export function ExemploLinhaDeTopProduto() {
  return <ol className="top-faixa-lista"><LinhaDeTopProduto {...PRODUTOS[0]} /></ol>;
}

export function ExemploLinhaDeRentabilidade() {
  return (
    <>
      <LinhaDeRentabilidade
        produto="Produto de exemplo A"
        sku="EXEMPLO-001"
        pedidoId="2000000000000001"
        data="06/09/2026"
        logistica="Full"
        status="Pago"
        quantidade="3 unidades × R$ 40,00"
        venda="R$ 120,00"
        custos="R$ 94,00"
        margem={<ChipDeMargem margemPct={21.6} />}
      />
      {/* O caso pendente: repasse ainda nao postado, e nada vira zero. */}
      <LinhaDeRentabilidade
        produto="Produto de exemplo B"
        pedidoId="2000000000000002"
        data="06/09/2026"
        status="Aguardando repasse"
        statusPendente
        quantidade="1 unidade"
        venda="—"
        custos="—"
        margem={<ChipDeMargem margemPct={null} />}
      />
    </>
  );
}

export function ExemploAvisoDeCobertura() {
  return <AvisoDeCobertura cobreDesde="12/08/2026" progresso={64} emImportacao pedidosImportados="1.240" />;
}

export function ExemploBaseDeData() {
  return <BaseDeData base="pedido" />;
}

export function ExemploSeletorDePeriodo() {
  return (
    <SeletorDePeriodo
      opcoes={[
        { value: "today", label: "Hoje" },
        { value: "7", label: "7 dias" },
        { value: "15", label: "15 dias" },
        { value: "30", label: "30 dias" },
      ]}
      selecionado="today"
      onSelecionar={() => {}}
    />
  );
}

export function ExemploEsqueleto() {
  return <Esqueleto label="Carregando dados de exemplo" />;
}

export function ExemploEstadoVazio() {
  return (
    <EstadoVazio
      kind="sem-conexao"
      title="Conecte sua conta do Mercado Livre"
      description="Autorize o NEXO para começar a importar anúncios e pedidos."
      action={<AcaoPrimaria href="#">Gerenciar integração</AcaoPrimaria>}
    />
  );
}

export function ExemploAcaoPrimaria() {
  return <AcaoPrimaria onClick={() => {}}>Cadastrar custos</AcaoPrimaria>;
}
