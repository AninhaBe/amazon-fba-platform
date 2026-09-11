"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../../components/EmptyState";
import { PanelLoading } from "../../../components/LoadingState";
import { Pagination } from "../../../components/Pagination";
import { SeletorNexo } from "../../../components/SeletorNexo";
import { SortButton, type SortDir } from "../../../components/SortButton";
import { useAnchoredField } from "../../../components/useAnchoredField";
import { AvisoDeOcultos } from "../../../components/FiltroDeAtividade";
import type { FiltroDeAtividade as FiltroDeAtividadeValor } from "@/lib/integrations/filtroDeAtividade";
import { brDate } from "@/lib/datetime";

/**
 * Anúncios do Mercado Livre — a tela ÚNICA do catálogo do canal.
 *
 * ⚠️ ESTA TELA ABSORVEU A DE PRODUTOS (decisão dela,
 * 10/09/2026): *"acho que ficou redundante com a última tela, vamos só usar a
 * última tela e só adicionamos a feature de cadastrar custo"*.
 *
 * Ela estava certa, e dá para medir: das cinco colunas de Produtos, QUATRO já
 * existiam aqui — produto com foto, estoque, vendidos e preço. O que era só de
 * lá eram três coisas, e as três vieram junto: a coluna de CUSTO UNITÁRIO com o
 * editor, o cartão da ALÍQUOTA e o filtro de COBERTURA DE CUSTO.
 *
 * ⚠️ O QUE ISSO CUSTA, para quem for reverter saber:
 *
 *   • `/mercado-livre/produtos` virou REDIRECIONAMENTO para cá. Onze lugares do
 *     produto apontavam para lá (menu, ABC, calculadora, insights, o bloco do
 *     Full, a central de configurações); o redirect segura links salvos e
 *     qualquer um que tenha passado despercebido.
 *   • A ÂNCORA `#mercado-livre-aliquota` mudou de tela, não de nome — o
 *     "Cadastrar alíquota →" do monitor continua caindo no campo certo.
 *   • O menu perdeu o item "Produtos". Duas entradas para a mesma lista era
 *     justamente a redundância que ela viu.
 *
 * ⚠️ O FILTRO DE STATUS E O DE ATIVIDADE VIRARAM UM SÓ, e isso
 * não é economia de espaço: eram dois controles dizendo a mesma coisa por
 * caminhos diferentes — um filtrava no cliente o que o outro já havia decidido
 * no servidor. Agora "Só ativos", "Só inativos" e "Todos" vão para a API
 * (`atividade=`), e "Sem estoque" filtra o lote carregado, porque não é status,
 * é quantidade.
 */

/* 15 por página, como as outras tabelas desta família. */
const POR_PAGINA = 15;

/**
 * ⚠️ A ÂNCORA VEIO DE `produtos/page.tsx` COM O MESMO NOME. Ela
 * é o destino de `MERCADO_LIVRE_TAX_RATE_HREF`; renomear quebra o link em
 * silêncio, sem nada ficar vermelho.
 */
export const MERCADO_LIVRE_TAX_RATE_ANCHOR = "mercado-livre-aliquota";

interface Listing {
  id: string;
  costId: string;
  sku: string | null;
  title: string;
  price: number;
  currency: string;
  availableQuantity: number;
  soldQuantity: number;
  status: string;
  activeSince: string | null;
  lastUpdated: string | null;
  thumbnail: string | null;
  permalink: string | null;
  userProductId: string | null;
  listingTypeId: string | null;
  logisticType: string | null;
  shippingMode: string | null;
  freeShipping: boolean;
  catalogListing: boolean;
  catalogProductId: string | null;
  cost: number | null;
}

interface ListingsResponse {
  products: Listing[];
  total: number;
  activeTotal: number;
  complete: boolean;
  ocultados?: number;
}

type ListingFilter = "all" | "classic" | "premium" | "catalog";
type CustoFilter = "all" | "missing" | "complete";
/** "Sem estoque" não é status do canal — é quantidade, e por isso filtra aqui. */
type Recorte = FiltroDeAtividadeValor | "sem-estoque";

const statusLabels: Record<string, string> = {
  active: "Ativo",
  paused: "Pausado",
  closed: "Encerrado",
  inactive: "Inativo",
  under_review: "Em revisão",
};

