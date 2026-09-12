"use client";
import type { CanalV3 } from "@/lib/canalV3";

/**
 * A metade de baixo do dashboard na estrutura **v3** — lida do canvas dela
 * (`Dashboard Mercado Livre v3.dc.html`, projeto 977f6a09, via DesignSync,
 * 09/09/2026). Completa o que a primeira viewport (`PainelV3.tsx`) começou.
 *
 * Ordem do canvas: Pedidos a revisar (largura total) → duas colunas, com
 * Raio X + Anúncios pagos à esquerda e Promoções + Radar do FULL + Saldo à
 * direita.
 *
 * ⚠️ DOIS BLOCOS DO CANVAS NÃO EXISTEM AQUI, E A AUSÊNCIA É
 * DELIBERADA: **Raio X do catálogo** e **Promoções oferecidas** pedem dado que o
 * NEXO ainda não busca — concorrentes por catálogo (preço para ganhar, spread,
 * quantos em FULL) e as campanhas que o ML oferece com a divisão do desconto.
 * Não há rota para nenhum dos dois em `api/integrations/mercado-livre/`.
 *
 * Desenhá-los com número inventado seria pior que não tê-los: a tela inteira
 * existe para a vendedora confiar no que lê. Eles entram quando o backend
 * entrar — o layout está descrito no canvas e não se perde.
 *
 * ⚠️ "PEDIDOS A REVISAR" NÃO É "TODAS AS VENDAS". O canvas é
 * explícito: só o que pede ação — margem negativa, custo ausente, ou tarifa e
 * frete que o ML ainda não confirmou no extrato. O resto fica em Vendas. Por
 * isso a lista aqui é FILTRADA, e o rodapé diz quantos ficaram de fora.
 */

import type { ReactNode } from "react";
import { ChipDeMargem } from "./PainelV3";

/* ── Contrato ─────────────────────────────────────────────────────────────── */

export interface PedidoARevisar {
  id: string;
  produto: string;
  detalhe: string;
  pedido: string;
  logistica: string;
  /** Por que ele está aqui. É o que transforma lista em fila de trabalho. */
  venda: string;
  tarifa: string;
  frete: string;
  custo: string;
  /** `true` quando o custo é desconhecido — pinta o travessão de cinza. */
  custoVazio?: boolean;
  imposto: string;
  impostoVazio?: boolean;
  margemPct: number | null;
}

export interface AnuncioV3 {
  id: string;
  produto: string;
  trafego: string;
  gasto: string;
  /** Valor vendido atribuído ao anúncio. */
  vendas: string;
  /** Quantidade de compras atribuídas — contagem, não dinheiro. */
  compras: string;
  acos: string;
  roas: string;
  semVenda?: boolean;
  margemPct: number | null;
}

export interface ItemDoRadar {
  id: string;
  titulo: string;
  unidades: string;
  cobertura: string;
  tom: "critico" | "atencao" | "saudavel" | "vazio";
}

export interface CatalogoV3 {
  id: string;
  titulo: string;
  nota: string;
  posicao: string;
  full: string;
  spread: string;
  preco: string;
  margemPct: number | null;
}

export interface PromocaoV3 {
  id: string;
  nome: string;
  preco: string;
  /** Fatia do desconto que o ML banca, de 0 a 100. */
  ml: number;
  margem: string;
}

