"use client";

import { useState } from "react";
import "./identidade.css";

/**
 * BANCADA DE IDENTIDADE — o mesmo conteúdo do NEXO em três direções visuais.
 *
 * Existe porque olhar o site do Sequence conta sobre o Sequence, não sobre nós.
 * Aqui o hero real da landing (mesmas frases, mesmos números de 16/08/2026) é
 * renderizado nas três, com os cards e a fileira de canais junto — que é onde a
 * decisão realmente aperta, porque Amazon, Mercado Livre, Shopee e TikTok
 * trazem laranja, amarelo, vermelho e rosa para dentro da tela de qualquer
 * jeito.
 *
 * Referências, todas de produto de dados ou de finanças, todas claras:
 *   A  sequencehq.com  serifada peso normal + wash pastel
 *   B  peec.ai         monocromática, cor só no dado
 *   C  lightdash.com   sans pesada + um acento como motivo gráfico
 *
 * Protótipo para decisão. Nada aqui é código de produção — quando uma direção
 * for escolhida, ela é aplicada em `globals.css` e na landing de verdade.
 */

const DIRECOES = [
  {
    id: "a",
    nome: "A · Serifada clara",
    ref: "sequencehq.com",
    resumo: "É o que a landing já é hoje, mais o wash pastel nas bordas.",
    muda: "Quase nada. Mantém a serifada em peso 400 e a tinta azulada.",
    custa: "Menos personalidade — parece muitos SaaS de finanças.",
  },
  {
    id: "b",
    nome: "B · Monocromática",
    ref: "peec.ai",
    resumo: "Branco, preto e cinza. A única cor da interface é a que significa algo.",
    muda: "Título vira sans pesado em duas tonalidades. Some a tinta azulada.",
    custa: "Perde a serifada, que é a coisa mais distinta que a landing tem hoje.",
  },
  {
    id: "c",
    nome: "C · Sans com acento",
    ref: "lightdash.com",
    resumo: "Sans pesada quase preta e um acento de marca usado como motivo.",
    muda: "Título sans pesado, e o acento aparece em blocos, não só em botão.",
    custa: "Uma quinta cor disputando espaço com os quatro canais.",
  },
] as const;

type Direcao = (typeof DIRECOES)[number]["id"];

const CARDS: Array<{ rotulo: string; valor: string; nota: string; tom?: "lucro" }> = [
  { rotulo: "Faturamento", valor: "R$ 108,34", nota: "5 vendas no período" },
  { rotulo: "Taxas", valor: "R$ 6,12", nota: "Total do período" },
  { rotulo: "Custo dos produtos", valor: "R$ 34,10", nota: "Total do período" },
  { rotulo: "Lucro", valor: "R$ 61,49", nota: "60,5% de margem", tom: "lucro" },
];

const CANAIS = [
  { nome: "Amazon", cor: "#FF9900" },
  { nome: "Mercado Livre", cor: "#FFE600" },
  { nome: "Shopee", cor: "#EE4D2D" },
  { nome: "TikTok Shop", cor: "#FE2C55" },
];

export default function LabIdentidade() {
  const [direcao, setDirecao] = useState<Direcao>("b");
  const atual = DIRECOES.find((d) => d.id === direcao) ?? DIRECOES[0];

  return (
    <div className="idp">
      <header className="idp-topo">
        <div>
          <h1>Identidade do NEXO — três direções</h1>
          <p>
            O mesmo hero, os mesmos números. Repare no que acontece com a fileira de canais
            no fim de cada tela: é ali que a escolha cobra o preço.
          </p>
        </div>
        <div className="idp-escolha" role="tablist" aria-label="Direção visual">
          {DIRECOES.map((d) => (
            <button
              key={d.id}
              type="button"
              role="tab"
              aria-selected={d.id === direcao}
              className={d.id === direcao ? "is-ativa" : ""}
              onClick={() => setDirecao(d.id)}
            >
              <strong>{d.nome}</strong>
              <small>{d.ref}</small>
            </button>
          ))}
        </div>
      </header>

      <div className="idp-ficha">
        <p>{atual.resumo}</p>
        <dl>
          <div><dt>Muda</dt><dd>{atual.muda}</dd></div>
          <div><dt>Custa</dt><dd>{atual.custa}</dd></div>
        </dl>
      </div>

      {/* A amostra inteira troca de classe: é a mesma marcação nas três. */}
      <main className={`idp-amostra is-${direcao}`}>
        <div className="idp-hero">
          <p className="idp-pill">Amazon · Mercado Livre · Shopee · TikTok Shop</p>
          <h2>
            <span className="idp-linha1">Você vende.</span>{" "}
            <span className="idp-linha2">Ele confere.</span>
          </h2>
          <p className="idp-sub">
            O NEXO assume o trabalho que hoje alguém faz na mão: abre cada venda dos seus
            quatro canais, lê a tarifa que foi cobrada e fecha a conta. Quando o dado não
            existe, ele diz que não existe.
          </p>
          <div className="idp-acoes">
            <span className="idp-cta">Colocar para trabalhar</span>
            <span className="idp-cta-2">Ver o que ele faz</span>
          </div>
        </div>

        <div className="idp-cards">
          {CARDS.map((c) => (
            <div key={c.rotulo} className={c.tom ? `is-${c.tom}` : ""}>
              <small>{c.rotulo}</small>
              <strong>{c.valor}</strong>
              <em>{c.nota}</em>
            </div>
          ))}
        </div>

        {/* O teste de fogo: as quatro marcas entram na tela queira ou não. */}
        <div className="idp-canais">
          <p className="idp-canais-titulo">Conectados</p>
          <div className="idp-canais-fila">
            {CANAIS.map((c) => (
              <span key={c.nome} className="idp-canal">
                <i style={{ background: c.cor }} aria-hidden="true" />
                {c.nome}
              </span>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
