"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "./EmptyState"; import { DashboardSkeleton } from "./LoadingState"; import { PageHeader } from "./PageHeader";
import { DashboardPeriodFilter, useDashboardPeriod } from "./DashboardPeriodFilter";
import { ChannelModuleSummary } from "./ChannelModuleSummary";
import { ChannelConnectionEmpty } from "./ChannelConnectionEmpty";
import { moduleApiQuery, moduleConnectionHref, moduleError, moduleHref, moduleMoney, updatedModuleQuery } from "./TikTokModulesModel";
import { TIKTOK_CATALOG_STATUSES } from "@/lib/integrations/tiktokModuleContract";
import { rotuloConciliacao, rotuloStatusPedido, rotuloStatusProduto } from "./statusDeExibicao";
import { BaseDeData } from "./BaseDeData";

type Kind="monitor"|"finance"|"catalog"|"inventory"|"costs"|"abc";
type Connection={id:string;displayName?:string;externalAccountId?:string};
type ProviderIssue={status:"attention";code:"OWNERSHIP_CONFLICT"|"PROVIDER_READ_FAILED";message:string};
type FinanceCoverage={status?:"complete"|"partial"|"blocked";terminal?:boolean;from?:string;to?:string;source?:"statement_ledger"|"per_order_fallback"|"schema_blocked";estimatesIncluded?:false;rejected?:number};
type Payload={items?:Record<string,unknown>[];costs?:Record<string,unknown>[];availability?:string;page?:{limit:number;offset:number;total:number|null;hasMore:boolean};coverage?:FinanceCoverage|null;profitSubset?:{reason?:string};code?:string;error?:string};
const config:Record<Kind,{title:string;subtitle:string;endpoint:string;period:boolean}>={monitor:{title:"Monitor da conta",subtitle:"Pedidos e estado de conciliação, sem dados pessoais do comprador.",endpoint:"monitor",period:true},finance:{title:"Financeiro",subtitle:"Transações finais do ledger e cobertura dos extratos, sem estimativas.",endpoint:"finance",period:true},catalog:{title:"Anúncios",subtitle:"Catálogo publicado e variações em modo somente leitura.",endpoint:"catalog",period:false},inventory:{title:"Radar de estoque",subtitle:"Cobertura e risco de ruptura, sem projetar quando falta base de venda.",endpoint:"inventory",period:true},costs:{title:"Produtos",subtitle:"Custos por SKU exclusivos desta loja TikTok Shop.",endpoint:"costs",period:false},abc:{title:"Curva ABC",subtitle:"Receita por produto e participação acumulada no período.",endpoint:"abc",period:true}};
const text=(v:unknown)=>v==null||v===""?"—":String(v);

