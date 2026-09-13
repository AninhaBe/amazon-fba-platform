"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "./EmptyState";
import { DashboardSkeleton } from "./LoadingState";
import { PageHeader } from "./PageHeader";
import { DashboardPeriodFilter, useDashboardPeriod } from "./DashboardPeriodFilter";
import { usePrefetchDePeriodos } from "./prefetchDePeriodos";
import { useCacheDaTela } from "./cacheDaTela";
import { ChannelModuleSummary } from "./ChannelModuleSummary";
import { comCustoSalvo, custoExibido, custoValido, proximoEstado, ROTULO_DO_CUSTO, salvarCusto, type CustoSalvo, type EstadoDoCusto } from "./custoPorLinha";
import { ChannelConnectionEmpty } from "./ChannelConnectionEmpty";
import { SHOPEE_MODULES, shopeeModuleError, shopeeModuleHref, shopeeModuleQuery, type ShopeeModuleKind } from "./ShopeeModulesModel";
import { parseShopeeTaxRateDraft, SHOPEE_TAX_RATE_ANCHOR, shopeeSettingsPath } from "./ShopeeSettingsModel";
import { shopeeProviderIssueContent, type ShopeeProviderIssue } from "./ShopeeWorkspaceModel";
import { useAnchoredField } from "./useAnchoredField";
import { rotuloStatusProduto, rotuloStatusShopee } from "./statusDeExibicao";
import { BaseDeData } from "./BaseDeData";
import { dataHoraNaTabela, pareceData } from "./dataNaTabela";
import { nomeDaBase } from "./baseDaMargem";
import { CustomizableMetricGrid } from "./CustomizableMetricGrid";
import { Flow, FlowExpandable, Metric } from "./Metric";
import { buildFinancialComposition, FinancialSummaryPanel } from "./FinancialSummaryPanel";
import { sinaisDoResultado } from "./oQueFaltaNoResultado";
import { SinaisDoResultado } from "./SinaisDoResultado";
import { shopeeTaxLabel } from "./ShopeeWorkspaceModel";
import { comSemImposto } from "@/lib/semImposto";
import { marginMetricTone } from "@/lib/marginTone";
import { AvisoDeEstoqueNaoInformado, AvisoDeOcultos, FiltroDeAtividade } from "./FiltroDeAtividade";
import type { FiltroDeAtividade as FiltroDeAtividadeValor } from "@/lib/integrations/filtroDeAtividade";

type Connection={id:string;status:string;displayName?:string;externalAccountId?:string;metadata?:{demo?:boolean}};
type Coverage={complete?:boolean;capturedOrders?:number;totalOrders?:number;processedOrders?:number;paidOrders?:number};
/**
 * ⚠️ `revenueDoLucro` OPCIONAL de propósito (01/09/2026): é o campo que o
 * backend vai passar quando o denominador da Shopee trocar de `revenueProcessed`
 * para o faturamento. Enquanto ele não vier, a tela cai no processado — e é a
 * PRESENÇA dele que faz a frase da base mudar sozinha. Ver `baseDoResultado`.
 */
type ProfitBlock={revenueDoLucro?:number|null;fees:number|null;ads:number|null;taxesWithheld:number|null;refunds:number|null;cogs:number|null;taxes:number|null;taxRate:number|null;sellerShipping:number|null;buyerShipping:number|null;feesComplete:boolean;revenueProcessed:number;
  /** Fatias do widget, todas no universo da receita paga; o lucro e o residuo. */
  composicaoDaReceitaPaga:{receita:number;fees:number|null;sellerShipping:number|null;ads:number|null;taxesWithheld:number|null;refunds:number|null;cogs:number|null;taxes:number|null;lucro:number|null};
  coverage:Coverage&{processedOrders:number;paidOrders:number;complete:boolean;ordersWithFees:number};estimatedProfit:number|null;marginPct:number|null;unitsWithoutCost:number;skusWithoutCost:number};
type Payload={items?:Record<string,unknown>[];orders?:Record<string,unknown>[];availability?:string;page?:{limit:number;offset:number;total:number;returned?:number;hasMore:boolean;complete?:boolean};coverage?:Coverage|null;profitSubset?:{reason?:string};profit?:ProfitBlock|null;currency?:string;error?:string;code?:string;atividade?:FiltroDeAtividadeValor;ocultados?:number;semEstoqueInformado?:{anuncios:number;varreduraEm:string|null};totalNoCanal?:number;ordenacao?:"volume"|"titulo"};
const money=(value:unknown,currency="BRL")=>value==null?"—":new Intl.NumberFormat("pt-BR",{style:"currency",currency}).format(Number(value));
const show=(value:unknown)=>value==null||value===""?"—":String(value);

/**
 * A query da URL com OUTRO período — só para aquecer.
 *
 * ⚠️ Não inventa conversão: repassa exatamente o que o filtro devolveu
 * (`days=…` ou `from=…&to=…`) para dentro da query que a tela já monta, e deixa
 * `shopeeModuleQuery` decidir o que vai para o servidor. Montar o período aqui
 * criaria a segunda regra de período do produto.
 */

/**
 * ⚠️ OS DOIS AVISOS DO PAINEL SE CONTRADIZIAM, e ela viu (02/09/2026): o
 * selo dizia *"Faltam custos ou repasses"* enquanto a descricao logo abaixo
 * dizia *"Detalhamento processado em 10.126 de 10.126 vendas"* — cem por cento.
 *
 * Os dois estavam certos e falavam de coisas DIFERENTES: o selo olha custo
 * cadastrado, a descricao olha repasse processado. Lado a lado, a tela parecia
 * se desmentir.
 *
 * A descricao passa a dizer O QUE falta, na ordem do que ela pode resolver:
 * custo nao cadastrado e acao DELA; repasse nao processado e espera da Shopee.
 */

/**
 * ⚠️ TRAVESSAO SOZINHO DIZ MENOS DO QUE PODERIA (02/09/2026).
 *
 * Os cards de Lucro e Margem mostravam "—" com o subtexto "no periodo
 * selecionado" — que descreve o RECORTE e nao a AUSENCIA. Quem olha fica sem
 * saber se nao vendeu, se falta dado, ou se e coisa nossa.
 *
 * O subtexto passa a apontar a causa. Nao e adjetivo que se desculpa ("dados
 * parciais"): e o fato, com quem se espera.
 */
