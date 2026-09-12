/**
 * A tabela de rentabilidade na linguagem **v3** — usada pelo Mercado Livre e,
 * desde 12/09/2026, pela Amazon.
 *
 * ⚠️ ESTA DUPLICAÇÃO É DECLARADA E TEMPORÁRIA, e existe por uma
 * razão medida (11/09/2026): `OrderProfitabilityTable` era renderizada por
 * quatro telas — Amazon, Shopee, a central e o ML. Converter o arquivo
 * compartilhado levava a identidade nova para canal que não tinha pedido.
 *
 * A Amazon ATRAVESSOU em 12/09/2026, por ordem dela (*"replicar a mesma
 * estrutura do mercado livre na amazon"*): ela lê esta cópia, e quem ainda lê a
 * original é a Shopee e a central. A dívida encolheu de três canais para dois —
 * é exatamente a morte canal por canal prevista abaixo, e não um caminho novo.
 *
 * ⚠️ E NÃO DAVA PARA RESOLVER POR ESCOPO DE CSS: a conversão mudou
 * o DOM (cartão, filtros, chips), não só as classes. CSS escopado não devolve
 * markup; então o caminho honesto é ter as duas formas no disco e declarar a
 * dívida, em vez de vazar identidade para canal que não pediu.
 *
 * ⚠️ O QUE **NÃO** SE DUPLICA: correção de comportamento. Se um
 * defeito de regra de dado aparecer aqui, ele se corrige NAS DUAS — ou, melhor,
 * na original, e esta acompanha. A divisão é de roupa, nunca de conta.
 *
 * Morte desta cópia: quando a identidade nova for aprovada canal por canal, a
 * original recebe esta forma e este arquivo sai. Até lá, quem mexer numa olha a
 * outra.
 */
"use client";

import { Fragment, useMemo, useState } from "react";
import { SeletorNexo } from "./SeletorNexo";
import { ChevronDown } from "lucide-react";
import type { ProfitabilityLine } from "@/lib/profitability";
import { brDate } from "@/lib/datetime";
import { marginTone } from "@/lib/marginTone";
import { EmptyState } from "./EmptyState";
import { MarcaDeEstimativa } from "./MarcaDeEstimativa";
import { fonteDaLinha, procedenciaDaFonte, rotuloDaMarca } from "./procedenciaDaEstimativa";
import { TableLoading } from "./LoadingState";
import { Pagination } from "./Pagination";
import styles from "./OrderProfitabilityTable.module.css";

// Contas movimentadas trazem até 1000 vendas por período. Renderizar todos os
// cards de uma vez travava a thread (o /monitor "congelava"). Paginamos em
// blocos para manter a montagem barata; busca e filtro agem sobre o total.
const PAGE_SIZE = 30;