export function TikTokModulePage({kind}:{kind:Kind}) { const cfg=config[kind], router=useRouter(), sp=useSearchParams(); const update=useCallback((values:Record<string,string|null>)=>{router.push(`${location.pathname}?${updatedModuleQuery(sp.toString(),values)}`,{scroll:false})},[router,sp]); const syncPeriod=useCallback((query:string)=>{const source=new URLSearchParams(query);if(source.has("from")&&source.has("to")){update({from:source.get("from"),to:source.get("to")});return}const days=source.get("days")??"30",to=new Date(),from=new Date(to);if(days!=="today")from.setDate(from.getDate()-Math.max(0,Number(days)-1));const iso=(date:Date)=>date.toISOString().slice(0,10);update({from:iso(from),to:iso(to)})},[update]); const period=useDashboardPeriod(sp.toString(),cfg.period?syncPeriod:undefined); const [connections,setConnections]=useState<Connection[]|null>(null); const [providerIssue,setProviderIssue]=useState<ProviderIssue|null>(null); const [data,setData]=useState<{id:string;body:Payload}|null>(null); const [error,setError]=useState(""); const [attempt,setAttempt]=useState(0); const requested=sp.get("connection_id");
  useEffect(()=>{let live=true;fetch("/api/integrations",{cache:"no-store"}).then(r=>r.json().then(b=>{if(!r.ok)throw Error();return b})).then(b=>{const p=b.providers?.find((x:{id:string})=>x.id==="tiktok_shop");if(live){setConnections((p?.connections??[]).slice().sort((a:Connection,b:Connection)=>a.id.localeCompare(b.id)));setProviderIssue(p?.issue??null)}}).catch(()=>live&&setError("Não foi possível carregar as conexões."));return()=>{live=false}},[attempt]);
  const selected=connections?.find(c=>c.id===requested)??connections?.[0]??null;
  useEffect(()=>{if(selected&&requested!==selected.id)router.replace(moduleHref(location.pathname,sp.toString(),selected.id),{scroll:false})},[requested,router,selected,sp]);
  const query=useMemo(()=>selected?moduleApiQuery(sp.toString(),selected.id,kind):"",[kind,selected,sp]);
  // Clear the previous connection synchronously so its data can never flash under a new store selector.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{if(!selected)return;let live=true;setData(null);setError("");fetch(`/api/integrations/tiktok/${cfg.endpoint}?${query}`,{cache:"no-store"}).then(async r=>{const b=await r.json();if(!r.ok)throw new Error(moduleError(b.code)||b.error||"Não foi possível carregar este módulo.");return b}).then(body=>live&&setData({id:selected.id,body})).catch(e=>live&&setError(e.message));return()=>{live=false}},[attempt,cfg.endpoint,query,selected]);
  const retry=useCallback(()=>setAttempt(x=>x+1),[]); const body=data&&data.id===selected?.id?data.body:null;
  return <div className={`channel-module-page analysis-page channel-module-${kind}`}>
    {cfg.period&&<DashboardPeriodFilter {...period.filterProps}/>}
    <PageHeader eyebrow="TikTok Shop" title={cfg.title} subtitle={cfg.subtitle} action={selected&&connections&&<label className="channel-store-selector">Loja<select aria-label="Loja TikTok Shop" value={selected.id} onChange={e=>router.push(moduleConnectionHref(location.pathname,sp.toString(),e.target.value),{scroll:false})}>{connections.map(c=><option key={c.id} value={c.id}>{c.displayName||c.externalAccountId||c.id}</option>)}</select></label>}/>
    {!connections&&!error?<DashboardSkeleton/>:providerIssue?<EmptyState kind="permission" title={providerIssue.code==="OWNERSHIP_CONFLICT"?"Conexão TikTok protegida":"Canal TikTok requer atenção"} description={providerIssue.message} action={<Link className="meli-primary-action" href="/integracoes">Gerenciar conexões</Link>}/>:connections?.length===0?<ChannelConnectionEmpty channel="TikTok Shop" description="Conecte uma loja para acessar este módulo." action={<Link className="meli-primary-action" href="/integracoes">Gerenciar conexões</Link>}/>:error?<EmptyState kind="permission" title="Não foi possível carregar" description={error} action={<button className="meli-primary-action min-h-11" onClick={retry}>Tentar novamente</button>}/>:!body?<DashboardSkeleton/>:body.availability==="BLOCKED"?<EmptyState kind="permission" title="Financeiro aguardando estrutura de dados" description="O ledger financeiro ainda não está disponível neste ambiente. Nenhum valor foi estimado ou convertido em zero."/>:body.availability==="NOT_AVAILABLE"?<EmptyState title="Dados ainda indisponíveis" description="A conexão existe, mas este conjunto de dados ainda não foi materializado."/>:<ModuleContent kind={kind} body={body} sp={sp} update={update} retry={retry}/>}</div>;
}