function porQueSemResultado(profit: ProfitBlock): string {
  const pagas = profit.coverage?.paidOrders ?? 0;
  /**
   * ⚠️ A ORDEM SEGUE A MEDICAO, nao a intuicao. Nesta conta a tarifa
   * esta praticamente completa (9.868 dos 9.918 pedidos pagos tem comissao), e
   * o que falta de verdade e custo cadastrado. Comecar pela tarifa poria na
   * tela uma causa que o banco desmente.
   */
  if ((profit.unitsWithoutCost ?? 0) > 0) return "falta custo cadastrado";
  if ((profit.coverage?.processedOrders ?? 0) < pagas) return "aguardando itens do pedido";
  if ((profit.coverage?.ordersWithFees ?? 0) < pagas) return "aguardando tarifa da Shopee";
  return "no período selecionado";
}

function descricaoDaComposicao(profit: ProfitBlock): string {
  const semRepasse = Math.max((profit.coverage?.paidOrders ?? 0) - (profit.coverage?.processedOrders ?? 0), 0);
  const partes: string[] = [];
  if (semRepasse > 0) partes.push(`${semRepasse} venda(s) aguardando itens do pedido`);
  /**
   * ⚠️ O CUSTO NAO ENTRA AQUI, e a ausencia e a correcao (02/09/2026).
   * O print dela mostrava "sem custo cadastrado" TRES VEZES na mesma tela: o
   * alerta do topo (por SKU), este subtitulo (por unidade) e o rodape (por
   * unidade, com link). Ficou UMA: o rodape, que e a unica com CAMINHO.
   * E o alerta do topo e da pagina, nao do painel — deixa-lo junto poria "15
   * SKUs" e "209 unidades" lado a lado, dois numeros certos que parecem se
   * contradizer.
   */
  if (partes.length === 0) return "Valores efetivamente identificados no período.";
  return `${partes.join(" · ")}.`;
}

/**
 * ⚠️ A PENDENCIA NOMEADA, em vez do balaio. Ela via
 * *"Composicao pendente R$ 192.280,57"* sem nada dizendo o que era.
 *
 * ⚠️ E O VALOR SO APARECE QUANDO E CONHECIDO. A parte que espera repasse
 * tem valor — e a receita paga que ainda nao foi processada. A parte sem custo
 * cadastrado NAO tem: o custo que falta e justamente o numero que ninguem sabe.
 * Inventar um rateio ali seria extrapolar, e a casa proibe.
 */
function pendenciasDaComposicao(profit: ProfitBlock): Array<{ rotulo: string; valor?: number | null }> {
  const partes: Array<{ rotulo: string; valor?: number | null; levaOResto?: boolean }> = [];
  const pagas = profit.coverage?.paidOrders ?? 0;
  const semRepasse = Math.max(pagas - (profit.coverage?.processedOrders ?? 0), 0);
  if (semRepasse > 0) {
    // ⚠️ O NOME SEGUE O SCHEMA, e nao o que eu supus: `processedOrders` e
    // `COUNT(*) FILTER (WHERE has_items)` — pedido que TEM LINHA DE ITEM. Nao e
    // "repasse processado". Chamar de repasse afirmaria um estado financeiro
    // que essa contagem nao mede.
    partes.push({ rotulo: `Aguardando itens do pedido (${semRepasse} venda(s))` });
  }
  /**
   * ⚠️ EU IA POR "TARIFA NAO CONCILIADA" AQUI, E A MEDICAO DERRUBOU
   * (02/09/2026). O raciocinio parecia solido — o card diz "Tarifas: ainda nao
   * conciliadas" e o topo fala em tarifa de 10.143 de 10.146 vendas —, mas o
   * banco diz outra coisa: nesta conexao ha ZERO tarifas com valor nulo, e a
   * receita sem comissao e de R$ 1.820,49, nao dos R$ 192 mil do buraco.
   *
   * ⚠️ E `processedOrders` NAO SIGNIFICA "conciliado": no canonico ele e
   * `COUNT(*) FILTER (WHERE has_items)` — pedido que TEM LINHA DE ITEM. Um
   * pedido pode contar ali e nao ter tarifa nenhuma. Os dois numeros nao se
   * implicam, e eu tinha lido um como se fosse o outro.
   *
   * O que sobra no buraco e, em boa parte, RESULTADO — e chamar resultado de
   * pendencia e a familia de defeito que este projeto passou dois dias tirando
   * da tela. Enquanto o numero do custo do periodo nao estiver medido, esta
   * funcao nomeia SO o que se sabe pendente de verdade.
   */
  return partes;
}

function comPeriodo(fonte:string,janela:string){
  const saida=new URLSearchParams(fonte), escolhida=new URLSearchParams(janela);
  const de=escolhida.get("from"), ate=escolhida.get("to");
  if(de&&ate){saida.set("from",de);saida.set("to",ate);saida.delete("days")}
  else{saida.set("days",escolhida.get("days")??"today");saida.delete("from");saida.delete("to")}
  return saida.toString();
}

