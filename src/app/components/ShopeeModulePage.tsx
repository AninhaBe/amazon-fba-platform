"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "./EmptyState";
import { DashboardSkeleton } from "./LoadingState";
import { PageHeader } from "./PageHeader";
import { DashboardPeriodFilter, useDashboardPeriod } from "./DashboardPeriodFilter";
import { SHOPEE_MODULES, shopeeModuleError, shopeeModuleHref, shopeeModuleQuery, type ShopeeModuleKind } from "./ShopeeModulesModel";
import { parseShopeeTaxRateDraft, shopeeSettingsPath } from "./ShopeeSettingsModel";
import { shopeeProviderIssueContent, type ShopeeProviderIssue } from "./ShopeeWorkspaceModel";

type Connection={id:string;status:string;displayName?:string;externalAccountId?:string;metadata?:{demo?:boolean}};
type Coverage={complete?:boolean;capturedOrders?:number;totalOrders?:number;processedOrders?:number;paidOrders?:number};
type Payload={items?:Record<string,unknown>[];orders?:Record<string,unknown>[];availability?:string;page?:{limit:number;offset:number;total:number;returned?:number;hasMore:boolean;complete?:boolean};coverage?:Coverage|null;profitSubset?:{reason?:string};profit?:({coverage?:Coverage}&Record<string,unknown>)|null;error?:string;code?:string};
const money=(value:unknown,currency="BRL")=>value==null?"—":new Intl.NumberFormat("pt-BR",{style:"currency",currency}).format(Number(value));
const show=(value:unknown)=>value==null||value===""?"—":String(value);

export function ShopeeModulePage({kind}:{kind:ShopeeModuleKind}) {
  const cfg=SHOPEE_MODULES[kind], router=useRouter(), params=useSearchParams();
  const [connections,setConnections]=useState<Connection[]|null>(null), [providerIssue,setProviderIssue]=useState<ShopeeProviderIssue|null>(null), [payload,setPayload]=useState<Payload|null>(null), [error,setError]=useState(""), [attempt,setAttempt]=useState(0);
  const update=useCallback((values:Record<string,string|null>)=>{const next=new URLSearchParams(params.toString());for(const [key,value] of Object.entries(values)){if(value)next.set(key,value);else next.delete(key)}if(!("offset" in values))next.set("offset","0");router.push(`${location.pathname}?${next}`,{scroll:false})},[params,router]);
  const period=useDashboardPeriod(params.toString(), query=>{const p=new URLSearchParams(query);update({days:p.get("days")??"30"})});
  useEffect(()=>{let active=true;fetch("/api/integrations",{cache:"no-store"}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error);return body}).then(body=>{const provider=body.providers?.find((item:{id:string})=>item.id==="shopee");if(active){const issue=(provider?.issue??null) as ShopeeProviderIssue|null;setProviderIssue(issue);setConnections(issue?[]:provider?.connections??[])}}).catch(()=>active&&setError("Não foi possível carregar as conexões."));return()=>{active=false}},[attempt]);
  const requested=params.get("connection_id"), connected=connections?.filter(item=>item.status==="connected")??null, selected=connected?.find(item=>item.id===requested)??connected?.[0]??null, selectedId=selected?.id??null;
  useEffect(()=>{if(selected&&requested!==selected.id)router.replace(shopeeModuleHref(location.pathname,params.toString(),selected.id),{scroll:false})},[params,requested,router,selected]);
  const query=selectedId?shopeeModuleQuery(params.toString(),selectedId,kind):"";
  // Clear stale rows before fetching another connection or filter combination.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{if(!selectedId)return;let active=true;setPayload(null);setError("");fetch(`/api/integrations/shopee/${cfg.endpoint}?${query}`,{cache:"no-store"}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(shopeeModuleError(body.code)||body.error||"Não foi possível carregar este módulo.");return body}).then(body=>active&&setPayload(body)).catch(reason=>active&&setError(reason.message));return()=>{active=false}},[attempt,cfg.endpoint,query,selectedId]);
  const retry=()=>setAttempt(value=>value+1);
  const attention=connections?.some(item=>item.status==="attention"||item.status==="disconnected");
  const issueContent=shopeeProviderIssueContent(providerIssue);
  return <><PageHeader eyebrow="Shopee" title={cfg.title} subtitle={cfg.subtitle} action={selected&&connected&&<label className="flex min-w-52 flex-col gap-1 text-xs font-semibold text-slate-500">Loja<select aria-label="Loja Shopee" className="min-h-11 rounded-lg bg-white px-3 text-base shadow-[inset_0_0_0_1px_rgb(203_213_225)] focus:outline-none focus:ring-2 focus:ring-[var(--channel-accent)] sm:text-sm" value={selected.id} onChange={event=>router.push(shopeeModuleHref(location.pathname,params.toString(),event.target.value),{scroll:false})}>{connected.map(item=><option value={item.id} key={item.id}>{item.displayName||item.externalAccountId||item.id}</option>)}</select></label>}/>
    {cfg.period&&selected&&<DashboardPeriodFilter {...period.filterProps}/>} 
    {!connections&&!error?<DashboardSkeleton/>:issueContent?<EmptyState kind="permission" title={issueContent.title} description={issueContent.description} action={<Link href="/integracoes" className="meli-primary-action">{issueContent.actionLabel}</Link>}/>:!selected&&!error?<EmptyState kind={attention?"permission":undefined} title={attention?"Reconecte a loja Shopee":"Nenhuma loja Shopee conectada"} description={attention?"A autorização expirou ou foi interrompida. Reconecte para retomar a sincronização.":"Conecte uma loja para acessar este módulo."} action={<Link href="/integracoes" className="meli-primary-action">Gerenciar conexões</Link>}/>:error?<EmptyState kind="permission" title="Não foi possível carregar" description={error} action={<button type="button" className="meli-primary-action min-h-11 active:scale-[0.96] transition-transform" onClick={retry}>Tentar novamente</button>}/>:!payload?<DashboardSkeleton/>:payload.availability==="NOT_AVAILABLE"?<EmptyState title="Dados ainda indisponíveis" description="A loja está conectada, mas este conjunto ainda não foi materializado pela sincronização."/>:<Content kind={kind} body={payload} params={params} update={update} connectionId={selected!.id} retry={retry}/>}</>;
}