function Filters({kind,sp,update}:{kind:Kind;sp:URLSearchParams;update:(v:Record<string,string|null>)=>void}) {
  const [q,setQ]=useState(sp.get("q")??""), [orderId,setOrderId]=useState(sp.get("order_id")??""), [sku,setSku]=useState(sp.get("sku")??"");
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{setQ(sp.get("q")??"");setOrderId(sp.get("order_id")??"");setSku(sp.get("sku")??"")},[sp]);
  const status=sp.get("status")??"";
  const submit=(e:React.FormEvent)=>{e.preventDefault();update(kind==="monitor"?{order_id:orderId||null,sku:sku||null}:{q:q||null})};
  return <form className={`listing-controls channel-module-filters is-${kind}`} onSubmit={submit}>
    {["catalog","inventory","costs"].includes(kind)&&<label className="listing-search"><span className="sr-only">Buscar</span><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Produto, SKU ou ID"/></label>}
    {kind==="monitor"&&<><label><span>Pedido</span><input value={orderId} onChange={e=>setOrderId(e.target.value)} placeholder="ID exato do pedido"/></label><label><span>SKU</span><input value={sku} onChange={e=>setSku(e.target.value)} placeholder="SKU exato"/></label></>}
    {["monitor","catalog"].includes(kind)&&<label><span>Status</span><select value={status} onChange={e=>update({status:e.target.value||null})}><option value="">Todos</option>{(kind==="monitor"?["pending","paid","shipped","delivered","cancelled"]:TIKTOK_CATALOG_STATUSES).map(value=><option key={value} value={value}>{kind==="monitor"?rotuloStatusPedido(value):rotuloStatusProduto(value)}</option>)}</select></label>}
    {kind==="inventory"&&<label><span>Situação</span><select value={sp.get("filter")??""} onChange={e=>update({filter:e.target.value||null})}><option value="">Todos</option><option value="out">Sem estoque</option><option value="low">Estoque baixo</option><option value="no_sales">Sem vendas</option></select></label>}
    {["monitor","catalog","inventory","costs"].includes(kind)&&<button className="listing-refresh" type="submit">Aplicar filtros</button>}
  </form>
}
function ModuleContent({kind,body,sp,update,retry}:{kind:Kind;body:Payload;sp:URLSearchParams;update:(v:Record<string,string|null>)=>void;retry:()=>void}) {
  const rows=(kind==="costs"?body.costs:body.items)??[];
  return <section className="channel-module-content" aria-live="polite">
    <ChannelModuleSummary kind={kind} rows={rows} total={body.page?.total}/>
    <Filters kind={kind} sp={sp} update={update}/>
    {kind==="abc"&&<aside className="channel-module-notice is-warning"><strong>Lucro indisponível por SKU</strong><p>{body.profitSubset?.reason||"O contrato atual não permite atribuir lucro por produto com segurança."}</p></aside>}
    {kind==="abc"&&rows.length>0&&<TikTokAbcInsights rows={rows}/>}
    {kind==="finance"&&<BaseDeData base="pedido-extrato" prefixo="Transações" />}
    {kind==="finance"&&body.coverage&&<FinanceCoveragePanel coverage={body.coverage}/>} 
    {!rows.length?<EmptyState compact title="Nenhum resultado" description={kind==="finance"?"Não há transações finais para esta loja e período.":"Não há dados para os filtros e o período selecionados."}/>:<DataTable kind={kind} rows={rows} retry={retry} connectionId={sp.get("connection_id")??""}/>} 
    {body.page&&<nav aria-label="Paginação" className="listing-pagination channel-module-pagination"><p>{body.page.total==null?`${rows.length} transação(ões) nesta página`:`${body.page.total} resultado(s)`}</p><div><button disabled={body.page.offset===0} onClick={()=>update({offset:String(Math.max(0,body.page!.offset-body.page!.limit))})}>Anterior</button><button disabled={!body.page.hasMore} onClick={()=>update({offset:String(body.page!.offset+body.page!.limit)})}>Próxima</button></div></nav>}
  </section>
}