export function ShopeeModulePage({kind}:{kind:ShopeeModuleKind}) {
  const cfg=SHOPEE_MODULES[kind], router=useRouter(), params=useSearchParams();
  const [connections,setConnections]=useState<Connection[]|null>(null), [providerIssue,setProviderIssue]=useState<ShopeeProviderIssue|null>(null), [payload,setPayload]=useState<Payload|null>(null), [error,setError]=useState(""), [attempt,setAttempt]=useState(0);
  const update=useCallback((values:Record<string,string|null>)=>{const next=new URLSearchParams(params.toString());for(const [key,value] of Object.entries(values)){if(value)next.set(key,value);else next.delete(key)}if(!("offset" in values))next.set("offset","0");router.push(`${location.pathname}?${next}`,{scroll:false})},[params,router]);
  // E3 (28/08/2026): período personalizado deixa de ser descartado — from/to
  // seguem para a URL (e daí para o contrato do módulo); days vira fallback.
  const period=useDashboardPeriod(params.toString(), query=>{const p=new URLSearchParams(query);if(p.has("from")&&p.has("to"))update({from:p.get("from"),to:p.get("to"),days:null});else update({days:p.get("days")??"today",from:null,to:null})});
  useEffect(()=>{let active=true;fetch("/api/integrations",{cache:"no-store"}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error);return body}).then(body=>{const provider=body.providers?.find((item:{id:string})=>item.id==="shopee");if(active){const issue=(provider?.issue??null) as ShopeeProviderIssue|null;setProviderIssue(issue);setConnections(issue?[]:provider?.connections??[])}}).catch(()=>active&&setError("Não foi possível carregar as conexões."));return()=>{active=false}},[attempt]);
  const requested=params.get("connection_id"), connected=connections?.filter(item=>item.status==="connected")??null, selected=connected?.find(item=>item.id===requested)??connected?.[0]??null, selectedId=selected?.id??null;
  useEffect(()=>{if(selected&&requested!==selected.id)router.replace(shopeeModuleHref(location.pathname,params.toString(),selected.id),{scroll:false})},[params,requested,router,selected]);
  const query=selectedId?shopeeModuleQuery(params.toString(),selectedId,kind):"";
  // ⚠️ CACHE QUE VIVE O QUE A TELA VIVE (01/09/2026). Ver `cacheDaTela`: ele
  // nasce e morre junto com `custosSalvos`, o patch que corrige as linhas. É por
  // isso que não existe o caminho "salvar → sair → voltar e a coluna volta a
  // '—'". Toda visita nova busca; dentro da visita, voltar a um período já visto
  // custa zero ida — e é esse zero que paga a antecipação sem subir requisição.
  const cache=useCacheDaTela<Payload>(`shopee:${kind}`);
  const buscarModulo=useCallback((chave:string)=>cache.buscar(chave,async()=>{
    const response=await fetch(`/api/integrations/shopee/${cfg.endpoint}?${chave}`,{cache:"no-store"});
    const body=await response.json();
    if(!response.ok)throw Error(shopeeModuleError(body.code)||body.error||"Não foi possível carregar este módulo.");
    return body as Payload;
  }),[cache,cfg.endpoint]);
  // Clear stale rows before fetching another connection or filter combination.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{if(!selectedId)return;let active=true;setPayload(null);setError("");buscarModulo(query).then(body=>active&&setPayload(body)).catch(reason=>active&&setError(reason.message));return()=>{active=false}},[attempt,buscarModulo,query,selectedId]);
  /**
   * ANTECIPA a janela que a pessoa está prestes a pedir.
   *
   * Ponteiro E foco aqui, ao contrário do monitor e da central: esta tela NÃO
   * tinha cache nenhum, então o cache que ela acabou de ganhar paga o hover que
   * não vira clique — a mesma aritmética medida em `/ads` (4 → 4). Sem fila de
   * fundo: ela custaria três idas por sessão, sempre.
   */
  const {aquecerAgora}=usePrefetchDePeriodos({
    ativo:Boolean(selectedId&&payload),
    atual:period.query,
    escopo:`shopee:${kind}:${selectedId??""}`,
    jaTem:janela=>selectedId?cache.jaTem(shopeeModuleQuery(comPeriodo(params.toString(),janela),selectedId,kind)):false,
    buscar:async janela=>{if(selectedId)await buscarModulo(shopeeModuleQuery(comPeriodo(params.toString(),janela),selectedId,kind))},
    filaDeFundo:false,
  });
  const retry=()=>setAttempt(value=>value+1);
  // Esquecer ANTES de subir a tentativa: o efeito refaz a busca, e com o cache
  // limpo ela vai ao servidor em vez de devolver o payload de antes da alíquota.
  const aoSalvarAliquota=useCallback(()=>{cache.esquecer();setAttempt(value=>value+1)},[cache]);
  const attention=connections?.some(item=>item.status==="attention"||item.status==="disconnected");
  const issueContent=shopeeProviderIssueContent(providerIssue);
  return <div className={`channel-module-page analysis-page channel-module-${kind}`}>
    {cfg.period&&selected&&<DashboardPeriodFilter {...period.filterProps} onIntent={aquecerAgora}/>}
    <PageHeader eyebrow="Shopee" title={cfg.title} subtitle={cfg.subtitle} action={selected&&connected&&<label className="channel-store-selector">Loja<select aria-label="Loja Shopee" value={selected.id} onChange={event=>router.push(shopeeModuleHref(location.pathname,params.toString(),event.target.value),{scroll:false})}>{connected.map(item=><option value={item.id} key={item.id}>{item.displayName||item.externalAccountId||item.id}</option>)}</select></label>}/>
    {!connections&&!error?<DashboardSkeleton/>:issueContent?<EmptyState kind="permission" title={issueContent.title} description={issueContent.description} action={<Link href="/integracoes" className="meli-primary-action">{issueContent.actionLabel}</Link>}/>:!selected&&!error?(attention?<EmptyState kind="permission" title="Reconecte a loja Shopee" description="A autorização expirou ou foi interrompida. Reconecte para retomar a sincronização." action={<Link href="/integracoes" className="meli-primary-action">Gerenciar conexões</Link>}/>:<ChannelConnectionEmpty channel="Shopee" description="Conecte uma loja para acessar este módulo." action={<Link href="/integracoes" className="meli-primary-action">Gerenciar conexões</Link>}/>):error?<EmptyState kind="permission" title="Não foi possível carregar" description={error} action={<button type="button" className="meli-primary-action min-h-11 active:scale-[0.96] transition-transform" onClick={retry}>Tentar novamente</button>}/>:!payload?<DashboardSkeleton/>:payload.availability==="NOT_AVAILABLE"?<EmptyState title="Dados ainda indisponíveis" description="A loja está conectada, mas este conjunto ainda não foi materializado pela sincronização."/>:<Content kind={kind} body={payload} params={params} update={update} connectionId={selected!.id} aoSalvarAliquota={aoSalvarAliquota}/>}</div>;
}

