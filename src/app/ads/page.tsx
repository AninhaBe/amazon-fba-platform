"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { PageHeader, pageIcons } from "../components/PageHeader";
import { DashboardPeriodFilter, useDashboardPeriod } from "../components/DashboardPeriodFilter";
import { MarketplaceIcon } from "../components/MarketplaceIcon";
import { EmptyState } from "../components/EmptyState";
import { InlineLoading } from "../components/LoadingState";
import { IntegrationDashboardFrame } from "../components/IntegrationDashboardFrame";
import { periodoNaUrl } from "../components/periodoNaUrl";
import { margemPosAds, margemPosAdsDoCanal, type ProdutoAnunciado } from "@/lib/margemPosAds";
import { avaliarAnuncio } from "@/lib/anuncioContraMargem";
import type { AdsMultiCanal, CanalDeAdsResumo, CampanhaDeAds, CanalDeAds } from "@/lib/adsMultiCanal";

/**
 * ABA DE ANÚNCIOS — os quatro canais numa tela.
 *
 * Pedido da Ana (29/08/2026): *"quero uma aba só de ads […] mantendo a proposta:
 * entender o que acontece na operação de quem usa o NEXO"*.
 *
 * ⚠️ O QUE ESTA TELA DELIBERADAMENTE NÃO TEM:
 *
 * 1. **Total dos quatro canais.** A Amazon tem 19 dias de histórico e o Mercado
 *    Livre 3 (30/08/2026), com o ML gastando 6× mais. Um total somaria janelas
 *    diferentes e daria um número que parece errado — e está. A rota nem devolve
 *    esse campo, para ninguém somar por engano depois.
 * 2. **CTR, CPC médio e gráfico de impressões.** São números que a vendedora não
 *    usa para decidir nada de manhã, e o painel do canal já mostra.
 * 3. **Cópia do painel do marketplace.** O que a Amazon já mostra é commodity.
 *    O que só nós fazemos é cruzar o anúncio com o CUSTO e a TARIFA reais — a
 *    coluna "Sobrou".
 */

const NOME_DO_CANAL: Record<string, string> = {
  amazon: "Amazon",
  mercado_livre: "Mercado Livre",
  shopee: "Shopee",
  tiktok_shop: "TikTok Shop",
};