function TikTokAbcInsights({rows}:{rows:Record<string,unknown>[]}) {
  const ranked=useMemo(()=>rows
    .map((row)=>({
      id:String(row.productId??row.sku??row.title),
      title:text(row.title),
      sku:text(row.sku),
      abc:String(row.class??"C").toUpperCase(),
      revenue:Number(row.revenue??0),
      share:Number(row.revenueShare??0),
      currency:String(row.currency??"BRL"),
    }))
    .sort((a,b)=>b.revenue-a.revenue),[rows]);
  const maximum=Math.max(...ranked.map((row)=>row.revenue),1);
  const top=ranked.slice(0,8);
  const topThreeShare=ranked.slice(0,3).reduce((sum,row)=>sum+row.share,0);
  const classes=["A","B","C"].map((abc)=>{
    const members=ranked.filter((row)=>row.abc===abc);
    return {
      abc,
      count:members.length,
      revenue:members.reduce((sum,row)=>sum+row.revenue,0),
      share:members.reduce((sum,row)=>sum+row.share,0),
    };
  });
  const currency=ranked[0]?.currency??"BRL";

  return <section className="tiktok-abc-insights" aria-labelledby="tiktok-abc-insights-title">
    <header>
      <div>
        <p className="section-kicker">Concentração da receita</p>
        <h2 id="tiktok-abc-insights-title">Onde as vendas se concentram</h2>
      </div>
      <p><strong>{topThreeShare.toLocaleString("pt-BR",{maximumFractionDigits:1})}%</strong> da receita está nos 3 primeiros produtos.</p>
    </header>
    <div className="tiktok-abc-insights-grid">
      <article aria-labelledby="tiktok-abc-top-title">
        <div className="tiktok-abc-panel-heading">
          <h3 id="tiktok-abc-top-title">Top produtos</h3>
          <span>Receita</span>
        </div>
        <ol className="tiktok-abc-ranking">
          {top.map((row,index)=><li key={row.id}>
            <span className="tiktok-abc-position">{index+1}</span>
            <div className="tiktok-abc-product">
              <div className="tiktok-abc-bar" aria-hidden="true"><i style={{width:`${Math.max(3,(row.revenue/maximum)*100)}%`}}/></div>
              <strong title={row.title}>{row.title}</strong>
              <small>{row.sku}</small>
            </div>
            <span className="tiktok-abc-value"><strong>{moduleMoney(row.revenue,row.currency)}</strong><small>{row.share.toLocaleString("pt-BR",{maximumFractionDigits:1})}%</small></span>
          </li>)}
        </ol>
      </article>
      <article aria-labelledby="tiktok-abc-classes-title">
        <div className="tiktok-abc-panel-heading">
          <h3 id="tiktok-abc-classes-title">Classes ABC</h3>
          <span>Nesta página</span>
        </div>
        <dl className="tiktok-abc-classes">
          {classes.map((group)=><div key={group.abc} className={`is-${group.abc.toLowerCase()}`}>
            <dt><span>Classe {group.abc}</span><small>{group.count} produto{group.count===1?"":"s"}</small></dt>
            <dd><strong>{group.share.toLocaleString("pt-BR",{maximumFractionDigits:1})}%</strong><small>{moduleMoney(group.revenue,currency)}</small></dd>
            <span className="tiktok-abc-class-bar" aria-hidden="true"><i style={{width:`${Math.min(100,Math.max(group.share>0?3:0,group.share))}%`}}/></span>
          </div>)}
        </dl>
        <p className="tiktok-abc-method">A participação vem do período completo. As contagens e receitas acima descrevem apenas os produtos carregados nesta página.</p>
      </article>
    </div>
  </section>
}
function FinanceCoveragePanel({coverage}:{coverage:FinanceCoverage}) { const complete=coverage.status==="complete"; const falhas=coverage.rejected??0; const source=coverage.source==="statement_ledger"?"Extratos oficiais":coverage.source==="per_order_fallback"?"Extrato por pedido":"Estrutura indisponível"; const date=(value?:string)=>value?new Intl.DateTimeFormat("pt-BR").format(new Date(value)):"—"; return <aside className={`channel-finance-coverage ${complete?"is-complete":"is-partial"}`} role="status"><div><div><strong>{complete?"Cobertura financeira completa":"Extrato oficial ainda não postado"}</strong><p>{complete?"A janela foi concluída pelo ledger de extratos.":"A lista traz as transações finais já postadas pela TikTok. O que ainda não veio não foi estimado nem virou zero."}</p></div><span>{source}</span></div><dl><div><dt>Janela</dt><dd>{date(coverage.from)} a {date(coverage.to)}</dd></div><div><dt>Terminal</dt><dd>{coverage.terminal?"Sim":"Não"}</dd></div></dl>{falhas>0&&<p className="channel-module-method">{falhas} tentativa(s) de leitura do extrato falharam em janelas de sincronização que tocam este período. O NEXO repete sozinho, com espera crescente entre as tentativas; o período acima fechou sem depender delas.</p>}</aside> }
function DataTable({kind,rows,retry,connectionId}:{kind:Kind;rows:Record<string,unknown>[];retry:()=>void;connectionId:string}) { const columns:Record<Kind,[string,string][]>={monitor:[["orderId","Pedido"],["occurredAt","Data"],["status","Status"],["gross","Total"],["buyerShipping","Frete comprador"],["financialStatus","Conciliação"]],finance:[["transactionId","Transação"],["occurredAt","Data"],["type","Tipo"],["orderId","Pedido relacionado"],["revenue","Receita"],["adjustment","Ajuste"]],catalog:[["title","Produto"],["sku","SKU"],["status","Status"],["price","Preço"],["availableQty","Disponível"],["updatedAt","Atualizado"]],inventory:[["title","Produto"],["sku","SKU"],["availableQty","Disponível"],["unitsSold","Vendidas"],["averagePerDay","Média/dia"],["daysRemaining","Dias restantes"]],costs:[["title","Produto"],["sku","SKU"],["cost","Custo"]],abc:[["class","Classe"],["title","Produto"],["sku","SKU"],["revenue","Receita"],["revenueShare","Participação"],["profit","Lucro"]]}; const moneyKeys=new Set(["gross","buyerShipping","sellerShipping","revenue","adjustment","profit","price","cost"]); return <section className="listing-table-shell channel-module-table-shell" aria-labelledby={`tiktok-${kind}-table-title`}><header><div><p className="section-kicker">Registros</p><h2 id={`tiktok-${kind}-table-title`}>{config[kind].title}</h2></div><p>{rows.length} nesta página</p></header><div className="overflow-x-auto"><table className="listing-table channel-module-table"><caption className="sr-only">{config[kind].title}: resultados filtrados</caption><thead><tr>{columns[kind].map(([k,l])=><th scope="col" key={k}>{l}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={String(r.transactionId??r.orderId??r.productId??r.id??i)}>{columns[kind].map(([k])=><td className={moneyKeys.has(k)||typeof r[k]==="number"?"tabular-nums":""} key={k}>{kind==="costs"&&k==="cost"?<CostEditor row={r} connectionId={connectionId} onSaved={retry}/>:k==="daysRemaining"&&r[k]==null?"Sem base de venda":k==="profit"&&r[k]==null?"—":k==="revenueShare"&&r[k]!=null?`${text(r[k])}%`:k==="status"&&r[k]!=null?(kind==="monitor"?rotuloStatusPedido(String(r[k])):rotuloStatusProduto(String(r[k]))):k==="financialStatus"&&r[k]!=null?rotuloConciliacao(String(r[k])):moneyKeys.has(k)?moduleMoney(r[k],String(r.currency??"BRL")):k.endsWith("At")&&r[k]?new Intl.DateTimeFormat("pt-BR").format(new Date(String(r[k]))):text(r[k])}</td>)}</tr>)}</tbody></table></div>{kind==="costs"&&<p className="channel-module-method">Cada custo fica isolado por workspace, loja TikTok Shop e SKU. Custo desconhecido permanece “—”; zero só deve ser informado quando for um fato.</p>}{kind==="finance"&&<p className="channel-module-method">Somente campos sanitizados do ledger são exibidos. Dados pessoais e payloads brutos da TikTok Shop não fazem parte desta superfície.</p>}</section> }