function Content({kind,body,params,update,connectionId,aoSalvarAliquota}:{kind:ShopeeModuleKind;body:Payload;params:URLSearchParams;update:(v:Record<string,string|null>)=>void;connectionId:string;aoSalvarAliquota:()=>void}) {
  const [search,setSearch]=useState(params.get("q")??"");
  if(kind==="monitor")return <ShopeeMonitorContent body={body} params={params} update={update} connectionId={connectionId}/>;
  const rows=body.items??[], coverage=body.coverage??body.profit?.coverage;
  return <section className="channel-module-content" aria-live="polite">
    <ChannelModuleSummary kind={kind} rows={rows} total={body.page?.total}/>
    {kind==="costs"&&<ShopeeTaxRateEditor key={connectionId} connectionId={connectionId} onSalvou={aoSalvarAliquota}/>}
    {coverage&&!coverage.complete&&<aside role="status" className="channel-module-notice is-warning"><strong>Ainda sincronizando</strong><p>Foram processados {show(coverage.capturedOrders??coverage.processedOrders)} de {show(coverage.totalOrders??coverage.paidOrders)} pedidos. Os valores não representam o período completo.</p></aside>}
    {kind==="inventory"&&<aside className="channel-module-notice">Quantidades agregadas por anúncio. Estoque por variação/modelo não está disponível.</aside>}
    {kind==="abc"&&<aside className="channel-module-notice is-warning"><strong>Lucro por SKU indisponível</strong><p>{body.profitSubset?.reason||"O contrato atual não permite atribuir lucro por produto com segurança."}</p></aside>}
    {["catalog","inventory","costs"].includes(kind)&&<form className="listing-controls channel-module-filters" onSubmit={event=>{event.preventDefault();update({q:search||null})}}><label className="listing-search"><span className="sr-only">Buscar</span><input value={search} maxLength={120} onChange={event=>setSearch(event.target.value)} placeholder="Produto, SKU ou ID"/></label><FiltroDeAtividade atual={body.atividade} onChange={valor=>update({atividade:valor==="ativos"?null:valor,offset:null})}/><label className="listing-search"><span className="sr-only">Ordenar por</span><select value={body.ordenacao??"volume"} onChange={event=>update({ordenacao:event.target.value==="volume"?null:event.target.value,offset:null})}><option value="volume">Mais vendidos (30 dias)</option><option value="titulo">Nome do produto</option></select></label><button className="listing-refresh">Aplicar filtro</button></form>}
    {["catalog","inventory","costs"].includes(kind)&&<AvisoDeOcultos ocultados={body.ocultados} atividade={body.atividade} verTodos={()=>update({atividade:"todos",offset:null})}/>}
    {/* ADR-033: o que a fonte NAO informou precisa aparecer com numero e data.
        Antes estes anuncios vinham como estoque ZERO e a tela dizia "esgotado"
        sobre 435 dos 747 anuncios dela. */}
    {["catalog","inventory","costs"].includes(kind)&&<AvisoDeEstoqueNaoInformado anuncios={body.semEstoqueInformado?.anuncios} canal="Shopee" varreduraEm={body.semEstoqueInformado?.varreduraEm} verTodos={()=>update({atividade:"todos",offset:null})}/>}
    {!rows.length?<EmptyState compact title="Nenhum resultado" description="Não há dados para os filtros e o período selecionados."/>:<Table kind={kind} rows={rows} connectionId={connectionId} />} 
    {body.page&&<nav aria-label="Paginação" className="listing-pagination channel-module-pagination"><p role="status">Exibindo {body.page.total===0?0:body.page.offset+1}–{Math.min(body.page.offset+(body.page.returned??rows.length),body.page.total)} de {body.page.total} resultado(s). {body.page.complete===false||body.page.hasMore?"Há mais resultados; esta página não representa o conjunto completo.":"Cobertura completa."}</p><div><button disabled={!body.page.offset} onClick={()=>update({offset:String(Math.max(0,body.page!.offset-body.page!.limit))})}>Anterior</button><button disabled={!body.page.hasMore} onClick={()=>update({offset:String(body.page!.offset+body.page!.limit)})}>Próxima</button></div></nav>}
  </section>;
}

/**
 * Monitor da conta elevado ao padrão da Amazon (E3 do Monitor Unificado,
 * 28/08/2026): base de data → estado do sync → cards do período → abas
 * Composição | Pedidos. SEM aba Transações de propósito — o extrato da Shopee
 * não está implementado e aba vazia seria mentira (omissão honesta do plano).
 * Hierarquia como premissa: cards são métrica, não aviso; o único aviso aqui é
 * o de cobertura que JÁ existia, preservado dentro da aba Pedidos.
 */