/**
 * O chip do status usa a MESMA família de tons das outras telas. Ativo é
 * positivo; pausado e em revisão pedem atenção; encerrado e inativo ficam
 * neutros — não são falha, são anúncio que saiu do ar de propósito.
 */
const tomDoStatus: Record<string, string> = {
  active: "v3-chip-pos",
  paused: "v3-chip-aten",
  under_review: "v3-chip-aten",
  closed: "v3-chip-vazio",
  inactive: "v3-chip-vazio",
};

/**
 * ⚠️ OS NOMES SÃO OS QUE O MERCADO LIVRE USA COM O VENDEDOR, e
 * quem corrigiu foi ela, em 10/09/2026: *"as logísticas do mercado livre são
 * places, full, correios e flex"*. A tela mostrava "Agência" e "Mercado
 * Envios" — nomes que não existem no painel dela e que ninguém procuraria.
 *
 * O mapa é do CÓDIGO da API para o nome da tela. Os códigos não mudam; os
 * nomes comerciais mudam, e é por isso que a tradução mora aqui e não no
 * produtor:
 *
 *   `fulfillment`   → Full      · estoque no centro de distribuição do ML
 *   `self_service`  → Flex      · entrega do próprio vendedor no mesmo dia
 *   `xd_drop_off`   → Places    · as AGÊNCIAS do ML, onde o vendedor deixa o
 *                                pacote. Ela confirmou a equivalência em
 *                                10/09/2026: *"places é agências"*. A tela dizia
 *                                "Agência" antes e não estava errada no conceito
 *                                — estava com o nome antigo.
 *
 *                                AVISO: O RÓTULO É "Places". Eu o
 *                                troquei quando ela perguntou *"cadê agências
 *                                aqui?"* e ela corrigiu na hora: *"é pra colocar
 *                                Places, cara"*. Ela perguntou pelo CONCEITO e
 *                                nomeou a MODALIDADE na mesma conversa, e eu li
 *                                a pergunta como se fosse a ordem. Places é o
 *                                nome no painel do ML; é ele que fica.
 *   `drop_off`      → Correios  · o vendedor posta numa agência dos Correios
 *
 * ⚠️ `cross_docking` FICOU E NÃO ESTÁ NA LISTA DELA. É um
 * código real da API (o ML retira no endereço do vendedor) e some da conta
 * dela hoje — mas se aparecer num anúncio, apagar o rótulo faria a coluna
 * ficar com o código cru na tela. Preferi manter com o nome que o ML usa,
 * "Coleta", e apontar aqui: se ela confirmar que não existe mais para
 * ninguém, some junto com os dois de baixo.
 *
 * `custom` e `not_specified` são o resto do mundo — anúncio com frete acertado
 * fora do Mercado Envios e anúncio sem modalidade definida.
 */
const logisticLabels: Record<string, string> = {
  fulfillment: "Full",
  self_service: "Flex",
  xd_drop_off: "Places",
  drop_off: "Correios",
  cross_docking: "Coleta",
  custom: "Envio próprio",
  not_specified: "A combinar",
};

