import Link from "next/link";
import { NexoWordmark } from "../components/NexoWordmark";
import { MostraSaldo, MostraAuditoria } from "./Mostruario";
import { FitaFunil } from "./FitaFunil";
import { Vitrine } from "./Vitrine";
import { Contadores } from "./Contadores";
import { Manifesto } from "./Manifesto";
import { GraficoMetricas } from "./GraficoMetricas";

export const metadata = {
  title: "NEXO — o funcionário que confere cada venda",
  description:
    "O NEXO abre cada venda dos seus canais, lê a tarifa que foi cobrada e fecha a conta. Amazon, Mercado Livre, Shopee e TikTok Shop.",
};

/**
 * ESBOÇO da landing. Rota própria (`/landing`) de propósito: a raiz e o login
 * seguem intocados enquanto ela dá feedback do que entra e do que sai.
 *
 * Estrutura vem do dub.co (hero curto → manifesto → pilar por pilar com UI real
 * → contadores → CTA). Os efeitos de revelação vêm do midday.ai. Mapa completo,
 * com as três versões de hero e os riscos, em `docs/landing-nexo.md`.
 *
 * ## A voz: o NEXO é um funcionário, não um painel
 *
 * A copy fala dele em terceira pessoa — "ele abre", "ele confere", "ele compara" —
 * porque a proposta do produto é assumir um trabalho que hoje alguém faz na mão,
 * não oferecer mais um dashboard para a pessoa interpretar.
 *
 * ⚠️ **O limite dessa voz.** Só entram verbos que descrevem o que o código
 * realmente executa hoje: ler tarifa, conciliar pedido, comparar frete,
 * acompanhar liberação. O harness de agente — chat sobre a operação, alerta
 * proativo, recomendação, ação autônoma — está em `docs/ai-agent-harness.md`
 * com status **ideia / backlog, não implementar agora**. Enquanto for backlog, a
 * landing não promete nada disso: "funcionário" aqui é a descrição do serviço
 * que já roda, não a antecipação do que ele vai virar.
 *
 * Duas regras que valem aqui como valem no produto:
 * — número em landing é promessa; só entra o que foi medido (ver `CONTADORES`);
 * — nada de depoimento inventado. A seção de prova social do dub não tem
 *   equivalente honesto ainda, então não existe aqui.
 */

const PILARES = [
  {
    id: "financeiro",
    kicker: "Financeiro",
    titulo: "Ele abre cada venda e fecha a conta",
    texto:
      "Não é estimativa. Ele lê a tarifa que o marketplace postou e monta a conta inteira — inclusive quando ela ainda não fechou.",
    itens: [
      ["Faturamento é o valor pago", "Preço de tabela não conta. Cupom já vem descontado."],
      ["Tarifa discriminada", "Comissão, logística e anúncios separados, não um bloco só."],
      ["Diz o que falta", "Sem custo cadastrado, ele deixa o lucro em branco em vez de chutar."],
    ],
  },
  {
    id: "saldo",
    kicker: "Saldo",
    titulo: "Ele acompanha quando o dinheiro cai",
    texto:
      "Lucro no papel não paga fornecedor. Ele mostra o que está retido, quanto já liberou e a data de cada liberação.",
    itens: [
      ["Data por venda", "Cada pedido tem a sua data de liberação, não uma média."],
      ["Líquido de verdade", "Já sem tarifa e sem a sua parte do frete."],
      ["Cobrança a caminho", "Saldo negativo aparece antes de chegar no cartão."],
    ],
  },
  {
    id: "auditoria",
    kicker: "Auditoria",
    titulo: "Ele confere o frete, pedido a pedido",
    texto:
      "Ele compara o frete que o marketplace cobrou com o que o envio declara. Diferença não vira acusação — vira lista para você decidir.",
    itens: [
      ["Duas fontes independentes", "O que foi cobrado contra o que era para custar."],
      ["Pronto para contestar", "Número do pedido, valores e diferença, em um clique."],
      ["Sem alarme falso", "Ele só levanta a mão quando as duas pontas não fecham."],
    ],
  },
];


/** A descrição do cargo: o que hoje é feito na mão, e quanto custa fazer. */
const CUSTOS: Array<[string, string, string]> = [
  ["Conferir repasse", "2 horas por semana", "Abrir cada venda no marketplace e conferir tarifa, frete e imposto na mão."],
  ["Fechar o mês", "meio dia", "Juntar quatro painéis numa planilha e torcer para os totais baterem."],
  ["Achar o erro", "quando acha", "Cobrança divergente só aparece se alguém for procurar pedido a pedido."],
];