function ShopeeMonitorContent({body,params,update,connectionId}:{body:Payload;params:URLSearchParams;update:(v:Record<string,string|null>)=>void;connectionId:string}) {
  const [search,setSearch]=useState(params.get("q")??"");
  const [costsOpen,setCostsOpen]=useState(false);
  /**
   * ⚠️ A ABA VIVE NA URL, e nao em estado local (02/09/2026).
   *
   * Reportado pela vendedora, verbatim: *"clicando em pedidos e depois na data,
   * joga de volta para composicao"*. O estado era `useState` inicializado do
   * endereco e NUNCA escrito de volta: a escolha existia so na memoria do
   * componente, entao qualquer remontagem — e trocar o periodo empurra um
   * endereco novo — voltava para o padrao.
   *
   * Derivar da URL resolve os tres casos de uma vez, e nao dois de tres:
   * trocar periodo mantem a aba, trocar aba mantem o periodo, e F5 mantem os
   * dois. Estado local nunca daria o terceiro.
   *
   * ⚠️ E TROCAR DE ABA NAO CUSTA REQUISICAO: `secao` nao entra na chave da
   * busca. O que muda e o `offset`, que o `update` zera — e zerar e o certo:
   * a aba nova comeca na primeira pagina.
   */
  const secao:"composicao"|"pedidos"=params.get("secao")==="pedidos"?"pedidos":"composicao";
  const rows=body.orders??[], profit=body.profit, currency=body.currency??"BRL", coverage=body.coverage??profit?.coverage;
  const custoIncompleto=(profit?.unitsWithoutCost??0)>0;
  /**
   * A FRASE DA BASE SAI DO CAMPO QUE FOI DE FATO USADO — não de uma constante.
   *
   * ⚠️ O que ela substitui era uma string fixa, `"sobre a receita processada"`,
   * VERDADEIRA hoje e programada para virar mentira: o denominador da Shopee vai
   * trocar para o faturamento, e ninguém ia lembrar de voltar aqui trocar o
   * texto. É a categoria "frase verdadeira com validade" — a varredura de
   * 01/09/2026 procurava frase JÁ errada e não teria achado esta.
   *
   * As duas saídas óbvias eram ruins pelo mesmo motivo: string específica (que
   * vira mentira) ou texto genérico (que perde a especificidade hoje). As duas
   * tratavam o texto como CONSTANTE. Ele não é: é propriedade do dado. Mesma
   * regra que já vale para a janela — quando o nome precisa ser dito, ele vem do
   * mesmo lugar que decide o número, nunca de uma string.
   */
  const baseDoResultado=profit==null?null:nomeDaBase({
    // Nao ha faturamento exibido ao lado para divergir, entao a peca so NOMEIA
    // a base — e o nome acompanha o campo que foi de fato usado, que era o
    // ponto da correcao anterior. Texto na tela inalterado.
    rotuloDaBase:profit.revenueDoLucro!=null?"o faturamento":"a receita processada",
  });
  const sinaisDaTela=sinaisDoResultado({
    skusWithoutCost:profit?.skusWithoutCost??0,
    ordersWithFees:profit?.coverage.ordersWithFees,
    ordersProcessed:profit?.coverage.processedOrders,
    hrefDeCustos:"/shopee/produtos",
  });
  const semAliquota=profit?.taxRate==null;
  // A MESMA régua do dashboard: lucro só é afirmado com tudo identificado.
  // ⚠️ 30/08/2026: `custoIncompleto` saiu daqui — virou SINAL, nao trava.
  // A margem do painel de composicao: o residuo sobre o centro DELE.
  const margemDaReceitaPaga = profit && profit.composicaoDaReceitaPaga.lucro != null
    && profit.composicaoDaReceitaPaga.receita > 0
      ? (profit.composicaoDaReceitaPaga.lucro / profit.composicaoDaReceitaPaga.receita) * 100
      : null;
  const resultIncomplete=!profit||!profit.coverage.complete||!profit.feesComplete||profit.fees==null||profit.sellerShipping==null||profit.ads==null||profit.taxesWithheld==null||profit.refunds==null||profit.cogs==null||profit.estimatedProfit==null||profit.marginPct==null;
  const knownCosts=!profit||resultIncomplete?null:profit.fees!+profit.sellerShipping!+profit.ads!+profit.taxesWithheld!+profit.refunds!+profit.cogs!+(profit.taxes??0);
  return <section className="channel-module-content" aria-live="polite">
    {/* Mesmo nome de página do monitor da Amazon, base DIFERENTE: lá o número é
        por data do lançamento do repasse; aqui é por data do pedido. */}
    <BaseDeData base="pedido" />
    {/*
      ⚠️ OS SINAIS APARECEM UMA VEZ POR TELA — o corte 1 da auditoria de
      empilhamento chegando aqui em 01/09/2026.

      A auditoria olhou as telas de CANAL e este arquivo ficou de fora, com o
      defeito inteiro vivo: a MESMA lista era passada para QUATRO cartoes, ou
      seja ate 12 marcas dizendo TRES coisas.

      E com ele vinha o multiplexador que SUPRIME informacao: o sub era
      `sinais.length > 0 ? <SinaisDoResultado/> : declaracao`, entao a
      declaracao de base e a de periodo so apareciam QUANDO NAO HAVIA SINAL —
      escondidas justamente nas contas com pendencia, que sao as que mais
      precisam delas.

      Nada sumiu: os tres sinais continuam aqui, uma vez cada, com numero e
      link, e os cartoes voltaram a mostrar o sub deles.
    */}
    {sinaisDaTela.length>0&&<SinaisDoResultado sinais={sinaisDaTela}/>}
    {profit&&<CustomizableMetricGrid
      viewKey="shopee-monitor"
      ariaLabel="Resumo do monitor Shopee"
      gridClassName="metric-grid monitor-metric-grid"
      widgets={[
        {id:"receita",label:"Receita processada",node:<Metric label="Receita processada" value={money(profit.revenueProcessed,currency)} sub={`${profit.coverage.processedOrders} de ${profit.coverage.paidOrders} venda(s) com repasse processado`}/>},
        // null nunca vira 0: tarifa desconhecida diz que ainda não foi conciliada.
        {id:"tarifas",label:"Tarifas da Shopee",node:<Metric label="Tarifas da Shopee" value={profit.fees==null?"Ainda não conciliadas":money(profit.composicaoDaReceitaPaga.fees??0,currency)} sub="comissões e taxas do canal"/>},
        {id:"lucro",label:"Lucro estimado",node:<Metric label={comSemImposto("Lucro estimado",semAliquota)} value={profit.estimatedProfit==null?"—":money(profit.estimatedProfit,currency)} sub={profit.estimatedProfit==null?porQueSemResultado(profit):"no período selecionado"} tone={profit.estimatedProfit==null?undefined:profit.estimatedProfit<0?"danger":"ok"}/>},
        {id:"margem",label:"Margem",node:<Metric label={comSemImposto("Margem",semAliquota)} value={profit.marginPct==null?"—":`${profit.marginPct.toLocaleString("pt-BR",{maximumFractionDigits:2})}%`} sub={profit.marginPct==null?porQueSemResultado(profit):baseDoResultado} tone={profit.marginPct==null?undefined:marginMetricTone(profit.marginPct)}/>},
      ]}
    />}
    {/* ⚠️ TROCAR DE ABA NAO PODE MUDAR A CHAVE DA BUSCA (02/09/2026).

          Ela reportou "os botoes do monitor da conta nao funcionam". Console
          limpo, sem erro de hidratacao, tela certa — e o motivo era este: o
          clique chamava `update({secao})`, e o `update` INJETA `offset=0`
          quando o offset nao vem no pedido. A URL dela nao tinha offset, entao
          a chave da busca mudava (de "sem offset" para "offset=0"), o efeito
          re-disparava, `setPayload(null)` apagava a tela e vinha uma ida nova
          ao servidor — numa conta com 10.126 vendas.

          Do lado de ca: clicou, a tela apagou e ficou segundos igual. Botao
          morto e busca inteira sao indistinguiveis para quem olha.

          Passar o offset ATUAL — inclusive quando ele nao existe, e ai o
          `update` o remove — mantem a chave identica e a troca de aba volta a
          ser instantanea, que e o que ela sempre foi antes de a aba ir para a
          URL. */}
          <nav className="monitor-section-tabs" aria-label="Visões do monitor">
      {([["composicao","Composição"],["pedidos","Pedidos"]] as Array<["composicao"|"pedidos",string]>).map(([key,label])=>
        <button key={key} type="button" aria-current={secao===key?"page":undefined} onClick={()=>update({secao:key,offset:params.get("offset")})}>{label}</button>)}
    </nav>
    {secao==="composicao"&&(profit?<FinancialSummaryPanel
      complete={!resultIncomplete}
      labelledBy="shopee-monitor-composicao"
      description={descricaoDaComposicao(profit)}
      total={profit.revenueProcessed}
      totalLabel="Receita processada"
      format={(value)=>money(value,currency)}
      slices={buildFinancialComposition({
        total:profit.composicaoDaReceitaPaga.receita,
        costs:[
          {id:"fees",label:"Taxas da Shopee",value:profit.composicaoDaReceitaPaga.fees},
          {id:"shipping",label:"Frete do vendedor",value:profit.composicaoDaReceitaPaga.sellerShipping},
          {id:"ads",label:"Anúncios",value:profit.composicaoDaReceitaPaga.ads},
          {id:"withheld",label:"Impostos retidos",value:profit.composicaoDaReceitaPaga.taxesWithheld},
          {id:"refunds",label:"Estornos",value:profit.composicaoDaReceitaPaga.refunds},
          {id:"cogs",label:"Custo dos produtos",value:profit.composicaoDaReceitaPaga.cogs},
          {id:"taxes",label:"Impostos",value:profit.composicaoDaReceitaPaga.taxes},
        ],
        result:profit.composicaoDaReceitaPaga.lucro,
        pendencias:pendenciasDaComposicao(profit),
      })}
      footer={(<>
        <Link href="/shopee/produtos" className="meli-financial-link">Configurar custos e imposto <span aria-hidden="true">→</span></Link>
        {profit.unitsWithoutCost>0&&<p className="text-xs leading-relaxed text-amber-700">
          {profit.unitsWithoutCost} unidade(s) sem custo cadastrado{" "}
          <Link href="/shopee/produtos" className="meli-financial-link">cadastrar <span aria-hidden="true">→</span></Link>
        </p>}
      </>)}
    >
      {/* A lista de fluxo fala do universo da RECEITA PAGA, igual a rosquinha — ver a nota no ShopeeWorkspace. */}
      <Flow label={profit.coverage.complete?"Receita paga":"Receita processada"} value={money(profit.composicaoDaReceitaPaga.receita,currency)} />
      {knownCosts!=null&&<FlowExpandable
        label="Custos do canal e do produto"
        value={money(knownCosts,currency)}
        open={costsOpen}
        onToggle={()=>setCostsOpen(open=>!open)}
        items={[
          {label:"Taxas da Shopee",value:profit.composicaoDaReceitaPaga.fees==null?"—":money(profit.composicaoDaReceitaPaga.fees??0,currency)},
          {label:"Frete pago pelo vendedor",value:profit.composicaoDaReceitaPaga.sellerShipping==null?"—":money(profit.composicaoDaReceitaPaga.sellerShipping??0,currency)},
          {label:"Anúncios",value:profit.composicaoDaReceitaPaga.ads==null?"—":money(profit.composicaoDaReceitaPaga.ads??0,currency)},
          {label:"Impostos retidos",value:profit.composicaoDaReceitaPaga.taxesWithheld==null?"—":money(profit.composicaoDaReceitaPaga.taxesWithheld??0,currency)},
          {label:"Estornos",value:profit.composicaoDaReceitaPaga.refunds==null?"—":money(profit.composicaoDaReceitaPaga.refunds??0,currency)},
          {label:"Custo dos produtos",value:profit.composicaoDaReceitaPaga.cogs==null?"—":money(profit.composicaoDaReceitaPaga.cogs??0,currency)},
          {label:shopeeTaxLabel(profit.taxRate),value:profit.composicaoDaReceitaPaga.taxes==null?"—":money(profit.composicaoDaReceitaPaga.taxes??0,currency)},
        ]}
      />}
      {/* ⚠️ LINHA QUE SO MOSTRARIA TRAVESSAO NAO ENTRA (02/09/2026).
          Palavra dela sobre este painel: "redundante e mal formatada". Tres
          linhas seguidas exibindo "—" nao informam nada — a ausencia ja esta
          dita, com numero, na lista de pendencias logo acima. Repetir "—" tres
          vezes e a redundancia que ela viu.
          ⚠️ Isto NAO e esconder ausencia: a ausencia continua declarada
          onde ela tem numero e caminho. O que sai e o eco vazio. */}
      {profit.composicaoDaReceitaPaga.lucro!=null&&<Flow label={comSemImposto("Lucro estimado",semAliquota)} value={money(profit.composicaoDaReceitaPaga.lucro,currency)} sign="=" accent tone={profit.composicaoDaReceitaPaga.lucro>0?"positive":profit.composicaoDaReceitaPaga.lucro<0?"danger":"default"} />}
      {/* Margem DESTE painel: residuo sobre o centro dele, nao a margem do periodo. */}
      {margemDaReceitaPaga!=null&&<Flow label={comSemImposto("Margem",semAliquota)} value={<>{`${margemDaReceitaPaga.toLocaleString("pt-BR",{maximumFractionDigits:2})}%`}</>} accent tone={margemDaReceitaPaga==null?"default":marginMetricTone(margemDaReceitaPaga)} />}
    </FinancialSummaryPanel>
    :<EmptyState compact title="Composição indisponível" description="A sincronização ainda não materializou o resultado financeiro deste período."/>)}
    {secao==="pedidos"&&<>
      <ChannelModuleSummary kind="monitor" rows={rows} total={body.page?.total}/>
      {coverage&&!coverage.complete&&<aside role="status" className="channel-module-notice is-warning"><strong>Ainda sincronizando</strong><p>Foram processados {show(coverage.capturedOrders??coverage.processedOrders)} de {show(coverage.totalOrders??coverage.paidOrders)} pedidos. Os valores não representam o período completo.</p></aside>}
      {/* Busca de SERVIDOR (E3): antes o monitor não tinha nenhuma. */}
      <form className="listing-controls channel-module-filters" onSubmit={(event:FormEvent)=>{event.preventDefault();update({q:search||null})}}><label className="listing-search"><span className="sr-only">Buscar</span><input value={search} maxLength={120} onChange={event=>setSearch(event.target.value)} placeholder="Pedido, SKU ou produto"/></label><button className="listing-refresh">Aplicar filtro</button></form>
      {!rows.length?<EmptyState compact title="Nenhum resultado" description="Não há pedidos para a busca e o período selecionados."/>:<Table kind="monitor" rows={rows} connectionId={connectionId} />}
      {body.page&&<nav aria-label="Paginação" className="listing-pagination channel-module-pagination"><p role="status">Exibindo {body.page.total===0?0:body.page.offset+1}–{Math.min(body.page.offset+(body.page.returned??rows.length),body.page.total)} de {body.page.total} resultado(s). {body.page.complete===false||body.page.hasMore?"Há mais resultados; esta página não representa o conjunto completo.":"Cobertura completa."}</p><div><button disabled={!body.page.offset} onClick={()=>update({offset:String(Math.max(0,body.page!.offset-body.page!.limit))})}>Anterior</button><button disabled={!body.page.hasMore} onClick={()=>update({offset:String(body.page!.offset+body.page!.limit)})}>Próxima</button></div></nav>}
    </>}
  </section>;
}