function money(valor: number | null | undefined, moeda = "BRL") {
  if (valor == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(valor);
}

/** Data curta para a janela colada ao número: "12/08". */
function diaCurto(iso: string) {
  const [, mes, dia] = iso.split("-");
  return `${dia}/${mes}`;
}

/**
 * A JANELA DE CADA CANAL, COLADA AO NÚMERO — nunca num rodapé.
 *
 * É a única defesa contra ler R$ 410 da Amazon e R$ 2.389 do ML como se fossem
 * o mesmo recorte de tempo. Quem olha rápido tem que ver os dias junto do valor.
 */
function Janela({ canal }: { canal: CanalDeAdsResumo }) {
  if (!canal.janela) return null;
  return (
    <small className="ads-janela">
      {canal.janela.dias} {canal.janela.dias === 1 ? "dia" : "dias"} · {diaCurto(canal.janela.de)}–{diaCurto(canal.janela.ate)}
    </small>
  );
}

/**
 * "A FONTE AINDA ESTÁ CONSOLIDANDO ESTE DIA" — colado no número, nunca em faixa.
 *
 * ⚠️ Ela existe porque o número MUDA sozinho: o dia corrente e o último fechado
 * ainda encolhem enquanto o canal consolida (medido no PADS em 30/08/2026:
 * R$ 46,78 → R$ 46,55 entre duas leituras com minutos de diferença). Sem a
 * marca, a vendedora abre amanhã, vê outro valor e chama de erro — e estaria
 * certa em desconfiar, porque ninguém avisou.
 *
 * ⚠️ E ela SOME quando o dia fecha. Marca permanente vira decoração, e decoração
 * treina a pessoa a não ler o aviso no dia em que ele importa. Também não diz
 * "parcial": a palavra explica à vendedora o que ela já sabe, em vez de dizer o
 * que está acontecendo (AGENTS.md).
 */
function AindaConsolidando({ dia }: { dia: string | null }) {
  if (!dia) return null;
  return (
    <small className="ads-consolidando">
      A fonte ainda está consolidando {diaCurto(dia)} — o valor deste dia pode mudar.
    </small>
  );
}

/** B — Onde cada canal está. Canal sem dado mostra o estado real e o dono da espera. */
function CartaoDoCanal({ canal }: { canal: CanalDeAdsResumo }) {
  const nome = NOME_DO_CANAL[canal.provider] ?? canal.provider;
  return (
    <article className={`ads-canal is-${canal.estado}`}>
      <header>
        <MarketplaceIcon provider={canal.provider} size={18} />
        <b>{nome}</b>
      </header>
      {canal.estado === "com-dado" ? (
        <>
          <strong className="ads-canal-valor">{money(canal.gasto, canal.moeda)}</strong>
          <Janela canal={canal} />
          <AindaConsolidando dia={canal.consolidando} />
          <small>
            {canal.campanhas} {canal.campanhas === 1 ? "campanha" : "campanhas"} · {canal.produtos}{" "}
            {canal.produtos === 1 ? "produto" : "produtos"}
          </small>
        </>
      ) : (
        <>
          {/* Sem dado NÃO é R$ 0,00: zero diria "não gastou", e o fato é que
              ainda não há como saber. O texto diz o que falta e de quem depende. */}
          {/* Em recoleta a tela NÃO diz "sem dado": o dado existe e está errado,
              que é outra coisa — e dizer a coisa certa aqui é o que impede a
              vendedora de achar que o canal parou de anunciar. */}
          <strong className="ads-canal-valor is-vazio">
            {canal.estado === "dado-em-recoleta" ? "recolhendo de novo" : "sem dado"}
          </strong>
          <p>{canal.pendencia?.texto ?? "Nenhuma campanha neste canal no período."}</p>
          {canal.pendencia?.href ? (
            <Link href={canal.pendencia.href} className="ads-canal-acao">
              Ver como ligar <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </>
      )}
    </article>
  );
}

/** C — O que o anúncio deixou, canal a canal, cada um na sua janela. */
function OQueOAnuncioDeixou({ canal, produtos }: { canal: CanalDeAdsResumo; produtos: ProdutoAnunciado[] }) {
  const doCanal = produtos.filter((p) => p.provider === canal.provider);
  if (doCanal.length === 0) return null;
  const total = margemPosAdsDoCanal(doCanal);
  const receita = doCanal.reduce((soma, p) => soma + (p.receitaPeriodo ?? 0), 0);
  const tarifa = doCanal.reduce((soma, p) => soma + (p.tarifaPeriodo ?? 0), 0);
  const custo = doCanal.reduce((soma, p) => soma + (p.custoPeriodo ?? 0), 0);

  return (
    <div className="ads-cascata">
      <header>
        <span className="ads-cascata-canal">
          <MarketplaceIcon provider={canal.provider} size={16} />
          <b>{NOME_DO_CANAL[canal.provider]}</b>
        </span>
        <Janela canal={canal} />
      </header>
      <AindaConsolidando dia={canal.consolidando} />
      <dl>
        <div><dt>Receita dos anunciados</dt><dd>{money(receita, canal.moeda)}</dd></div>
        <div><dt>− Tarifa do canal</dt><dd>{money(tarifa, canal.moeda)}</dd></div>
        <div><dt>− Custo dos produtos</dt><dd>{money(custo, canal.moeda)}</dd></div>
        <div><dt>− Anúncio</dt><dd>{money(total.gasto, canal.moeda)}</dd></div>
        <div className={`ads-cascata-resultado ${total.sobrou != null && total.sobrou < 0 ? "is-negativo" : ""}`}>
          <dt>= Sobrou</dt>
          <dd>{money(total.sobrou, canal.moeda)}</dd>
        </div>
      </dl>
      {/* A pendência diz O QUE falta, com número — nunca "parcial". */}
      {total.produtosSemVeredito > 0 ? (
        <p className="ads-pendencia">
          {total.produtosSemVeredito} de {doCanal.length}{" "}
          {doCanal.length === 1 ? "produto ficou" : "produtos ficaram"} fora desta conta: falta custo cadastrado ou a
          tarifa ainda não foi postada pelo canal.
        </p>
      ) : null}
    </div>
  );
}

/** D — O coração: este produto, depois do custo e da tarifa, ainda dá lucro? */
function TabelaDeProdutos({ produtos }: { produtos: ProdutoAnunciado[] }) {
  const linhas = [...produtos].sort((a, b) => b.gasto - a.gasto);
  return (
    <div className="ads-tabela-wrap">
      <table className="ads-tabela">
        <thead>
          <tr>
            <th scope="col">Produto</th>
            <th scope="col">Canal</th>
            <th scope="col" className="is-num">Gasto</th>
            <th scope="col" className="is-num">Receita</th>
            <th scope="col" className="is-num">Tarifa</th>
            <th scope="col" className="is-num">Custo</th>
            <th scope="col" className="is-num">Sobrou</th>
            <th scope="col" className="is-num">ACOS<small> da fonte</small></th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((produto) => {
            const { sobrou, falta } = margemPosAds(produto);
            return (
              <tr key={`${produto.provider}:${produto.productId}:${produto.sku ?? ""}`}>
                <th scope="row">
                  <span className="ads-produto-titulo">{produto.titulo ?? produto.productId}</span>
                  <small>{produto.sku ?? produto.productId}</small>
                </th>
                <td><MarketplaceIcon provider={produto.provider as CanalDeAds} size={16} /></td>
                <td className="is-num">{money(produto.gasto, produto.moeda)}</td>
                <td className="is-num">{money(produto.receitaPeriodo, produto.moeda)}</td>
                <td className="is-num">{money(produto.tarifaPeriodo, produto.moeda)}</td>
                <td className="is-num">{money(produto.custoPeriodo, produto.moeda)}</td>
                <td className={`is-num ads-sobrou ${sobrou != null && sobrou < 0 ? "is-negativo" : ""}`}>
                  {sobrou == null ? (
                    // Travessão com o motivo, não travessão mudo: a pessoa
                    // precisa saber o que cadastrar para o número aparecer.
                    <span title={`Falta ${falta.join(" e ")}`}>—</span>
                  ) : (
                    money(sobrou, produto.moeda)
                  )}
                </td>
                {/* ACOS `0` da fonte significa "gastou e não vendeu", não 0% de
                    desempenho (medido no PADS em 28/08). Por isso o veredito
                    olha custo e pedidos, e não o ACOS sozinho. */}
                <td className="is-num">{produto.acos == null ? "—" : `${produto.acos.toFixed(2).replace(".", ",")}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** E — Pagando e sem venda no período. O pior caso, e o mais fácil de esconder. */
function PagandoSemVenda({ produtos }: { produtos: ProdutoAnunciado[] }) {
  const semVenda = produtos.filter((produto) => {
    const veredito = avaliarAnuncio({
      cost: produto.gasto,
      sales: produto.vendasAtribuidas ?? 0,
      purchases: produto.pedidosAtribuidos ?? 0,
      acos: produto.acos,
      margemRealPct: null,
    });
    return veredito.situacao === "gasto-sem-venda" && (produto.unidadesPeriodo ?? 0) === 0;
  });
  if (semVenda.length === 0) return null;
  const total = semVenda.reduce((soma, p) => soma + p.gasto, 0);

  return (
    <section className="ads-bloco" aria-labelledby="ads-sem-venda">
      <header>
        <p className="section-kicker">Onde o dinheiro sai sem voltar</p>
        <h2 id="ads-sem-venda">Pagando e sem venda no período</h2>
      </header>
      <p className="ads-alerta">
        {semVenda.length} {semVenda.length === 1 ? "produto anunciado não vendeu" : "produtos anunciados não venderam"}{" "}
        nada no período — {money(total)} de anúncio sem retorno.
      </p>
      <ul className="ads-lista-seca">
        {semVenda.slice(0, 8).map((produto) => (
          <li key={`${produto.provider}:${produto.productId}`}>
            <MarketplaceIcon provider={produto.provider as CanalDeAds} size={16} />
            <span>{produto.titulo ?? produto.productId}</span>
            <b>{money(produto.gasto, produto.moeda)}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** G — Campanha (hoje só a Amazon grava campanha). */
function TabelaDeCampanhas({ campanhas }: { campanhas: CampanhaDeAds[] }) {
  if (campanhas.length === 0) return null;
  return (
    <section className="ads-bloco" aria-labelledby="ads-campanhas">
      <header>
        <p className="section-kicker">Orçamento</p>
        <h2 id="ads-campanhas">Campanha</h2>
      </header>
      <div className="ads-tabela-wrap">
        <table className="ads-tabela">
          <thead>
            <tr>
              <th scope="col">Campanha</th>
              <th scope="col" className="is-num">Gasto</th>
              <th scope="col" className="is-num">Vendas atribuídas</th>
              <th scope="col" className="is-num">Cliques</th>
              <th scope="col" className="is-num">Impressões</th>
            </tr>
          </thead>
          <tbody>
            {campanhas.map((campanha) => (
              <tr key={`${campanha.provider}:${campanha.campaignId}`}>
                <th scope="row">{campanha.nome ?? campanha.campaignId}</th>
                <td className="is-num">{money(campanha.gasto)}</td>
                <td className="is-num">{money(campanha.vendasAtribuidas)}</td>
                <td className="is-num">{campanha.cliques}</td>
                <td className="is-num">{campanha.impressoes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Divergência da FONTE, dita antes de a pessoa achar que é defeito nosso. */}
      <p className="ads-nota">
        A Amazon atribui campanha em 30 dias e produto em 14 — os dois blocos não fecham entre si, e isso vem da fonte.
      </p>
    </section>
  );
}

function Ads() {
  const router = useRouter();
  const searchParams = useSearchParams();
  /**
   * O PERÍODO MORA NA URL — mesmo contrato da Shopee e do TikTok.
   *
   * Sem os dois argumentos o hook fica surdo e mudo: não lê `?days=30` do
   * endereço e não avisa ninguém quando a pessoa clica. Ver `periodoNaUrl`
   * para o defeito que isso produziu na revisão de 31/08/2026.
   */
  const period = useDashboardPeriod(
    searchParams.toString(),
    useCallback(
      (query: string) =>
        router.push(`${location.pathname}?${periodoNaUrl(searchParams.toString(), query)}`, { scroll: false }),
      [router, searchParams],
    ),
  );
  /**
   * O resultado carrega A QUAL PERÍODO ele pertence.
   *
   * "Carregando" então é DERIVADO (`resultado.query !== period.query`) em vez de
   * ser uma terceira variável que alguém precisa lembrar de virar. Trocar de
   * período volta a mostrar o esqueleto sozinho, e nunca existe o meio-quadro em
   * que o número velho aparece sob o período novo.
   */
  const [resultado, setResultado] = useState<{ query: string; dados: AdsMultiCanal | null; erro: string | null } | null>(null);

  useEffect(() => {
    let cancelado = false;
    const query = period.query;
    fetch(`/api/ads?${query}`, { cache: "no-store" })
      .then(async (resposta) => {
        const corpo = await resposta.json();
        if (!resposta.ok) throw new Error(corpo.error || "Não foi possível ler os anúncios.");
        if (!cancelado) setResultado({ query, dados: corpo, erro: null });
      })
      .catch((motivo) => {
        if (!cancelado) setResultado({ query, dados: null, erro: motivo instanceof Error ? motivo.message : "Falha ao carregar." });
      });
    return () => { cancelado = true; };
  }, [period.query]);

  const carregando = resultado?.query !== period.query;
  const dados = resultado?.dados ?? null;
  const erro = resultado?.erro ?? null;
  const canais = dados?.canais ?? [];
  const produtos = dados?.produtos ?? [];
  const comDado = canais.filter((canal) => canal.estado === "com-dado");
  // O ML devolve o anúncio sem o SKU, então não há como saber que um MLB e um
  // SKU da Amazon são o mesmo produto. A tela DIZ isso em vez de omitir o bloco.
  const semSku = produtos.some((produto) => produto.sku == null);

  return (
    /**
     * ⚠️ O FRAME É O DA CASA, e isto foi um defeito meu achado na revisão de
     * 31/08/2026: eu tinha escrito `<div className="dashboard-shell">`, uma
     * classe que NÃO EXISTE no globals.css — inventada aqui e usada só por esta
     * página. Sem o frame, a página ficava sem o `min-width: 0` da raiz
     * (`IntegrationDashboardFrame.module.css`), e a fileira de canais
     * transbordava para a direita: o quarto card (TikTok) era CORTADO pela
     * borda, justo o único com ação ("Ver como ligar"). Conteúdo cortado que não
     * anuncia o corte é pior que conteúdo ausente.
     *
     * O frame também é quem posiciona o período antes do cabeçalho, que é a
     * ordem estrutural dos outros dashboards.
     */
    <IntegrationDashboardFrame
      className="channel-dashboard"
      period={<DashboardPeriodFilter {...period.filterProps} />}
      header={<PageHeader
        eyebrow="Todos os canais"
        title="Ads"
        subtitle="O que cada real de anúncio deixou, depois do custo do produto e da tarifa."
        icon={pageIcons.dashboard}
      />}
    >

      {carregando ? (
        <InlineLoading label="Carregando anúncios dos canais" />
      ) : erro ? (
        <EmptyState kind="data" title="Não foi possível carregar os anúncios" description={erro} />
      ) : (
        <div className="dashboard-sections channel-dashboard-sections">
          <section className="ads-bloco" aria-labelledby="ads-estado">
            <header>
              <p className="section-kicker">Situação</p>
              <h2 id="ads-estado">Onde cada canal está</h2>
            </header>
            <div className="ads-canais">
              {canais.map((canal) => <CartaoDoCanal key={canal.provider} canal={canal} />)}
            </div>
            {comDado.length > 1 ? (
              <p className="ads-nota">
                Os períodos são diferentes porque cada canal começou num dia. Não somamos os quatro num total — o número
                pareceria errado, e estaria.
              </p>
            ) : null}
          </section>

          {comDado.length > 0 ? (
            <section className="ads-bloco" aria-labelledby="ads-deixou">
              <header>
                <p className="section-kicker">Resultado</p>
                <h2 id="ads-deixou">O que o anúncio deixou</h2>
              </header>
              <div className="ads-cascatas">
                {comDado.map((canal) => (
                  <OQueOAnuncioDeixou key={canal.provider} canal={canal} produtos={produtos} />
                ))}
              </div>
            </section>
          ) : null}

          {produtos.length > 0 ? (
            <section className="ads-bloco" aria-labelledby="ads-produtos">
              <header>
                <p className="section-kicker">Produto anunciado</p>
                <h2 id="ads-produtos">Ainda dá lucro?</h2>
              </header>
              <TabelaDeProdutos produtos={produtos} />
              <p className="ads-nota">
                Receita, tarifa e custo são do período selecionado — não da janela de atribuição do canal. O ACOS ao lado
                vem da fonte, como ela mandou; “—” quer dizer que ela não informou.
              </p>
            </section>
          ) : (
            <EmptyState
              kind="data"
              title="Nenhum produto anunciado neste período"
              description="Quando uma campanha rodar, cada produto aparece aqui com o que sobrou depois do custo e da tarifa."
            />
          )}

          <PagandoSemVenda produtos={produtos} />

          {semSku ? (
            <section className="ads-bloco" aria-labelledby="ads-multicanal">
              <header>
                <p className="section-kicker">Multicanal</p>
                <h2 id="ads-multicanal">O mesmo produto em dois canais</h2>
              </header>
              <p className="ads-nota">
                Ainda não dá para comparar: o Mercado Livre devolve o anúncio sem o seu SKU, então não há como saber que
                um anúncio de lá e um da Amazon são o mesmo produto. Depende de o ML passar a informar o SKU no
                relatório.
              </p>
            </section>
          ) : null}

          <TabelaDeCampanhas campanhas={dados?.campanhas ?? []} />
        </div>
      )}
    </IntegrationDashboardFrame>
  );
}

/**
 * `useSearchParams` obriga a fronteira de Suspense em rota prerenderizada — a
 * mesma razão do monitor e dos módulos da Shopee.
 */
export default function AdsPage() {
  return (
    <Suspense fallback={<InlineLoading label="Carregando anúncios dos canais" />}>
      <Ads />
    </Suspense>
  );
}