function money(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

function listingType(value: string | null) {
  if (value === "gold_pro" || value === "gold_premium") return "Premium";
  if (value === "gold_special") return "Clássico";
  return value ? value.replaceAll("_", " ") : "Não informado";
}

function logistics(listing: Listing) {
  return logisticLabels[listing.logisticType || ""]
    || listing.logisticType?.replaceAll("_", " ")
    /* ⚠️ O FALLBACK DEIXOU DE DIZER "Mercado Envios": isso não
       é uma logística, é o nome do sistema de frete inteiro — as quatro acima
       são todas Mercado Envios. Um anúncio em `me2` sem `logistic_type` é um
       anúncio cuja modalidade a API não informou, e é isso que a tela diz. */
    || (listing.shippingMode === "me2" ? "Não informada" : "Não informado");
}

function formatDate(value: string | null) {
  return value ? brDate(value) : "—";
}

export default function MercadoLivreListingsPage() {
  const [data, setData] = useState<ListingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /**
   * ⚠️ O PADRÃO É "todos", e não "ativos" como na tela de custo
   * antiga. Lá o padrão existia por um motivo medido (367 inativos para 26
   * ativos, e quem ia cadastrar custo dava de cara com centenas de anúncios que
   * não queria tocar); aqui a lista é o CATÁLOGO, e um cartão de faixa dizendo
   * "Pausados 0" porque o recorte não os carregou seria mentira.
   *
   * Quem vem cadastrar custo tem um caminho melhor que o recorte por atividade:
   * o filtro "Sem custo", que é direto ao ponto e vale dentro de qualquer
   * recorte.
   */
  const [recorte, setRecorte] = useState<Recorte>("todos");
  const [kind, setKind] = useState<ListingFilter>("all");
  const [logistic, setLogistic] = useState("all");
  const [custo, setCusto] = useState<CustoFilter>("all");
  /**
   * ⚠️ A ORDENAÇÃO VOLTOU PARA O CABEÇALHO, e é a segunda
   * inversão desta decisão no mesmo dia. O registro das duas fica aqui porque
   * a terceira vai parecer capricho e não é:
   *
   *   • de manhã a tela tinha um SELETOR de ordem, com "Atualizados primeiro"
   *     como padrão. Ela mandou remover — e o rótulo denunciava um defeito de
   *     verdade: ordenar por data de atualização é artefato da API.
   *   • à tarde ela pediu as setinhas nas colunas: *"ao lado de preço, estoque
   *     e vendidos, coloque meio que um up e down"*, e o motivo é dela: *"pra
   *     não ter milhares de filtros"*.
   *
   * O que mudou entre as duas não foi o gosto: um seletor OCUPA uma vaga na
   * barra de filtros; a setinha mora no cabeçalho que já existe. Mesma função,
   * sem gastar espaço de filtro.
   *
   * ⚠️ O PADRÃO É "Vendidos, maior primeiro" — o mesmo de
   * antes, mas agora VISÍVEL: a coluna nasce marcada. Padrão que a tela não
   * mostra é padrão que ninguém sabe que existe, e era o caso até agora.
   */
  const [ordemCol, setOrdemCol] = useState<"price" | "stock" | "sold">("sold");
  const [ordemDir, setOrdemDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  /* Primeiro clique numa coluna nova: maior primeiro, que é o que se quer em
     todas as três. Clique de novo na mesma: inverte. */
  function ordenarPor(col: "price" | "stock" | "sold") {
    setPage(1);
    if (col === ordemCol) setOrdemDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setOrdemCol(col);
      setOrdemDir("desc");
    }
  }

  const [draftCosts, setDraftCosts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [taxRate, setTaxRate] = useState("");
  const [taxState, setTaxState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [taxError, setTaxError] = useState<string | null>(null);
  const taxInputRef = useAnchoredField(MERCADO_LIVRE_TAX_RATE_ANCHOR);

  /** "sem-estoque" filtra no cliente; os outros três decidem o que a API traz. */
  const atividade: FiltroDeAtividadeValor = recorte === "sem-estoque" ? "todos" : recorte;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/integrations/mercado-livre/products?atividade=${atividade}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível carregar os anúncios.");
      setData(body);
      /* AVISO: DUAS CASAS SEMPRE, e nao `String(cost)`. O banco
         guarda 13.4 e 2.9; jogados crus no campo eles apareciam como "13,4" e
         "2,9" ao lado de "7,25" — dinheiro com numero de casas variavel, que ela
         viu na hora (10/09/2026: *"pq ta assim?"*). Nao e so feio: numa coluna de
         valores a casa faltando desalinha a leitura e faz 13,4 parecer menor que
         7,25 na batida do olho. */
      setDraftCosts(Object.fromEntries((body.products as Listing[]).map((p) => [p.costId, p.cost == null ? "" : p.cost.toFixed(2)])));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar os anúncios.");
    } finally {
      setLoading(false);
    }
  }, [atividade]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/integrations/mercado-livre/settings", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (response.ok) setTaxRate(String(body.taxRate));
      })
      .catch(() => {
        // A alíquota é um bloco à parte: falhar aqui não pode derrubar a lista.
      });
    return () => controller.abort();
  }, []);

  /* ── Custo: um ponto só de gravação, três caminhos até ele ───────────────── */

  async function saveCost(product: Listing, cost: number) {
    const previous = product.cost;
    setData((current) => current && { ...current, products: current.products.map((item) => item.costId === product.costId ? { ...item, cost } : item) });
    setSaveState((current) => ({ ...current, [product.costId]: "saving" }));
    try {
      const response = await fetch("/api/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: product.costId, sku: product.sku || product.id, title: product.title, imageUrl: product.thumbnail, cost }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível salvar o custo.");
      /* O que a pessoa digitou tambem se normaliza depois de gravar: sem isto
         a linha recem-salva ficaria com "7.5" enquanto as vizinhas mostram duas
         casas. */
      setDraftCosts((current) => ({ ...current, [product.costId]: cost.toFixed(2) }));
      setSaveState((current) => ({ ...current, [product.costId]: "saved" }));
    } catch {
      setData((current) => current && { ...current, products: current.products.map((item) => item.costId === product.costId ? { ...item, cost: previous } : item) });
      setDraftCosts((current) => ({ ...current, [product.costId]: previous == null ? "" : String(previous) }));
      setSaveState((current) => ({ ...current, [product.costId]: "error" }));
    }
  }

  // Ponto único de confirmação: Enter, botão "Salvar" e sair do campo passam
  // por aqui. Ignora valor vazio/inválido e evita salvar quando nada mudou.
  function commitCost(product: Listing, raw: string) {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value) || value < 0) return;
    if (value === (product.cost ?? 0)) return;
    void saveCost(product, value);
  }

  function canCommit(product: Listing): boolean {
    const raw = draftCosts[product.costId] ?? "";
    const value = Number(raw);
    return raw.trim() !== "" && Number.isFinite(value) && value >= 0 && value !== (product.cost ?? 0);
  }

  async function saveTaxRate(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(taxRate.replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setTaxError("Informe um percentual entre 0 e 100.");
      setTaxState("error");
      return;
    }
    setTaxState("saving");
    try {
      const response = await fetch("/api/integrations/mercado-livre/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxRate: value }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Não foi possível salvar a alíquota (HTTP ${response.status}).`);
      setTaxRate(String(body.taxRate));
      setTaxError(null);
      setTaxState("saved");
    } catch (reason) {
      // ⚠️ O ERRO REAL, NÃO UM PALPITE.
      //
      // Antes qualquer falha — sessão expirada, 404, 500, rede caída — exibia
      // "Informe um percentual entre 0 e 100", culpando o número que a pessoa
      // digitou. Em 25/08/2026 isso escondeu por horas uma alíquota que nunca
      // era salva: quem tentava lia que o valor estava errado, e estava certo.
      setTaxError(reason instanceof Error ? reason.message : "Não foi possível salvar a alíquota.");
      setTaxState("error");
    }
  }

  const products = useMemo(() => data?.products ?? [], [data]);
  /**
   * AVISO: O FILTRO SÓ OFERECE MODALIDADE DE VERDADE. Ele
   * nasce do que veio na busca, e por isso ganhava uma opção "Não informada"
   * sempre que a API deixava de mandar o `logistic_type` de algum anúncio. Ela
   * mandou tirar em 10/09/2026, e está certa: as modalidades do Mercado Livre
   * são quatro — Full, Flex, Correios e Places —, e uma quinta entrada com nome
   * de ausência sugere uma modalidade que não existe.
   *
   * AVISO: NA TABELA A AUSÊNCIA CONTINUA APARECENDO. O que sai
   * é a OPÇÃO DE FILTRO, não o fato: o anúncio cuja modalidade a API não
   * informou segue dizendo isso na coluna dele. Esconder ali seria inventar uma
   * logística que ninguém sabe qual é.
   */
  const logisticOptions = useMemo(
    () => Array.from(new Set(products.map((product) => logistics(product))))
      .filter((nome) => !nome.startsWith("Não inform"))
      .sort((a, b) => a.localeCompare(b, "pt-BR")),
    [products],
  );
  const paused = products.filter((product) => product.status === "paused").length;
  const withoutStock = products.filter((product) => product.status === "active" && product.availableQuantity <= 0).length;
  const comCusto = products.filter((product) => product.cost != null && product.cost > 0).length;
  const semCusto = products.length - comCusto;

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return [...products]
      .filter((product) => !normalized || `${product.title} ${product.id} ${product.sku || ""} ${product.userProductId || ""}`.toLocaleLowerCase("pt-BR").includes(normalized))
      .filter((product) => recorte !== "sem-estoque" || (product.status === "active" && product.availableQuantity <= 0))
      .filter((product) => kind === "all" || (kind === "catalog" ? product.catalogListing : kind === "premium" ? listingType(product.listingTypeId) === "Premium" : listingType(product.listingTypeId) === "Clássico"))
      .filter((product) => logistic === "all" || logistics(product) === logistic)
      .filter((product) => custo === "all" || (custo === "complete" ? product.cost != null && product.cost > 0 : !(product.cost != null && product.cost > 0)))
      .sort((a, b) => {
        const valor = (item: Listing) =>
          ordemCol === "price" ? item.price
          : ordemCol === "stock" ? item.availableQuantity
          : item.soldQuantity;
        const sinal = ordemDir === "asc" ? 1 : -1;
        const diferenca = (valor(a) - valor(b)) * sinal;
        /* Desempate por id: sem ele, dois anúncios com o mesmo valor trocam de
           lugar entre uma busca e outra e a lista parece instável. */
        return diferenca !== 0 ? diferenca : a.id.localeCompare(b.id);
      });
  }, [custo, kind, logistic, ordemCol, ordemDir, products, query, recorte]);

  const pageCount = Math.max(1, Math.ceil(visible.length / POR_PAGINA));
  /* Derivado, nunca guardado: filtrar depois de virar a página deixaria o
     estado apontando para uma página que não existe mais. */
  const current = Math.min(page, pageCount);
  const paged = visible.slice((current - 1) * POR_PAGINA, current * POR_PAGINA);

  return (
    <div className="v3 meli-listings-page">
      <section className="v3-card" id={MERCADO_LIVRE_TAX_RATE_ANCHOR}>
        <div className="v3-card-cab">
          <h2>Alíquota da sua empresa</h2>
          <span className="v3-meta">Aplicada ao faturamento dos pedidos pagos no período</span>
        </div>
        <form className="v3-aliquota" onSubmit={saveTaxRate}>
          <label className="v3-aliquota-campo">
            <span>Alíquota média</span>
            <span className="v3-aliquota-entrada">
              <input
                ref={taxInputRef}
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={taxRate}
                onChange={(event) => { setTaxRate(event.target.value); setTaxState("idle"); }}
                aria-label="Alíquota média de imposto"
              />
              <b>%</b>
            </span>
          </label>
          <button type="submit" className="v3-btn is-primaria" disabled={taxState === "saving"}>
            {taxState === "saving" ? "Salvando…" : "Salvar alíquota"}
          </button>
          <small aria-live="polite" className={`v3-nota${taxState === "error" ? " is-erro" : ""}`}>
            {taxState === "saved" ? "Alíquota salva" : taxState === "error" ? (taxError ?? "Não foi possível salvar a alíquota.") : ""}
          </small>
        </form>
      </section>

      {loading && !data ? <PanelLoading label="Carregando anúncios do Mercado Livre" />
        : error || !data ? (
          <EmptyState
            title="Não foi possível carregar os anúncios"
            description={error || "Conecte sua conta para visualizar o catálogo publicado."}
            action={<Link href="/integracoes" className="meli-primary-action">Gerenciar integração <span aria-hidden="true">→</span></Link>}
          />
        ) : (
          <>
            <section className="v3-card v3-faixa">
              <div className="v3-card-cab">
                <h2>Anúncios</h2>
                {/**
                  * AVISO: AQUI MORAVAM "Dados da última sincronização
                  * da conta" e o botão "Atualizar" (removidos a pedido dela,
                  * 10/09/2026).
                  *
                  * A frase caía na doutrina dela de 02/09: *"sobre os dados
                  * sincronizados, isso precisa estar de pé sempre"* — estado
                  * normal não é notícia, e anunciar que o dado veio de uma
                  * sincronização transfere para a vendedora uma preocupação que
                  * é do sistema.
                  *
                  * AVISO: O QUE ISSO CUSTA — não há mais recarga
                  * manual. A lista já busca do servidor a cada montagem e a cada
                  * troca de recorte, sempre com `cache: "no-store"`, então o
                  * caminho para forçar leitura nova é trocar o filtro ou
                  * recarregar a página. Se um dia fizer falta, o lugar é a barra
                  * da tela, não um botão dentro do cabeçalho do cartão.
                  */}
              </div>
              {/* ⚠️ O TOM SEGUE O RÓTULO, não o valor — a regra que
                  ela fixou no Radar de estoque: a cor identifica a NATUREZA da
                  coluna, e quem julga o número é o próprio número. */}
              <div className="v3-colunas">
                <div className="v3-coluna">
                  <p className="v3-coluna-rotulo">Anúncios</p>
                  <strong className="v3-coluna-valor">{products.length.toLocaleString("pt-BR")}</strong>
                  <span className="v3-coluna-share">
                    {data.complete ? "catálogo sincronizado" : `de ${data.total.toLocaleString("pt-BR")} encontrados`}
                  </span>
                </div>
                <div className="v3-coluna">
                  <p className="v3-coluna-rotulo">Ativos</p>
                  <strong className="v3-coluna-valor">{data.activeTotal.toLocaleString("pt-BR")}</strong>
                  <span className="v3-coluna-share">publicados agora</span>
                </div>
                <div className="v3-coluna is-tom-ambar">
                  <p className="v3-coluna-rotulo">Pausados</p>
                  <strong className="v3-coluna-valor">{paused.toLocaleString("pt-BR")}</strong>
                  <span className="v3-coluna-share">fora da exposição</span>
                </div>
                <div className="v3-coluna is-tom-vermelho">
                  <p className="v3-coluna-rotulo">Sem estoque</p>
                  <strong className={`v3-coluna-valor${withoutStock ? " is-negativo" : ""}`}>
                    {withoutStock.toLocaleString("pt-BR")}
                  </strong>
                  <span className="v3-coluna-share">{withoutStock ? "ativos sem unidade" : "nenhum ativo zerado"}</span>
                </div>
                <div className="v3-coluna is-tom-verde">
                  <p className="v3-coluna-rotulo">Com custo</p>
                  <strong className="v3-coluna-valor is-positivo">{comCusto.toLocaleString("pt-BR")}</strong>
                  <span className="v3-coluna-share">
                    {products.length ? `${Math.round((comCusto / products.length) * 100)}% da base` : "—"}
                  </span>
                </div>
                {/* ⚠️ "Sem custo" APONTA O QUE FALTA, com número —
                    é a peça que veio da tela de Produtos e a razão de ela ter
                    existido. Sem custo cadastrado não há lucro real, e este é o
                    único lugar do canal que diz quantos faltam. */}
                <div className="v3-coluna is-tom-ambar is-ultima">
                  <p className="v3-coluna-rotulo">Sem custo</p>
                  <strong className="v3-coluna-valor">{semCusto.toLocaleString("pt-BR")}</strong>
                  <span className="v3-coluna-share">{semCusto ? "sem lucro real ainda" : "base completa"}</span>
                </div>
              </div>
              {/* ⚠️ A LEITURA PARCIAL É FATO DO DOMÍNIO e continua na
                  tela, com os dois números: os filtros abaixo só enxergam o lote
                  que veio. */}
              {!data.complete && (
                <p className="v3-nota">
                  Esta visão carregou {products.length.toLocaleString("pt-BR")} de {data.total.toLocaleString("pt-BR")} anúncios — os filtros abaixo consideram só o lote sincronizado.
                </p>
              )}
            </section>

            <section className="v3-card" aria-labelledby="listing-results-title">
              <div className="v3-card-cab">
                <h2 id="listing-results-title">
                  {visible.length.toLocaleString("pt-BR")} {visible.length === 1 ? "anúncio encontrado" : "anúncios encontrados"}
                </h2>
                <span className="v3-meta">Catálogo publicado</span>
              </div>

              <div className="v3-filtros v3-filtros-anuncios" role="search" aria-label="Filtros dos anúncios">
                <label className="v3-busca">
                  <span className="sr-only">Buscar anúncio</span>
                  <input
                    value={query}
                    onChange={(event) => { setQuery(event.target.value); setPage(1); }}
                    placeholder="Buscar título, SKU, MLB ou MLBU"
                  />
                </label>
                <SeletorNexo
                  valor={recorte}
                  rotuloAcessivel="Anúncios exibidos"
                  aoEscolher={(valor) => { setRecorte(valor as Recorte); setPage(1); }}
                  opcoes={[
                    { valor: "todos", rotulo: "Todos os anúncios" },
                    { valor: "ativos", rotulo: "Só ativos" },
                    { valor: "inativos", rotulo: "Só inativos" },
                    { valor: "sem-estoque", rotulo: "Sem estoque" },
                  ]}
                />
                <SeletorNexo
                  valor={custo}
                  rotuloAcessivel="Filtrar cobertura de custo"
                  aoEscolher={(valor) => { setCusto(valor as CustoFilter); setPage(1); }}
                  opcoes={[
                    { valor: "all", rotulo: "Todos os custos" },
                    { valor: "missing", rotulo: "Sem custo" },
                    { valor: "complete", rotulo: "Com custo" },
                  ]}
                />
                <SeletorNexo
                  valor={kind}
                  rotuloAcessivel="Filtrar modalidade"
                  aoEscolher={(valor) => { setKind(valor as ListingFilter); setPage(1); }}
                  opcoes={[
                    { valor: "all", rotulo: "Todas as modalidades" },
                    { valor: "classic", rotulo: "Clássico" },
                    { valor: "premium", rotulo: "Premium" },
                    { valor: "catalog", rotulo: "Catálogo" },
                  ]}
                />
                <SeletorNexo
                  valor={logistic}
                  rotuloAcessivel="Filtrar logística"
                  aoEscolher={(valor) => { setLogistic(valor); setPage(1); }}
                  opcoes={[
                    { valor: "all", rotulo: "Toda logística" },
                    ...logisticOptions.map((valor) => ({ valor, rotulo: valor })),
                  ]}
                />
              </div>

              <AvisoDeOcultos
                ocultados={data.ocultados}
                atividade={atividade}
                verTodos={() => { setRecorte("todos"); setPage(1); }}
              />

              {visible.length === 0 ? (
                <EmptyState
                  kind="search"
                  title="Nenhum anúncio encontrado"
                  description="Ajuste a busca ou remova algum filtro para ampliar os resultados."
                />
              ) : (
                <div className="v3-tabela v3-tabela-anuncios">
                  <div className="v3-anuncios-cab">
                    <span>Produto</span>
                    <span>Status</span>
                    <span>Modalidade</span>
                    {/* ⚠️ AS TRÊS COLUNAS ORDENÁVEIS USAM O
                        `SortButton` QUE JÁ EXISTIA — a peça de ordenar por
                        cabeçalho do produto, que eu tinha tirado desta tela de
                        manhã. Recriar uma segunda seria dar duas caras para o
                        mesmo gesto. O que é novo aqui é só a roupa: o CSS a
                        veste como o resto do cabeçalho v3. */}
                    <span><SortButton label="Preço" col="price" sortCol={ordemCol} sortDir={ordemDir} onSort={ordenarPor} /></span>
                    <span><SortButton label="Estoque" col="stock" sortCol={ordemCol} sortDir={ordemDir} onSort={ordenarPor} /></span>
                    <span><SortButton label="Vendidos" col="sold" sortCol={ordemCol} sortDir={ordemDir} onSort={ordenarPor} /></span>
                    <span>Logística</span>
                    <span>Custo unitário</span>
                    <span><span className="sr-only">Abrir no Mercado Livre</span></span>
                  </div>
                  {paged.map((product) => (
                    <div className="v3-anuncios-linha" key={product.id}>
                      <span className="v3-cel-anuncio">
                        {/* ⚠️ A FOTO É PEDIDO DELA (10/09/2026): numa
                            tela de catálogo ela reconhece o item mais rápido que
                            o título. Sem foto é ESTADO, não buraco — o quadrado
                            com a sigla mantém as linhas alinhadas. */}
                        {product.thumbnail ? (
                          // A miniatura já chega reduzida pelo catálogo do canal.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="v3-anuncio-foto" src={product.thumbnail} alt="" loading="lazy" />
                        ) : (
                          <span className="v3-anuncio-foto is-vazia" aria-hidden="true">ML</span>
                        )}
                        <span className="v3-cel-nome">
                          <span className="v3-margem-titulo" title={product.title}>{product.title}</span>
                          <span className="v3-cel-sub">
                            {product.sku ? `SKU ${product.sku} · ` : ""}{product.id} ·{" "}
                            {/* AVISO: SÓ A DATA EM TINTA CHEIA. Eu tinha
                                escurecido a linha inteira e ela corrigiu na hora:
                                *"eu disse só o atualizado em... não tudo"*. SKU e
                                código são identificação — a gente COPIA, não lê; a
                                data é a única parte que se confere de relance,
                                para saber se o anúncio andou. */}
                            <span className="v3-cel-atualizado">atualizado em {formatDate(product.lastUpdated)}</span>
                          </span>
                        </span>
                      </span>
                      <span className="v3-cel-centro">
                        <em className={`v3-chip ${tomDoStatus[product.status] || "v3-chip-vazio"}`}>
                          {statusLabels[product.status] || product.status.replaceAll("_", " ")}
                        </em>
                      </span>
                      {/* Duas linhas, não um ponto do meio: o fato em cima, a
                          condição embaixo (pedido dela, 10/09/2026). */}
                      <span className="v3-cel-num v3-cel-duplo">
                        <span>{listingType(product.listingTypeId)}</span>
                        {product.catalogListing && <span className="v3-cel-sub">catálogo</span>}
                      </span>
                      <span className="v3-cel-num">{money(product.price, product.currency)}</span>
                      {/* Zero aqui é FATO da fonte ("acabou"), não desconhecido —
                          por isso é número em vermelho, e não travessão. */}
                      <span className={`v3-cel-num${product.availableQuantity <= 0 ? " is-negativo" : ""}`}>
                        {product.availableQuantity.toLocaleString("pt-BR")}
                      </span>
                      <span className="v3-cel-num">{product.soldQuantity.toLocaleString("pt-BR")}</span>
                      <span className="v3-cel-num v3-cel-duplo">
                        <span>{logistics(product)}</span>
                        {product.freeShipping && <span className="v3-cel-sub">frete grátis</span>}
                      </span>
                      <span className="v3-cel-custo">
                        {/* ⚠️ TRÊS CAMINHOS PARA O MESMO PONTO — Enter,
                            botão e sair do campo chamam `commitCost`. Foi assim
                            que deixou de existir custo digitado e nunca salvo. */}
                        {/* AVISO: A MOLDURA INTEIRA MUDA DE COR quando
                            falta custo — referencia dela, desenhada em 10/09/2026.
                            E uma caixa so, com "R$" dentro: o campo antigo tinha
                            corpo proprio dentro da moldura e nao fechava. */}
                        <label className={`v3-custo-campo${product.cost ? "" : " is-pendente"}`}>
                          <span aria-hidden="true">R$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={draftCosts[product.costId] ?? ""}
                            onChange={(event) => setDraftCosts((cur) => ({ ...cur, [product.costId]: event.target.value }))}
                            onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); commitCost(product, event.currentTarget.value); event.currentTarget.blur(); }}
                            onBlur={(event) => commitCost(product, event.target.value)}
                            /* ⚠️ O ESPAÇO RESERVADO NÃO PODE SER
                               "0,00": custo não cadastrado é DESCONHECIDO, e
                               "0,00" em cinza dentro do campo se lê como custo
                               ZERO — outro fato, que faria a margem sair
                               inteira. É a regra `null ≠ 0` dentro de um input. */
                            placeholder="—"
                            aria-label={`Custo de ${product.title}`}
                            className={product.cost ? "tem-custo" : "sem-custo"}
                          />
                        </label>
                        <button
                          type="button"
                          className="v3-btn"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => commitCost(product, draftCosts[product.costId] ?? "")}
                          disabled={!canCommit(product)}
                          title={canCommit(product) ? "Salvar custo" : "Digite um custo diferente do atual"}
                        >
                          Salvar
                        </button>
                        <small aria-live="polite" className={`v3-custo-estado${saveState[product.costId] === "error" ? " is-erro" : ""}`}>
                          {saveState[product.costId] === "saving" ? "Salvando…"
                            : saveState[product.costId] === "saved" ? "Salvo"
                            : saveState[product.costId] === "error" ? "Falha ao salvar"
                            : product.cost ? "" : "Pendente"}
                        </small>
                      </span>
                      <span className="v3-cel-fim">
                        {product.permalink ? (
                          <a
                            href={product.permalink}
                            target="_blank"
                            rel="noreferrer"
                            className="v3-abrir"
                            aria-label={`Abrir ${product.title} no Mercado Livre`}
                            title="Abrir anúncio"
                          >
                            <span aria-hidden="true">↗</span>
                          </a>
                        ) : (
                          <span className="v3-cel-num is-vazio" aria-hidden="true">—</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {pageCount > 1 && (
              <div className="v3-paginacao">
                <Pagination page={current} pageCount={pageCount} total={visible.length} pageSize={POR_PAGINA} onPage={setPage} />
              </div>
            )}

            <p className="v3-nota">
              O lucro estimado considera pedidos pagos, comissão de venda, custos cadastrados e a alíquota acima. Frete subsidiado, publicidade e ajustes posteriores ainda não entram no resultado.
            </p>
          </>
        )}
    </div>
  );
}