/**
 * ⚠️ `onSalvou` NÃO É PARA O CACHE — é o conserto de um defeito que já estava em
 * produção antes de existir cache nenhum (achado em 01/09/2026).
 *
 * A alíquota entra no cálculo de IMPOSTO e LUCRO de todas as linhas, e é o
 * servidor quem aplica. Salvar a alíquota mudava a resposta do servidor e não
 * mexia na tabela: a tela continuava exibindo o imposto e o lucro do payload
 * anterior até a próxima montagem. Número errado na tela, sem aviso nenhum — e
 * a mensagem de sucesso ao lado ("Alíquota salva para esta loja") reforçava que
 * o que estava na tabela já refletia a mudança.
 */
function ShopeeTaxRateEditor({connectionId,onSalvou}:{connectionId:string;onSalvou:()=>void}) {
  const [draft,setDraft]=useState("");
  const [state,setState]=useState<"loading"|"idle"|"saving"|"saved"|"error">("loading");
  const [message,setMessage]=useState("");
  const inputRef=useAnchoredField(SHOPEE_TAX_RATE_ANCHOR,state!=="loading");

  useEffect(()=>{
    const controller=new AbortController();
    fetch(shopeeSettingsPath(connectionId),{
      cache:"no-store",signal:controller.signal,
    }).then(async response=>{
      const body=await response.json();
      if(!response.ok)throw Error(shopeeModuleError(body.code)||body.error||"Não foi possível carregar a alíquota.");
      return body;
    }).then(body=>{
      setDraft(body.taxRate==null?"":String(body.taxRate));setState("idle");setMessage("");
    }).catch(error=>{
      if(error.name!=="AbortError"){setState("error");setMessage(error.message)}
    });
    return()=>controller.abort();
  },[connectionId]);

  async function save(event:FormEvent){
    event.preventDefault();
    const parsed=parseShopeeTaxRateDraft(draft);
    if(!parsed.valid){
      setState("error");setMessage("Informe um valor entre 0% e 100%, ou deixe em branco para limpar.");return;
    }
    const taxRate=parsed.value;
    setState("saving");setMessage("");
    try{
      const response=await fetch(shopeeSettingsPath(connectionId),{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({taxRate}),
      });
      const body=await response.json();
      if(!response.ok)throw Error(shopeeModuleError(body.code)||body.error||"Não foi possível salvar a alíquota.");
      setDraft(body.taxRate==null?"":String(body.taxRate));setState("saved");
      // Imposto e lucro da tabela são calculados pelo servidor COM esta
      // alíquota. Sem esta linha, eles ficam os do payload anterior.
      onSalvou();
      setMessage(body.taxRate==null
        ?"Alíquota removida; imposto e lucro voltam a ficar indisponíveis."
        :"Alíquota salva para esta loja.");
    }catch(error){
      setState("error");setMessage(error instanceof Error?error.message:"Não foi possível salvar a alíquota.");
    }
  }

  return <form id={SHOPEE_TAX_RATE_ANCHOR} onSubmit={save} className="channel-tax-panel">
    <div className="flex flex-wrap items-end gap-3">
      {/* ⚠️ LARGURA DO CAMPO E A DO DADO QUE ELE RECEBE.
          Com `flex-1` ele esticava ate o fim do painel: medido em producao,
          814px a 1280 de janela e 1454px a 1920 — para um numero de um ou dois
          digitos. Campo largo promete entrada longa; este recebe "12,5". */}
      <label className="flex w-[9.5rem] flex-none flex-col gap-1 text-sm font-medium text-[var(--ink-soft)]">
        <span>Alíquota média de imposto</span>
        <span className="flex items-center rounded-lg bg-white shadow-[inset_0_0_0_1px_rgb(203_213_225)]">
          <input ref={inputRef} aria-label="Alíquota média de imposto da Shopee" type="text" inputMode="decimal" value={draft}
            disabled={state==="loading"||state==="saving"} onChange={event=>{setDraft(event.target.value);setState("idle");setMessage("")}}
            placeholder="Desconhecida" className="min-h-11 min-w-0 flex-1 bg-transparent px-3 outline-none"/>
          <span className="pr-3 text-[var(--ink-muted)]">%</span>
        </span>
      </label>
      <button type="submit" disabled={state==="loading"||state==="saving"} className="meli-primary-action min-h-11 disabled:opacity-50">
        {state==="loading"?"Carregando…":state==="saving"?"Salvando…":"Salvar alíquota"}
      </button>
    </div>
    <p className="mt-2 max-w-[68ch] text-xs text-[var(--ink-muted)]">Use a alíquota efetiva da empresa para esta loja. Zero é um valor conhecido; deixe em branco e salve para voltar a desconhecido.</p>
    {message&&<p role={state==="error"?"alert":"status"} className={`mt-2 text-sm ${state==="error"?"text-red-700":"text-emerald-700"}`}>{message}</p>}
  </form>;
}