function Content({kind,body,params,update,connectionId,retry}:{kind:ShopeeModuleKind;body:Payload;params:URLSearchParams;update:(v:Record<string,string|null>)=>void;connectionId:string;retry:()=>void}) {
  const rows=(kind==="monitor"?body.orders:body.items)??[], [search,setSearch]=useState(params.get("q")??""), coverage=body.coverage??body.profit?.coverage;
  return <section aria-live="polite">
    {kind==="costs"&&<ShopeeTaxRateEditor key={connectionId} connectionId={connectionId}/>} 
    {coverage&&!coverage.complete&&<aside role="status" className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><strong>Cobertura parcial</strong><p className="mt-1">Foram processados {show(coverage.capturedOrders??coverage.processedOrders)} de {show(coverage.totalOrders??coverage.paidOrders)} pedidos. Os valores não representam o período completo.</p></aside>}
    {kind==="inventory"&&<aside className="mb-4 rounded-xl bg-sky-50 p-4 text-sm text-sky-900">Quantidades agregadas por anúncio. Estoque por variação/modelo não está disponível.</aside>}
    {kind==="abc"&&<aside className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><strong>Lucro por SKU indisponível</strong><p className="mt-1">{body.profitSubset?.reason||"O contrato atual não permite atribuir lucro por produto com segurança."}</p></aside>}
    {["catalog","inventory","costs"].includes(kind)&&<form className="mb-5 flex items-end gap-3" onSubmit={event=>{event.preventDefault();update({q:search||null})}}><label className="flex min-w-60 flex-1 flex-col gap-1 text-sm font-medium text-slate-700">Buscar<input value={search} maxLength={120} onChange={event=>setSearch(event.target.value)} placeholder="Produto, SKU ou ID" className="min-h-11 rounded-lg px-3 shadow-[inset_0_0_0_1px_rgb(203_213_225)]"/></label><button className="meli-primary-action min-h-11 active:scale-[0.96] transition-transform">Aplicar filtro</button></form>}
    {!rows.length?<EmptyState compact title="Nenhum resultado" description="Não há dados para os filtros e o período selecionados."/>:<Table kind={kind} rows={rows} connectionId={connectionId} retry={retry}/>} 
    {body.page&&<nav aria-label="Paginação" className="mt-4 flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-sm tabular-nums text-slate-500">Exibindo {body.page.total===0?0:body.page.offset+1}–{Math.min(body.page.offset+(body.page.returned??rows.length),body.page.total)} de {body.page.total} resultado(s). {body.page.complete===false||body.page.hasMore?"Há mais resultados; esta página não representa o conjunto completo.":"Cobertura completa."}</p><div className="flex gap-2"><button className="min-h-11 rounded-lg px-4 shadow-[inset_0_0_0_1px_rgb(203_213_225)] active:scale-[0.96] transition-transform disabled:opacity-40" disabled={!body.page.offset} onClick={()=>update({offset:String(Math.max(0,body.page!.offset-body.page!.limit))})}>Anterior</button><button className="min-h-11 rounded-lg px-4 shadow-[inset_0_0_0_1px_rgb(203_213_225)] active:scale-[0.96] transition-transform disabled:opacity-40" disabled={!body.page.hasMore} onClick={()=>update({offset:String(body.page!.offset+body.page!.limit)})}>Próxima</button></div></nav>}
  </section>;
}