function money(value: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

function percent(value: number) {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = { paid: "Pago", confirmed: "Confirmado", Shipped: "Enviado", Unshipped: "A enviar", PartiallyShipped: "Envio parcial", Pending: "Pendente" };
  return labels[status] || status.replaceAll("_", " ");
}

/**
 * Por que o cálculo não fechou — e, sobretudo, DE QUEM depende. "Aguardando
 * dados" fazia parecer falha nossa; na maioria das vezes é o marketplace que
 * ainda não liberou o número (a Amazon só informa o valor do pedido depois de
 * aprovar o pagamento, e a tarifa só entra quando liquida). Quando a pendência
 * é da vendedora — custo não cadastrado — a tela precisa dizer isso e não
 * esconder no meio do mesmo rótulo genérico.
 */
function motivoPendente(line: ProfitabilityLine): { titulo: string; ajuda: string; deNos: boolean } {
  if (line.revenueKnown === false)
    return { titulo: "Aguardando pagamento", ajuda: "O canal informa o valor ao aprovar o pagamento", deNos: false };
  if (line.productCost == null)
    return { titulo: "Custo não cadastrado", ajuda: `Cadastre o custo de ${line.sku || "este produto"}`, deNos: true };
  return { titulo: "Tarifas não postadas", ajuda: "Entram quando o canal liquida o pedido", deNos: false };
}

/**
 * A MARCA DE ESTIMATIVA DESTA LINHA — ADR-027 §2, ligada em 01/09/2026.
 *
 * ⚠️ A CONDIÇÃO É `feesEstimadas`, e não "a tarifa é maior que zero". O campo
 * diz PROCEDÊNCIA; o valor pode ser zero e ainda assim ser estimativa (a
 * Product Fees API respondeu `Success` com `Amount: 0` nos três pedidos de
 * 31/08 na conta AO62LVXJMX3AA). É a mesma condição do agregado, e ela existe
 * para o zero estimado não passar por oficial.
 *
 * ⚠️ E as duas parcelas são INDEPENDENTES: a Amazon posta em partes — 95,3% dos
 * pedidos com tarifa real têm comissão e nenhuma logística. Parcela ausente vai
 * como `null` para `procedenciaDaEstimativa`, que a omite da frase em vez de
 * escrever "FBA R$ 0,00" (`null` ≠ `0`).
 */
function marcaDaLinha(line: ProfitabilityLine) {
  if (!line.feesEstimadas) return null;
  // A procedencia vem da LINHA — e o unico lugar onde ela e verificavel. O
  // agregado nao consegue nomear fonte porque soma origens diferentes; ver
  // `PROCEDENCIA_DO_AGREGADO`.
  const fonte = fonteDaLinha({
    origemDaTarifa: line.origemDaTarifa,
    observadaEm: line.observadaEm,
    percentualDaCategoria: line.percentualDaCategoria,
    comissao: line.comissaoEstimada ?? null,
    fba: line.fbaEstimada ?? null,
    moeda: line.currency,
  });
  const procedencia = procedenciaDaFonte(fonte);
  // O rotulo da face sai da MESMA fonte que o tooltip — nao ha como um dizer
  // "tabela oficial" e o outro falar de outra origem.
  return <MarcaDeEstimativa procedencia={procedencia.texto} rotulo={rotuloDaMarca(fonte)} origemConhecida={procedencia.origemConhecida} />;
}

/**
 * A margem da linha, como CHIP de porcentagem.
 *
 * ⚠️ ERA VALOR + PORCENTAGEM EM DUAS LINHAS, e virou chip a
 * pedido dela (10/09/2026). O motivo nao e so estetico: numa tabela de nove
 * colunas, uma celula com duas linhas obriga a linha inteira a crescer, e a
 * margem passa a ser a unica coluna com peso de bloco. O chip diz a mesma coisa
 * em uma linha, e e a peca que o resto do produto ja usa para margem.
 *
 * ⚠️ O VALOR EM R$ NAO SE PERDEU: ele esta na propria tabela
 * (venda menos tarifa, frete, custo e imposto) e no detalhe que abre na linha,
 * onde aparece com a procedencia da tarifa. Aqui ficaria repetindo colunas
 * vizinhas.
 *
 * ⚠️ MARGEM DESCONHECIDA NAO VIRA CHIP CINZA MUDO: o motivo
 * (custo nao cadastrado, tarifa nao postada) continua no `title`, que e o que
 * diz o que FAZER — a regra da casa de apontar a falta em vez de escrever
 * "incompleto".
 */
function Margin({ line }: { line: ProfitabilityLine }) {
  if (line.contribution == null || line.marginPct == null) {
    const motivo = motivoPendente(line);
    return (
      <em className="v3-chip v3-chip-vazio" title={`${motivo.titulo} — ${motivo.ajuda}`}>—</em>
    );
  }
  const classe = line.marginPct < 0 ? "v3-chip-neg" : line.marginPct < 10 ? "v3-chip-aten" : "v3-chip-pos";
  return (
    <em className={`v3-chip ${classe}`} title={money(line.contribution, line.currency)}>
      {percent(line.marginPct)}
      {marcaDaLinha(line)}
    </em>
  );
}

function profitabilityMarginTone(line: ProfitabilityLine): "positive" | "warning" | "negative" | "pending" {
  if (line.contribution == null || line.marginPct == null) return "pending";
  const tone = marginTone(line.marginPct);
  return tone === "danger" ? "negative" : tone === "unknown" ? "pending" : tone;
}

function Breakdown({ line }: { line: ProfitabilityLine }) {
  const tone = profitabilityMarginTone(line);
  return <div className={`profit-breakdown ${styles.breakdown}`}>
    {line.listPrice != null && line.promotions != null && line.promotions > 0 && <>
      <div className="is-muted"><span>Preço de tabela</span><strong>{money(line.listPrice, line.currency)}</strong></div>
      <div className="is-muted"><span>Cupom aplicado</span><strong>− {money(line.promotions, line.currency)}</strong></div>
    </>}
    <div><span>{line.promotions ? "Pago pelo comprador" : "Receita da venda"}</span><strong>{line.revenueKnown === false || line.revenue == null ? "Aguardando envio" : money(line.revenue, line.currency)}</strong></div>
    {line.buyerShipping != null && <div><span>Frete pago pelo comprador</span><strong>{line.buyerShippingIsRevenue === false ? "" : "+ "}{money(line.buyerShipping, line.currency)}</strong></div>}
    <div><span>Custo dos produtos</span><strong>{line.productCost == null ? "Não cadastrado" : `− ${money(line.productCost, line.currency)}`}</strong></div>
    {/* A tarifa é a parcela que a estimativa substitui, então é aqui que a
        procedência completa aparece — a face leva a marca; o detalhe, o porquê. */}
    <div><span>Tarifas do canal</span><strong>{line.marketplaceFees == null ? "Ainda não conciliadas" : <>− {money(line.marketplaceFees, line.currency)}{marcaDaLinha(line)}</>}</strong></div>
    {line.sellerShipping != null && <div><span>Frete assumido pelo vendedor</span><strong>− {money(line.sellerShipping, line.currency)}</strong></div>}
    {line.netReceived != null && <div className="is-subtotal"><span>Líquido repassado antes do produto</span><strong>{money(line.netReceived, line.currency)}</strong></div>}
    {line.tax != null && <div><span>Impostos</span><strong>− {money(line.tax, line.currency)}</strong></div>}
    <div className={`is-total ${styles.total} ${styles[tone]}`}><span>Margem de contribuição</span><strong>{line.contribution == null ? motivoPendente(line).titulo : <>{money(line.contribution, line.currency)}{marcaDaLinha(line)}</>}</strong></div>
  </div>;
}

// `scopeNote` é uma FRASE pronta, não a estrutura de cobertura da API. Quem
// consome `/api/order-profitability` recebe `scope` como objeto e precisa
// formatá-lo antes — renderizar o objeto cru derruba a página (React #31).
export function OrderProfitabilityTableV3({
  lines,
  loading = false,
  error = null,
  scopeNote,
  pageSize = PAGE_SIZE,
}: {
  lines: ProfitabilityLine[];
  loading?: boolean;
  error?: string | null;
  scopeNote?: string;
  /** Dashboards usam uma prévia curta; o monitor mantém a paginação operacional. */
  pageSize?: number;
}) {
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<"all" | "positive" | "negative" | "incomplete">("all");
  const [logistica, setLogistica] = useState("all");
  // Conjunto, não um id só: comparar dois pedidos lado a lado é o uso normal
  // desta tela, e o acordeão fechava o anterior a cada clique.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggleExpanded = (id: string) => setExpanded((atual) => {
    const proximo = new Set(atual);
    if (!proximo.delete(id)) proximo.add(id);
    return proximo;
  });
  const [pagination, setPagination] = useState<{ lines: ProfitabilityLine[]; page: number }>({ lines, page: 1 });
  const page = pagination.lines === lines ? pagination.page : 1;
  /**
   * As opcoes de logistica saem dos DADOS, nao de uma lista fixa.
   *
   * ⚠️ O MERCADO LIVRE MUDA ESSES NOMES SEM AVISAR (full, flex,
   * self_service, xd_drop_off…). Uma lista cravada no codigo passaria a esconder
   * pedidos no dia em que um valor novo aparecesse — e o filtro nao mostraria
   * nada de errado, so deixaria de oferecer a opcao. Derivando, valor novo
   * aparece sozinho.
   */
  const logisticas = useMemo(
    () => [...new Set(lines.map((line) => line.fulfillment).filter((valor): valor is string => Boolean(valor)))].sort(),
    [lines],
  );
  const visible = useMemo(() => lines.filter((line) => {
    const matches = `${line.product} ${line.sku || ""} ${line.orderId}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"));
    const resultMatches = resultFilter === "all" || (resultFilter === "incomplete" ? !line.complete : resultFilter === "positive" ? (line.contribution ?? 0) >= 0 && line.complete : (line.contribution ?? 0) < 0 && line.complete);
    /* ⚠️ "sem" CASA O PEDIDO SEM LOGISTICA CONHECIDA, e por isso
       existe como opcao separada: sem ela, esses pedidos so apareceriam em
       "Todas" e ninguem conseguiria isola-los para investigar. */
    const logisticaMatches = logistica === "all"
      || (logistica === "sem" ? !line.fulfillment : line.fulfillment === logistica);
    return matches && resultMatches && logisticaMatches;
  }), [lines, query, resultFilter, logistica]);
  const complete = lines.filter((line) => line.complete).length;
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const current = Math.min(page, pageCount);
  const paged = visible.slice((current - 1) * pageSize, current * pageSize);

  const semMoeda = (valor: number | null | undefined, moeda: string) =>
    valor == null ? "—" : money(valor, moeda).replace(/^R\$\s*/, "");

  return <section className="v3-card" aria-labelledby="profitability-title">
    {/* ⚠️ A MESMA TABELA DO CARTAO "Pedidos" DO DASHBOARD, e
        isso e o pedido dela (10/09/2026): o botao "Abrir vendas" cai aqui, e
        chegar numa lista com OUTRA forma faz parecer que se mudou de assunto.
        La sao os 5 mais recentes; aqui a lista inteira, com busca, filtro e
        paginacao.

        ⚠️ O EXPANDIR CONTINUA. A tabela mostra venda, tarifa,
        frete, custo, imposto e margem — mas o detalhe traz o que ela nao tem:
        preco de tabela, cupom aplicado, frete pago pelo COMPRADOR, liquido
        repassado e a marca de tarifa estimada. Trocar cartao por tabela sem
        manter o detalhe teria apagado essas cinco informacoes em silencio. */}
    <div className="v3-card-cab">
      <h2 id="profitability-title">Pedidos</h2>
      {!loading && lines.length > 0 && (
        <span className="v3-meta">{complete} de {lines.length} vendas com cálculo completo</span>
      )}
    </div>
    <p className="v3-nota">{scopeNote || "Veja o que entrou, os custos identificados e quanto sobrou em cada produto vendido."}</p>

    <div className="v3-filtros v3-filtros-vendas" role="search" aria-label="Filtros das vendas">
      <label className="v3-busca">
        <span className="sr-only">Buscar produto, SKU ou pedido</span>
        <input
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPagination({ lines, page: 1 }); }}
          placeholder="Buscar produto, SKU ou pedido"
        />
      </label>
      {/* ⚠️ SELETOR NOSSO, NAO `<select>` NATIVO. A lista que o
          Chrome abre e desenhada pelo sistema operacional e nao aceita CSS —
          ela pediu para melhorar aquela lista (10/09/2026) e nao havia como,
          sem trocar a peca. O porque completo esta em `SeletorNexo.tsx`,
          junto do que se perde: a busca por digitacao. */}
      <SeletorNexo
        valor={resultFilter}
        rotuloAcessivel="Filtrar resultado das vendas"
        aoEscolher={(valor) => { setResultFilter(valor as typeof resultFilter); setPagination({ lines, page: 1 }); }}
        opcoes={[
          { valor: "all", rotulo: "Todos os resultados" },
          /* Sem cor: decisao dela em 10/09/2026, depois de ver a versao
             colorida. A cor de margem continua na COLUNA da tabela, onde ela
             qualifica um numero; aqui qualificaria um filtro. */
          { valor: "positive", rotulo: "Margem positiva" },
          { valor: "negative", rotulo: "Margem negativa" },
          { valor: "incomplete", rotulo: "Cálculo incompleto" },
        ]}
      />
      {logisticas.length > 0 && (
        <SeletorNexo
          valor={logistica}
          rotuloAcessivel="Filtrar logística"
          aoEscolher={(valor) => { setLogistica(valor); setPagination({ lines, page: 1 }); }}
          opcoes={[
            { valor: "all", rotulo: "Todas as logísticas" },
            ...logisticas.map((valor) => ({ valor, rotulo: valor })),
            /* "sem logistica" so entra quando existe venda sem ela: opcao que
               nunca filtra nada e opcao que faz a pessoa duvidar do filtro. */
            ...(lines.some((line) => !line.fulfillment) ? [{ valor: "sem", rotulo: "sem logística" }] : []),
          ]}
        />
      )}
      {expanded.size > 0 && (
        <button type="button" className="v3-btn" onClick={() => setExpanded(new Set())}>
          Recolher {expanded.size} {expanded.size === 1 ? "aberto" : "abertos"}
        </button>
      )}
    </div>

    {error ? <div role="alert" className="v3-nota">{error}</div>
      : loading ? <TableLoading label="Calculando rentabilidade das vendas" />
      : lines.length === 0 ? <EmptyState title="Nenhuma venda no período" description="Amplie o período para consultar vendas anteriores." />
      : visible.length === 0 ? <EmptyState kind="search" title="Nenhuma venda encontrada" description="Ajuste a busca ou altere o filtro de resultado." />
      : <>
        {/* ⚠️ CLASSE PROPRIA, NAO A DO CARTAO DO DASHBOARD. As
            duas tabelas sao irmas mas nao iguais: la sao nove colunas (previa
            dos 5 mais recentes), aqui onze — data e quantidade ganharam coluna
            propria a pedido dela (10/09/2026). Reusar `v3-tabela-pedidos`
            obrigaria as duas a andarem sempre juntas, e a do dashboard nao tem
            espaco para onze. */}
        <div className="v3-tabela v3-tabela-vendas">
          <div className="v3-revisar-cab">
            <span>Produto</span>
            <span>Pedido</span>
            <span>Data</span>
            <span>Qtd</span>
            <span>Logística</span>
            <span>Venda</span>
            <span>Tarifa ML</span>
            <span>Frete</span>
            <span>Custo</span>
            <span>Imposto</span>
            <span>Margem</span>
          </div>
          {paged.map((line) => {
            const aberta = expanded.has(line.id);
            return (
              <Fragment key={line.id}>
                <div className={`v3-revisar-linha${aberta ? " is-aberta" : ""}`}>
                  <span className="v3-cel-nome">
                    {/* O nome e o botao que abre o detalhe: alvo grande, sem um
                        icone a mais competindo com as nove colunas. */}
                    <button
                      type="button"
                      className="v3-linha-abrir"
                      aria-expanded={aberta}
                      onClick={() => toggleExpanded(line.id)}
                    >
                      <span className="v3-margem-titulo" title={line.product}>{line.product}</span>
                    </button>
                    {/* Quantidade e data sairam daqui: viraram coluna. O sub
                        fica so com o SKU, que e o que identifica o produto. */}
                    <span className="v3-cel-sub">{line.sku || "sem SKU"}</span>
                  </span>
                  <span className="v3-cel-pedido">#…{String(line.orderId).slice(-6)}</span>
                  <span className="v3-cel-meio">{brDate(line.date)}</span>
                  <span className="v3-cel-num">{line.quantity}</span>
                  <span className="v3-cel-meio">{line.fulfillment ?? "—"}</span>
                  <span className="v3-cel-num">{line.revenueKnown === false ? "—" : semMoeda(line.revenue, line.currency)}</span>
                  <span className={`v3-cel-num${line.marketplaceFees == null ? " is-vazio" : ""}`}>{semMoeda(line.marketplaceFees, line.currency)}</span>
                  <span className={`v3-cel-num${line.sellerShipping == null ? " is-vazio" : ""}`}>{semMoeda(line.sellerShipping, line.currency)}</span>
                  <span className={`v3-cel-num${line.productCost == null ? " is-vazio" : ""}`}>{semMoeda(line.productCost, line.currency)}</span>
                  <span className={`v3-cel-num${line.tax == null ? " is-vazio" : ""}`}>{semMoeda(line.tax, line.currency)}</span>
                  <span className="v3-cel-fim"><Margin line={line} /></span>
                </div>
                {aberta && (
                  <div className="v3-revisar-detalhe">
                    <Breakdown line={line} />
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
        <div className="v3-rodape-solto">
          <span />
          <div className="v3-paginacao">
            <Pagination page={current} pageCount={pageCount} total={visible.length} pageSize={pageSize} onPage={(nextPage) => setPagination({ lines, page: nextPage })} />
          </div>
        </div>
      </>}
  </section>;
}

export function ProfitabilitySale({ line, expanded, onToggle }: { line: ProfitabilityLine; expanded: boolean; onToggle: () => void }) {
  // O cupom NÃO entra aqui: `line.revenue` já é o valor pago pelo comprador,
  // líquido dele. Somá-lo descontaria o desconto duas vezes.
  const deductions = line.productCost == null || line.marketplaceFees == null
    ? null
    : line.productCost + line.marketplaceFees + (line.sellerShipping ?? 0) + (line.tax ?? 0);
  const vendaConhecida = line.revenueKnown !== false;
  // "Incompleto" não pode culpar o custo quando o custo é conhecido. Em pedido
  // ainda não enviado, o que falta é o valor da venda e a tarifa que a Amazon
  // só posta depois — e o custo do produto continua sabido.
  const custoRotulo = deductions != null
    ? money(deductions, line.currency)
    : line.productCost != null
    ? `${money(line.productCost, line.currency)} + tarifas`
    : "Não cadastrado";
  return <article className={`profit-sale ${styles.sale}${expanded ? ` is-expanded ${styles.expanded}` : ""}`}>
    <div className={`profit-sale-main ${styles.saleMain}`}>
      <div className={`profit-sale-product ${styles.product}`}>
        <strong title={line.product}>{line.product}</strong>
        <span className="profit-sale-sku">{line.sku || "Sem SKU"}</span>
        <small>Pedido #{line.orderId}</small>
      </div>
      <div className={`profit-sale-meta ${styles.saleMeta}`} aria-label="Informações da venda">
        <span>{brDate(line.date)}</span>
        {/* Logística e status são fatos distintos. Mostrar só um escondia que o
            pedido está pendente — a Amazon exibe os dois lado a lado. */}
        {line.fulfillment && <span>{line.fulfillment}</span>}
        <span className={line.revenueKnown === false ? "is-pendente" : undefined}>{statusLabel(line.status)}</span>
        <span>{line.quantity} {line.quantity === 1 ? "unidade" : "unidades"}{line.revenueKnown === false || line.unitPrice == null ? "" : ` × ${money(line.unitPrice, line.currency)}`}</span>
      </div>
      <div className={`profit-equation ${styles.equation}`} aria-label="Resumo financeiro da venda">
        <div><span>Venda</span><strong>{vendaConhecida && line.revenue != null ? money(line.revenue, line.currency) : "—"}</strong></div>
        <i aria-hidden="true">−</i>
        <div className="is-cost"><span>Custos</span><strong>{custoRotulo}</strong></div>
        <i aria-hidden="true">=</i>
        <div className="is-margin"><span>Margem</span><Margin line={line} /></div>
      </div>
      <button type="button" className={`profit-expand ${styles.expand}`} aria-label={`${expanded ? "Ocultar" : "Mostrar"} composição da venda`} aria-expanded={expanded} onClick={onToggle}><ChevronDown aria-hidden="true" /></button>
    </div>
    {expanded && <div className={`profit-sale-details ${styles.details}`}><Breakdown line={line} /></div>}
  </article>;
}