function Table({kind,rows,connectionId}:{kind:ShopeeModuleKind;rows:Record<string,unknown>[];connectionId:string}) {
  // Custos salvos nesta sessao, por ID DO CUSTO — nao por linha. Um anuncio com
  // variacoes mostra varias linhas que dividem o mesmo custo; a recarga
  // atualizava todas sem querer, e um patch por linha deixaria as outras com o
  // valor velho na tela. Ver `custoPorLinha`.
  const [custosSalvos,setCustosSalvos]=useState<Record<string,number>>({});
  const columns:Record<ShopeeModuleKind,[string,string][]>= {monitor:[["orderId","Pedido"],["date","Data"],["status","Status"],["revenue","Receita"],["marketplaceFees","Taxas"],["contribution","Resultado"]],catalog:[["title","Produto"],["sku","SKU"],["status","Status"],["price","Preço"],["availableQty","Disponível"]],inventory:[["title","Produto"],["sku","SKU"],["availableQty","Disponível"],["unitsSold","Vendidas"],["averagePerDay","Média/dia"],["daysRemaining","Dias restantes"]],costs:[["title","Produto"],["sku","SKU"],["unidades30d","Vendidas (30 dias)"],["cost","Custo"]],abc:[["class","Classe"],["title","Produto"],["sku","SKU"],["revenue","Receita"],["revenueShare","Participação"],["profit","Lucro"]]};
  const currencyKeys=new Set(["revenue","marketplaceFees","contribution","price","cost","profit"]);
  return <section className="listing-table-shell channel-module-table-shell" aria-labelledby={`shopee-${kind}-table-title`}><header><div><p className="section-kicker">Registros</p><h2 id={`shopee-${kind}-table-title`}>{SHOPEE_MODULES[kind].title}</h2></div><p>{rows.length} nesta página</p></header><div className="overflow-x-auto"><table className="listing-table channel-module-table"><caption className="sr-only">{SHOPEE_MODULES[kind].title}</caption><thead><tr>{columns[kind].map(([key,label])=><th scope="col" key={key}>{label}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={String(row.orderId??row.productId??row.id??index)}>{columns[kind].map(([key])=><td className="tabular-nums" key={key}>{kind==="costs"&&key==="cost"?<CostEditor key={String(row.id)} row={{...row,cost:custoExibido(custosSalvos,row)}} connectionId={connectionId} onSaved={salvo=>setCustosSalvos(atual=>comCustoSalvo(atual,salvo.chave,salvo.valor))}/>:key==="unidades30d"?<VendidasEVariacoes unidades={Number(row.unidades30d??0)} variacoes={Number(row.variacoesVendidas??0)}/>:key==="daysRemaining"&&row[key]==null?"Sem base de venda":key==="revenueShare"&&row[key]!=null?`${show(row[key])}%`:key==="status"&&row[key]!=null?(kind==="monitor"?rotuloStatusShopee(String(row[key])):rotuloStatusProduto(String(row[key]))):currencyKeys.has(key)?money(row[key],String(row.currency??"BRL")):pareceData(row[key])?dataHoraNaTabela(row[key]):show(row[key])}</td>)}</tr>)}</tbody></table></div>{kind==="costs"&&<p className="channel-module-method">Custo desconhecido permanece “—”. Informe zero somente quando ele for um fato.</p>}</section>;
}