export interface DadosV3Baixo {
  /**
   * ⚠️ DADO DE EXEMPLO ENQUANTO NÃO HÁ ROTA. Concorrentes por
   * catálogo (preço para ganhar, spread, quantos em FULL) não existem em
   * `api/integrations/mercado-livre/`. Decisão dela em 09/09/2026: *"estamos
   * trabalhando no front, não precisa ser dado real, depois vemos isso"*.
   *
   * Quem ligar o backend troca a fonte e apaga este comentário — o formato aqui
   * já é o que a rota precisa devolver.
   */
  catalogo: { itens: CatalogoV3[]; resumo: string; href: string } | null;
  /** Mesma condição do `catalogo`: layout pronto, rota pendente. */
  promocoes: { itens: PromocaoV3[]; resumo: string; href: string } | null;
  /* ⚠️ SEM `resumo`. O cartao trazia "5 de 5 pedidos do periodo"
     ao lado do titulo e ela mandou tirar (10/09/2026). O campo saiu do contrato
     junto, senao ficaria um dado calculado que ninguem le — e o proximo a mexer
     aqui gastaria tempo entendendo para onde ele vai. */
  revisar: {
    linhas: PedidoARevisar[];
    href: string;
    vazio: string;
    /**
     * ⚠️ A FRASE DE ESCOPO, E ELA NAO E O `resumo` QUE SAIU. O
     * `resumo` dizia "5 de 5 pedidos do periodo" — contagem redundante quando
     * todos cabem, e ela mandou tirar (10/09/2026). Esta e outra coisa, e so
     * aparece quando a lista NAO cobre o periodo: diz que os totais financeiros
     * acima consideram o periodo completo, enquanto a lista mostra os mais
     * recentes.
     *
     * ⚠️ POR QUE VOLTOU (11/09/2026): sem ela, cinco linhas
     * aparecem debaixo de totais de centenas de pedidos sem nada dizendo que sao
     * um recorte — e a conclusao errada e imediata ("foram so esses pedidos").
     * `undefined` quando o periodo esta completo: ai o recorte nao existe e a
     * frase seria ruido.
     */
    escopo?: ReactNode;
  } | null;
  anuncios: { linhas: AnuncioV3[]; resumo: ReactNode; href: string } | null;
  radar: { itens: ItemDoRadar[]; href: string; vazio: string };
  /** O saldo tem fetch próprio; quem o desenha é quem já o busca. */
  saldo: ReactNode;
}

/* ── A metade de baixo ────────────────────────────────────────────────────── */