/** Só números medidos no banco em 16/08/2026. Ver `docs/landing-nexo.md`. */
const CONTADORES = [
  { valor: "70.479", rotulo: "pedidos já conferidos" },
  { valor: "4", rotulo: "canais que ele acompanha" },
  { valor: "1", rotulo: "aba para a operação inteira" },
];

export default function LandingPage() {
  return (
    <main className="lp">
      <header className="lp-nav">
        <NexoWordmark as="span" className="lp-marca" />
        <nav className="lp-nav-links" aria-label="Navegação principal">
          <Link href="#produto">Produto</Link>
          <Link href="#como-funciona">Como funciona</Link>
          <Link href="#resultados">Resultados</Link>
        </nav>
        <Link href="/login" className="lp-cta-mini">Entrar</Link>
      </header>

      <section className="lp-hero">
        <p className="lp-pill">Amazon · Mercado Livre · Shopee · TikTok Shop</p>
        {/* As duas metades são elementos separados de propósito: a segunda recua
            para preto 42% (`.lp-hero h1 span`). É a assinatura do peec.ai — dá
            hierarquia dentro de uma frase só, sem cor e sem segunda família. */}
        <h1>
          Você vende. <span>Ele confere.</span>
        </h1>
        <p className="lp-sub">
          O NEXO assume o trabalho que hoje alguém faz na mão: abre cada venda dos seus
          quatro canais, lê a tarifa que foi cobrada e fecha a conta. Quando o dado não
          existe, ele diz que não existe.
        </p>
        <div className="lp-acoes">
          <Link href="/login" className="lp-cta">Colocar para trabalhar</Link>
          <Link href="#financeiro" className="lp-cta-secundaria">Ver o que ele faz</Link>
        </div>
      </section>

      {/* A tela inteira do produto logo abaixo do hero — o que o dub faz.
          As pills acima dela são as abas flutuantes deles (Short Links /
          Conversion Analytics / Affiliate Programs). Lá são abas que trocam o
          mock; aqui são âncoras de verdade para as três seções profundas —
          mesmo elemento visual, sem fingir interação que não existe. */}
      <section id="produto" className="lp-vitrine-secao">
        <Vitrine />
      </section>

      {/* Padrão real do midday (`time-savings-section.tsx`): problema + custo em
          horas, em cartões quadrados. Serve melhor que manifesto solto. */}
      <section id="como-funciona" className="lp-custos">
        <div className="lp-custos-topo">
          <h2>O trabalho que ele tira das suas mãos.</h2>
          <p>Três tarefas que hoje comem o seu dia — e que ele refaz a cada venda que entra.</p>
        </div>
        <div className="lp-custos-grade">
          {CUSTOS.map(([o_que, quanto, texto]) => (
            <article key={o_que}>
              <p>{o_que}</p>
              <h3>{quanto}</h3>
              <span>{texto}</span>
            </article>
          ))}
        </div>
      </section>

      <Manifesto />

      {PILARES.map((pilar, i) => (
        <section key={pilar.id} id={pilar.id} className={`lp-pilar${i % 2 ? " is-invertido" : ""}`}>
          <div className="lp-pilar-texto">
            <p className="lp-kicker">{pilar.kicker}</p>
            <h2>{pilar.titulo}</h2>
            <p>{pilar.texto}</p>
            <ul className="lp-itens">
              {pilar.itens.map(([titulo, desc]) => (
                <li key={titulo}>
                  <strong>{titulo}</strong>
                  <span>{desc}</span>
                </li>
              ))}
            </ul>
          </div>
          {/* A UI de verdade é o argumento — o texto só apresenta. */}
          <div className="lp-pilar-ui">
            {pilar.id === "financeiro" ? <FitaFunil />
              : pilar.id === "saldo" ? <MostraSaldo />
              : <MostraAuditoria />}
          </div>
        </section>
      ))}

      <GraficoMetricas />

      <div id="resultados">
        <Contadores itens={CONTADORES} />
      </div>

      <section className="lp-fim">
        <h2>Ele começa a conferir hoje.</h2>
        <Link href="/login" className="lp-cta">Colocar para trabalhar</Link>
      </section>

      <footer className="lp-footer">
        <NexoWordmark as="span" className="lp-footer-marca" />
        <span>Operação multicanal com dados explícitos.</span>
        <nav aria-label="Links institucionais">
          <Link href="/privacidade">Privacidade</Link>
          <Link href="/login">Entrar</Link>
        </nav>
      </footer>
    </main>
  );
}
