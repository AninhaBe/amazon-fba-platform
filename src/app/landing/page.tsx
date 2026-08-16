import Link from "next/link";
import { NexoWordmark } from "../components/NexoWordmark";

export const metadata = {
  title: "NEXO — Pare de adivinhar quanto sobrou",
  description:
    "Faturamento, tarifa, imposto e frete de todos os seus canais numa conta só. Amazon, Mercado Livre, Shopee e TikTok Shop.",
};

/**
 * ESBOÇO da landing. Rota própria (`/landing`) de propósito: a raiz e o login
 * seguem intocados enquanto ela dá feedback do que entra e do que sai.
 *
 * Estrutura vem do dub.co (hero curto → manifesto → pilar por pilar com UI real
 * → contadores → CTA). Os efeitos de revelação vêm do midday.ai. Mapa completo,
 * com as três versões de hero e os riscos, em `docs/landing-nexo.md`.
 *
 * Duas regras que valem aqui como valem no produto:
 * — número em landing é promessa; só entra o que foi medido (ver `contadores`);
 * — nada de depoimento inventado. A seção de prova social do dub não tem
 *   equivalente honesto ainda, então não existe aqui.
 */

const PILARES = [
  {
    id: "financeiro",
    kicker: "Financeiro",
    titulo: "O que sobrou, com a tarifa que foi cobrada",
    texto:
      "Não é estimativa. Lemos a tarifa que o marketplace postou e mostramos a conta inteira — inclusive quando ela ainda não fechou.",
    itens: [
      ["Faturamento é o valor pago", "Preço de tabela não conta. Cupom já vem descontado."],
      ["Tarifa discriminada", "Comissão, logística e anúncios separados, não um bloco só."],
      ["Diz o que falta", "Sem custo cadastrado, o lucro fica em branco em vez de mentir."],
    ],
  },
  {
    id: "saldo",
    kicker: "Saldo",
    titulo: "Quando o dinheiro cai",
    texto:
      "Lucro no papel não paga fornecedor. Mostramos o que está retido, quanto já liberou e a data de cada liberação.",
    itens: [
      ["Data por venda", "Cada pedido tem a sua data de liberação, não uma média."],
      ["Líquido de verdade", "Já sem tarifa e sem a sua parte do frete."],
      ["Cobrança a caminho", "Saldo negativo aparece antes de chegar no cartão."],
    ],
  },
  {
    id: "auditoria",
    kicker: "Auditoria",
    titulo: "Pedidos a revisar",
    texto:
      "Comparamos o frete que o marketplace cobrou com o que o envio declara. Diferença não vira acusação — vira lista para você decidir.",
    itens: [
      ["Duas fontes independentes", "O que foi cobrado contra o que era para custar."],
      ["Pronto para contestar", "Número do pedido, valores e diferença, em um clique."],
      ["Sem alarme falso", "Divergência só aparece quando as duas pontas não fecham."],
    ],
  },
];

/** Só números medidos no banco em 16/08/2026. Ver `docs/landing-nexo.md`. */
const CONTADORES = [
  { valor: "70.479", rotulo: "pedidos conciliados" },
  { valor: "4", rotulo: "canais integrados" },
  { valor: "1", rotulo: "aba para a operação inteira" },
];

export default function LandingPage() {
  return (
    <main className="lp">
      <header className="lp-nav">
        <NexoWordmark as="span" className="lp-marca" />
        <Link href="/login" className="lp-cta-mini">Entrar</Link>
      </header>

      <section className="lp-hero">
        <p className="lp-pill">Amazon · Mercado Livre · Shopee · TikTok Shop</p>
        <h1>Pare de adivinhar quanto sobrou.</h1>
        <p className="lp-sub">
          Faturamento, tarifa, imposto e frete de todos os seus canais numa conta só.
          Quando o dado não existe, a gente diz que não existe.
        </p>
        <div className="lp-acoes">
          <Link href="/login" className="lp-cta">Começar agora</Link>
          <Link href="#financeiro" className="lp-cta-secundaria">Ver como funciona</Link>
        </div>
      </section>

      <section className="lp-manifesto">
        <h2>
          Não é sobre quanto você vendeu.
          <br />
          <strong>É sobre quanto sobrou.</strong>
        </h2>
        <p>
          O NEXO junta <em>o que o marketplace cobrou</em>, <em>o que o comprador pagou</em> e{" "}
          <em>quando o dinheiro cai</em> — numa conta só.
        </p>
        <p className="lp-manifesto-fecho">
          Porque relatório que arredonda para zero não é relatório. É palpite bonito.
        </p>
      </section>

      {PILARES.map((pilar) => (
        <section key={pilar.id} id={pilar.id} className="lp-pilar">
          <div className="lp-pilar-texto">
            <p className="lp-kicker">{pilar.kicker}</p>
            <h2>{pilar.titulo}</h2>
            <p>{pilar.texto}</p>
          </div>
          <ul className="lp-itens">
            {pilar.itens.map(([titulo, desc]) => (
              <li key={titulo}>
                <strong>{titulo}</strong>
                <span>{desc}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="lp-contadores" aria-label="Números da plataforma">
        {CONTADORES.map((c) => (
          <div key={c.rotulo}>
            <strong>{c.valor}</strong>
            <span>{c.rotulo}</span>
          </div>
        ))}
      </section>

      <section className="lp-fim">
        <h2>Sua operação inteira numa aba.</h2>
        <Link href="/login" className="lp-cta">Começar agora</Link>
      </section>
    </main>
  );
}