export function PainelV3Baixo({ canal, dados }: {
  /**
   * ⚠️ OBRIGATÓRIO pelo mesmo motivo da tabela de vendas: este
   * bloco também fixava "Tarifa ML" no cabeçalho. Hoje só o Mercado Livre o
   * renderiza, e é justamente por isso que o campo precisa ser obrigatório —
   * o canal que chegar segundo é quem herda o rótulo errado em silêncio.
   */
  canal: CanalV3;
  dados: DadosV3Baixo;
}) {
  return (
    /*
     * ⚠️ O `.v3` AQUI NAO E DECORACAO — ele carrega os tokens do bloco
     * (--linha, --card, --suave). Sem ele o fragmento renderiza FORA do escopo,
     * `border: 1px solid var(--linha)` resolve para cor invalida e o card fica
     * sem moldura nenhuma, sobre fundo branco: foi exatamente o que apareceu na
     * tela em 09/09/2026, e nada ficou vermelho — CSS invalido e ignorado em
     * silencio.
     */
    <div className="v3">
      {dados.revisar ? (
        <section className="v3-card">
          <div className="v3-card-cab">
            <h2>Pedidos</h2>
            <div className="v3-card-cab-dir">
              <a className="v3-btn" href={dados.revisar.href}>Abrir vendas →</a>
            </div>
          </div>
          {dados.revisar.escopo ? <p className="v3-nota">{dados.revisar.escopo}</p> : null}
          {dados.revisar.linhas.length === 0 ? (
            <p className="v3-nota">{dados.revisar.vazio}</p>
          ) : (
            <div className="v3-tabela v3-tabela-pedidos">
              <div className="v3-revisar-cab">
                <span>Produto</span>
                <span>Pedido</span>
                <span>Logística</span>
                <span>Venda</span>
                <span>{canal.rotuloDaTarifa}</span>
                <span>Frete</span>
                <span>Custo</span>
                <span>Imposto</span>
                <span>Margem</span>
              </div>
              {dados.revisar.linhas.map((v) => (
                <div className="v3-revisar-linha" key={v.id}>
                  <span className="v3-cel-nome">
                    <span className="v3-margem-titulo" title={v.produto}>{v.produto}</span>
                    <span className="v3-cel-sub">{v.detalhe}</span>
                  </span>
                  <span className="v3-cel-pedido">{v.pedido}</span>
                  <span className="v3-cel-meio">{v.logistica}</span>
                  <span className="v3-cel-num">{v.venda}</span>
                  <span className="v3-cel-num">{v.tarifa}</span>
                  <span className="v3-cel-num">{v.frete}</span>
                  <span className={`v3-cel-num${v.custoVazio ? " is-vazio" : ""}`}>{v.custo}</span>
                  <span className={`v3-cel-num${v.impostoVazio ? " is-vazio" : ""}`}>{v.imposto}</span>
                  <span className="v3-cel-centro"><ChipDeMargem pct={v.margemPct} /></span>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className="v3-duas-baixo">
        <div className="v3-pilha">
          {dados.catalogo ? (
            <div className="v3-card">
              <div className="v3-card-cab">
                <h2>Raio X do catálogo</h2>
                <div className="v3-card-cab-dir">
                  <span className="v3-meta">{dados.catalogo.resumo}</span>
                  <a className="v3-btn" href={dados.catalogo.href}>Abrir raio X →</a>
                </div>
              </div>
              <p className="v3-nota">
                O Mercado Livre entrega os concorrentes de cada catálogo com preço e logística. O NEXO
                cruza isso com o seu custo: a coluna que importa é a margem no preço necessário para ganhar.
              </p>
              <div className="v3-tabela v3-tabela-raiox">
                <div className="v3-raiox-cab">
                  <span>Catálogo</span>
                  <span>Sua posição</span>
                  <span>Em FULL</span>
                  {/* ⚠️ O "i" USA O MESMO COMPONENTE DA FAIXA DO TOPO
                      (`metric-info`), nao um tooltip novo: dica que aparece de
                      um jeito num cartao e de outro no vizinho vira dois
                      comportamentos para a mesma funcao.

                      A explicacao existe porque "spread" e jargao de mercado
                      financeiro, e este cartao e para vendedor. Enquanto o nome
                      nao muda, a dica paga a divida. */}
                  <span>
                    Spread
                    <span
                      className="metric-info"
                      data-dica="Distância entre o preço mais barato e o mais caro deste catálogo: 118% quer dizer que o mais caro custa 2,2× o mais barato. Spread baixo é briga de centavos; spread alto significa que há oferta cara vendendo."
                      tabIndex={0}
                      role="note"
                    >
                      i
                    </span>
                  </span>
                  <span>Preço p/ ganhar</span>
                  <span>Margem nele</span>
                </div>
                {dados.catalogo.itens.map((c) => (
                  <div className="v3-raiox-linha" key={c.id}>
                    <span className="v3-cel-nome">
                      <span className="v3-margem-titulo" title={c.titulo}>{c.titulo}</span>
                      <span className="v3-cel-sub">{c.nota}</span>
                    </span>
                    <span className="v3-raiox-num">{c.posicao}</span>
                    <span className="v3-raiox-num is-suave">{c.full}</span>
                    <span className="v3-raiox-num">{c.spread}</span>
                    <span className="v3-raiox-num">{c.preco}</span>
                    <span className="v3-cel-fim"><ChipDeMargem pct={c.margemPct} /></span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {dados.anuncios ? (
            <div className="v3-card">
              <div className="v3-card-cab">
                <h2>Anúncios pagos</h2>
                <div className="v3-card-cab-dir">
                  <span className="v3-meta">{dados.anuncios.resumo}</span>
                  <a className="v3-btn" href={dados.anuncios.href}>Abrir anúncios →</a>
                </div>
              </div>
              <p className="v3-nota">
                ACOS e ROAS vêm do Mercado Livre. A margem real cruza o gasto do anúncio com o seu
                custo e a tarifa — é a coluna que diz se o anúncio valeu. Este gasto não está
                descontado do lucro acima: no Mercado Livre ele sai no seu fechamento.
              </p>
              <div className="v3-tabela v3-tabela-ads">
                <div className="v3-ads-cab">
                  <span>Produto · impressões e cliques</span>
                  <span>Gasto</span>
                  <span>Vendas</span>
                  <span>Compras</span>
                  <span>ACOS</span>
                  <span>ROAS</span>
                  <span>Margem real</span>
                </div>
                {dados.anuncios.linhas.map((a) => (
                  <div className="v3-ads-linha" key={a.id}>
                    <span className="v3-cel-nome">
                      <span className="v3-margem-titulo" title={a.produto}>{a.produto}</span>
                      <span className="v3-cel-sub">{a.trafego}</span>
                    </span>
                    <span className="v3-cel-num is-dir">{a.gasto}</span>
                    <span className={`v3-cel-num is-dir${a.semVenda ? " is-vazio" : ""}`}>{a.vendas}</span>
                    <span className={`v3-cel-num is-dir${a.semVenda ? " is-vazio" : ""}`}>{a.compras}</span>
                    <span className={`v3-cel-num is-dir${a.semVenda ? " is-vazio" : ""}`}>{a.acos}</span>
                    <span className={`v3-cel-num is-dir${a.semVenda ? " is-vazio" : ""}`}>{a.roas}</span>
                    <span className="v3-cel-fim"><ChipDeMargem pct={a.margemPct} /></span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="v3-pilha">
          {dados.promocoes ? (
            <div className="v3-card">
              <div className="v3-card-cab">
                <h2>Promoções oferecidas</h2>
                <div className="v3-card-cab-dir">
                  <span className="v3-meta">{dados.promocoes.resumo}</span>
                  <a className="v3-btn" href={dados.promocoes.href}>Abrir promoções →</a>
                </div>
              </div>
              <p className="v3-nota">
                A divisão do desconto é o que decide: entrar numa campanha que o Mercado Livre banca
                pela metade é diferente de bancar sozinha.
              </p>
              {dados.promocoes.itens.map((pr) => (
                <div className="v3-promo" key={pr.id}>
                  <div className="v3-promo-topo">
                    <strong>{pr.nome}</strong>
                    <span className="v3-promo-preco">{pr.preco}</span>
                  </div>
                  <div className="v3-promo-barra">
                    <span className="v3-promo-ml" style={{ width: pr.ml + "%" }} />
                    <span className="v3-promo-voce" style={{ width: 100 - pr.ml + "%" }} />
                  </div>
                  <div className="v3-promo-pe">
                    <span>ML banca {pr.ml}%</span>
                    <span>você banca {100 - pr.ml}% · margem final {pr.margem}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="v3-card">
            <div className="v3-card-cab">
              <h2>Radar do FULL</h2>
              <a className="v3-btn" href={dados.radar.href}>Abrir radar →</a>
            </div>
            {dados.radar.itens.length === 0 ? (
              <p className="v3-nota">{dados.radar.vazio}</p>
            ) : (
              <div className="v3-tabela v3-tabela-radar">
                <div className="v3-radar-cab">
                  <span>Produto no FULL</span>
                  <span>Estoque</span>
                  <span>Cobertura</span>
                </div>
                {dados.radar.itens.map((e) => (
                  <div className="v3-radar-linha" key={e.id}>
                    <span className="v3-margem-titulo" title={e.titulo}>{e.titulo}</span>
                    <span className="v3-radar-un">{e.unidades}</span>
                    <span className="v3-cel-fim">
                      <em className={`v3-chip v3-cobertura is-${e.tom}`}>{e.cobertura}</em>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {dados.saldo}
        </div>
      </section>
    </div>
  );
}