function ShopeeTaxRateEditor({connectionId}:{connectionId:string}) {
  const [draft,setDraft]=useState("");
  const [state,setState]=useState<"loading"|"idle"|"saving"|"saved"|"error">("loading");
  const [message,setMessage]=useState("");

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
      setMessage(body.taxRate==null
        ?"Alíquota removida; imposto e lucro voltam a ficar indisponíveis."
        :"Alíquota salva para esta loja.");
    }catch(error){
      setState("error");setMessage(error instanceof Error?error.message:"Não foi possível salvar a alíquota.");
    }
  }

  return <form onSubmit={save} className="mb-5 rounded-xl bg-slate-50 p-4 shadow-[inset_0_0_0_1px_rgb(226_232_240)]">
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
        <span>Alíquota média de imposto</span>
        <span className="flex items-center rounded-lg bg-white shadow-[inset_0_0_0_1px_rgb(203_213_225)]">
          <input aria-label="Alíquota média de imposto da Shopee" type="text" inputMode="decimal" value={draft}
            disabled={state==="loading"||state==="saving"} onChange={event=>{setDraft(event.target.value);setState("idle");setMessage("")}}
            placeholder="Desconhecida" className="min-h-11 min-w-0 flex-1 bg-transparent px-3 outline-none"/>
          <span className="pr-3 text-slate-500">%</span>
        </span>
      </label>
      <button type="submit" disabled={state==="loading"||state==="saving"} className="meli-primary-action min-h-11 disabled:opacity-50">
        {state==="loading"?"Carregando…":state==="saving"?"Salvando…":"Salvar alíquota"}
      </button>
    </div>
    <p className="mt-2 text-xs text-slate-500">Use a alíquota efetiva da empresa para esta loja. Zero é um valor conhecido; deixe em branco e salve para voltar a desconhecido.</p>
    {message&&<p role={state==="error"?"alert":"status"} className={`mt-2 text-sm ${state==="error"?"text-red-700":"text-emerald-700"}`}>{message}</p>}
  </form>;
}