/**
 * O número que ORDENA a lista, na própria linha — e o aviso de variação.
 *
 * Mostrar o número é o que faz a ordem ser confiável: sem ele a pessoa não sabe
 * por que aquele produto está no topo, e ordem que não se explica não se usa.
 *
 * ⚠️ "N variações" é INFORMAÇÃO, não bloqueio. Enquanto o custo for por anúncio
 * (até a ADR-029 sair), um campo só cobre todas as variações daquele anúncio —
 * e é exatamente nos mais vendidos que isso mais acontece (medido: 19 dos 31 que
 * venderam em 30 dias, 74% das unidades). Bloquear o campo frustraria quem pediu
 * facilidade; esconder o fato seria pior. Mostrar deixa ela decidir.
 *
 * Zero venda é ZERO, que é fato — não vira "—" nem some da lista.
 */
function VendidasEVariacoes({unidades,variacoes}:{unidades:number;variacoes:number}) {
  return <>
    {unidades.toLocaleString("pt-BR")}
    {variacoes>1&&<small className="channel-module-method" style={{display:"block"}}>{variacoes} variações neste anúncio</small>}
  </>;
}

/**
 * ⚠️ SALVAR NAO RECARREGA A TELA.
 *
 * Ate 29/08/2026 este save terminava em `retry()`, que subia o contador de
 * tentativa; o efeito do modulo zera o payload e a tela INTEIRA virava
 * esqueleto. A dona do produto pediu o contrario, com estas palavras: "quero
 * apenas digitar, salvar, sem ter nenhum carregamento a partir disso".
 *
 * Agora o valor volta pela RESPOSTA do proprio POST (uma requisicao, e so uma)
 * e sobe para o pai, que aplica o patch na tabela. Ver `custoPorLinha`.
 *
 * ⚠️ O BOTAO NAO E DESABILITADO ENQUANTO SALVA, e isso e deliberado.
 *
 * Medido em producao em 29/08/2026, quadro a quadro: com `disabled`, o foco ia
 * para o <body> no QUADRO EXATO em que o botao era desabilitado (55ms) e nao
 * voltava quando ele era reabilitado (538ms). O navegador tira o foco de
 * elemento desabilitado, e quem preenche a coluna inteira pelo teclado perdia o
 * lugar a cada custo salvo — metade da queixa continuava viva mesmo depois de a
 * tela parar de recarregar.
 *
 * O que o `disabled` protegia era o clique duplo, e isso agora e barrado dentro
 * do proprio `save`. O botao segue anunciando o estado por `aria-busy` e pelo
 * rotulo, entao nada se perde para quem le a tela.
 */
function CostEditor({row,connectionId,onSaved}:{row:Record<string,unknown>;connectionId:string;onSaved:(salvo:CustoSalvo)=>void}) {
  const [draft,setDraft]=useState(row.cost==null?"":String(row.cost)),[state,setState]=useState<EstadoDoCusto>("idle");
  async function save(){
    // Reentrada barrada aqui, e nao pelo `disabled` do botao — ver a nota abaixo.
    if(state==="saving")return;
    const cost=custoValido(draft);
    if(cost===null){setState(proximoEstado(state,"invalido"));return}
    setState(proximoEstado(state,"salvou"));
    try{
      const salvo=await salvarCusto({
        url:`/api/integrations/shopee/costs?${new URLSearchParams({connection_id:connectionId})}`,
        corpo:{productId:row.productId,sku:row.sku??null,title:row.title,cost},
        buscar:fetch,
      });
      setState(proximoEstado(state,"ok"));
      onSaved(salvo);
    }catch{setState(proximoEstado(state,"falhou"))}
  }
  // Mensagens SEPARADAS: campo invalido e falha de rede pedem acoes diferentes,
  // e a mesma frase para as duas escondia qual das duas aconteceu.
  const aviso=state==="invalido"?"Informe um custo válido: número maior ou igual a zero."
    :state==="error"?`${ROTULO_DO_CUSTO.error}. Tente de novo.`
      :state==="saving"?ROTULO_DO_CUSTO.saving
        :state==="saved"?ROTULO_DO_CUSTO.saved
          :row.cost==null?ROTULO_DO_CUSTO.pendente:"";
  const falhou=state==="invalido"||state==="error";
  return <div className="channel-cost-editor"><label className="sr-only" htmlFor={`shopee-cost-${row.id}`}>Custo de {show(row.title)}</label><input id={`shopee-cost-${row.id}`} type="number" min="0" step="0.01" inputMode="decimal" value={draft} onChange={event=>{setDraft(event.target.value);setState(proximoEstado(state,"editou"))}} aria-invalid={falhou} aria-describedby={`shopee-cost-status-${row.id}`} placeholder="—"/><button type="button" aria-busy={state==="saving"} onClick={save}>{state==="saving"?ROTULO_DO_CUSTO.saving:"Salvar"}</button><small id={`shopee-cost-status-${row.id}`} aria-live="polite" role={falhou?"alert":undefined} className={falhou?"is-error":undefined}>{aviso}</small></div>;
}
