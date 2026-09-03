import Link from "next/link";

import { PageHeader, pageIcons } from "../../../components/PageHeader";
import { IntegrationDashboardFrame } from "../../../components/IntegrationDashboardFrame";

/**
 * COMO LIGAR OS ANÚNCIOS DA SHOPEE E DO TIKTOK.
 *
 * ⚠️ Página curta DE PROPÓSITO. O guia completo (28/08/2026) tem 105 linhas com
 * decisões dela e textos prontos para colar em formulário; enfiar tudo aqui
 * enterraria a tela de operação, e resumir numa frase perderia o aviso do
 * GMV Max — que é o único ponto onde um clique errado APAGA campanha em
 * produção. Então: as peças, o dono de cada uma, e o aviso em destaque.
 *
 * O que a Ana faz aqui é DECIDIR e CADASTRAR. Nada nesta página dispara ação
 * nossa — é conteúdo.
 */
export default function ComoLigarAdsPage() {
  return (
    // Mesmo frame da aba — ver a nota em `ads/page.tsx` sobre a classe
    // inventada que deixava a página sem `min-width: 0` e cortava conteúdo.
    <IntegrationDashboardFrame
      className="channel-dashboard"
      header={<PageHeader
        eyebrow="Ads"
        title="Como ligar Shopee e TikTok"
        subtitle="Dois cadastros independentes. Nenhum mexe no que já funciona."
        icon={pageIcons.dashboard}
      />}
    >
      <div className="dashboard-sections channel-dashboard-sections">
        <section className="ads-bloco" aria-labelledby="ads-tiktok">
          <header>
            <p className="section-kicker">TikTok Shop</p>
            <h2 id="ads-tiktok">Os anúncios ficam no TikTok for Business</h2>
          </header>
          <p className="ads-nota">
            Os anúncios do TikTok — inclusive o GMV Max, o formato feito para a loja — não moram no TikTok Shop. Eles
            ficam no <strong>TikTok for Business</strong>, que tem cadastro próprio. A nossa aprovação de TikTok Shop
            (DSPR) não vale lá.
          </p>

          {/* O ÚNICO AVISO DESTA PÁGINA QUE PRECISA PARAR O OLHO: é o passo em
              que um "sim" apaga campanha que está rodando. */}
          <div className="ads-aviso-forte" role="note">
            <strong>Antes de qualquer clique</strong>
            <p>
              Só <b>uma</b> conta de anúncios pode ter a autorização “GMV Max” da sua loja por vez — e trocar de conta{" "}
              <b>encerra as campanhas GMV Max da conta anterior</b>. Não é aviso teórico: é o desenho da plataforma.
            </p>
            <p>
              Se uma agência ou parceiro pedir essa autorização, <b>não aceite sem falar com a gente antes</b>.
            </p>
          </div>

          <ol className="ads-passos">
            <li><span>Conta de anúncios (Ads Manager)</span> <small>você</small></li>
            <li><span>Business Center e ligar a loja (GMV Max)</span> <small>você</small></li>
            <li><span>App de desenvolvedor na Marketing API</span> <small>NEXO</small></li>
            <li><span>Autorizar o NEXO a ler o desempenho</span> <small>você</small></li>
          </ol>

          <p className="ads-nota">
            <strong>API liberada não cria dado — campanha cria.</strong> Se hoje não roda nenhuma campanha no TikTok,
            tudo acima funciona e a tela vem vazia, como uma planilha com as colunas certas e nenhuma linha. Não é
            problema técnico, é sequência.
          </p>
        </section>

        <section className="ads-bloco" aria-labelledby="ads-shopee">
          <header>
            <p className="section-kicker">Shopee</p>
            <h2 id="ads-shopee">App aprovado; integração em implementação</h2>
          </header>
          <p className="ads-nota">
            O app de Ads foi criado na categoria certa (“Ads Service” — a categoria é imutável depois de criada) e já
            está <strong>aprovado e online</strong> no console, conferido em 02/09/2026. O que falta agora é nosso:
            implementar a leitura de gasto e desempenho por produto. Não há passo seu pendente aqui.
          </p>
        </section>

        {/* ⚠️ O CARIMBO E O ITEM QUE EVITA A PROXIMA VEZ.

            Esta pagina e ESTADO DE TERCEIRO ESCRITO: ela afirma com confianca o
            que so se sabe abrindo o console de outra empresa. Sem data, ela
            envelhece calada — e foi o que aconteceu: o bloco da Shopee passou 26
            dias dizendo "esperando a aprovacao deles" DEPOIS de o Go Live ter
            sido aprovado. O `docs/estado-atual.md` teve o mesmo defeito, no mesmo
            periodo.

            A ultima frase existe para resolver a divergencia sem consultar
            ninguem: quando a pagina e o console discordam, quem esta velho e a
            pagina. */}
        <p className="ads-nota ads-verificado">
          Estado verificado em 02/09/2026. Cadastro de terceiro muda sem aviso — se algo aqui não bater com o que você
          vê no console, o console está certo.
        </p>

        <p className="ads-nota">
          <Link href="/ads">← Voltar para os Ads</Link>
        </p>
      </div>
    </IntegrationDashboardFrame>
  );
}