function Table({kind,rows,connectionId,retry}:{kind:ShopeeModuleKind;rows:Record<string,unknown>[];connectionId:string;retry:()=>void}) {
  const columns:Record<ShopeeModuleKind,[string,string][]>= {monitor:[["orderId","Pedido"],["date","Data"],["status","Status"],["revenue","Receita"],["marketplaceFees","Taxas"],["contribution","Resultado"]],catalog:[["title","Produto"],["sku","SKU"],["status","Status"],["price","Preço"],["availableQty","Disponível"]],inventory:[["title","Produto"],["sku","SKU"],["availableQty","Disponível"],["unitsSold","Vendidas"],["averagePerDay","Média/dia"],["daysRemaining","Dias restantes"]],costs:[["title","Produto"],["sku","SKU"],["cost","Custo"]],abc:[["class","Classe"],["title","Produto"],["sku","SKU"],["revenue","Receita"],["revenueShare","Participação"],["profit","Lucro"]]};
  const currencyKeys=new Set(["revenue","marketplaceFees","contribution","price","cost","profit"]);
  return <div className="overflow-x-auto rounded-xl shadow-[inset_0_0_0_1px_rgb(226_232_240)]"><table className="w-full min-w-[720px] text-left text-sm"><caption className="sr-only">{SHOPEE_MODULES[kind].title}</caption><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{columns[kind].map(([key,label])=><th scope="col" className="px-4 py-3 font-semibold" key={key}>{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row,index)=><tr className="hover:bg-slate-50" key={String(row.orderId??row.productId??row.id??index)}>{columns[kind].map(([key])=><td className="px-4 py-3 tabular-nums" key={key}>{kind==="costs"&&key==="cost"?<CostEditor row={row} connectionId={connectionId} retry={retry}/>:key==="daysRemaining"&&row[key]==null?"Sem base de venda":key==="revenueShare"&&row[key]!=null?`${show(row[key])}%`:currencyKeys.has(key)?money(row[key],String(row.currency??"BRL")):key.endsWith("At")&&row[key]?new Intl.DateTimeFormat("pt-BR").format(new Date(String(row[key]))):show(row[key])}</td>)}</tr>)}</tbody></table>{kind==="costs"&&<p className="p-4 text-sm text-slate-500">Custo desconhecido permanece “—”. Informe zero somente quando ele for um fato.</p>}</div>;
}

function CostEditor({row,connectionId,retry}:{row:Record<string,unknown>;connectionId:string;retry:()=>void}) {
  const [draft,setDraft]=useState(row.cost==null?"":String(row.cost)),[state,setState]=useState<"idle"|"saving"|"error">("idle");
  async function save(){const cost=Number(draft);if(!draft.trim()||!Number.isFinite(cost)||cost<0){setState("error");return}setState("saving");try{const response=await fetch(`/api/integrations/shopee/costs?${new URLSearchParams({connection_id:connectionId})}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({productId:row.productId,sku:row.sku??null,title:row.title,cost})});const body=await response.json();if(!response.ok)throw Error(shopeeModuleError(body.code)||body.error);setState("idle");retry()}catch{setState("error")}}
  return <div className="flex min-w-56 flex-wrap items-center justify-end gap-2"><label className="sr-only" htmlFor={`shopee-cost-${row.id}`}>Custo de {show(row.title)}</label><input id={`shopee-cost-${row.id}`} type="number" min="0" step="0.01" inputMode="decimal" value={draft} onChange={event=>{setDraft(event.target.value);setState("idle")}} aria-invalid={state==="error"} aria-describedby={state==="error"?`shopee-cost-error-${row.id}`:undefined} placeholder="—" className="min-h-11 w-24 rounded-lg px-3 text-right shadow-[inset_0_0_0_1px_rgb(203_213_225)]"/><button type="button" disabled={state==="saving"} onClick={save} className="min-h-11 rounded-lg px-3 font-semibold text-sky-700 shadow-[inset_0_0_0_1px_rgb(203_213_225)] active:scale-[0.96] transition-transform disabled:opacity-50">{state==="saving"?"Salvando…":"Salvar"}</button>{state==="error"&&<span id={`shopee-cost-error-${row.id}`} role="alert" className="w-full text-right text-xs text-red-700">Informe um custo válido ou tente novamente.</span>}</div>;
}