function CostEditor({row,connectionId,onSaved}:{row:Record<string,unknown>;connectionId:string;onSaved:()=>void}) { const [draft,setDraft]=useState(row.cost==null?"":String(row.cost)); const [state,setState]=useState<"idle"|"saving"|"error">("idle"); useEffect(()=>{queueMicrotask(()=>setDraft(row.cost==null?"":String(row.cost)))},[row.cost]); async function save(){const cost=Number(draft);if(draft.trim()===""||!Number.isFinite(cost)||cost<0){setState("error");return}setState("saving");try{const response=await fetch(`/api/integrations/tiktok/costs?${new URLSearchParams({connection_id:connectionId})}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({productId:row.productId,sku:row.sku??null,title:row.title,cost})});if(!response.ok)throw new Error();setState("idle");onSaved()}catch{setState("error")}} return <div className="channel-cost-editor"><label className="sr-only" htmlFor={`cost-${row.id}`}>Custo de {text(row.title)}</label><input id={`cost-${row.id}`} type="number" min="0" step="0.01" inputMode="decimal" value={draft} onChange={e=>{setDraft(e.target.value);setState("idle")}} placeholder="—" aria-invalid={state==="error"}/><button type="button" disabled={state==="saving"} onClick={save}>{state==="saving"?"Salvando…":"Salvar"}</button>{state==="error"&&<span className="sr-only" role="alert">Custo inválido ou falha ao salvar.</span>}</div> }
