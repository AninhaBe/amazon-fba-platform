"use client";

/**
 * Bancada das variantes do menu — `/lab/menu`.
 *
 * ⚠️ EXISTE PORQUE ELA PEDIU PARA VER, NAO PARA LER. Pedido de
 * 10/09/2026: *"tem opcoes visuais pra escolher? cria na web mesmo os
 * exemplos"*. Descrever "item ativo com mais presenca" em prosa e pedir que ela
 * imagine — e imaginar errado e como as duas composicoes reprovadas no comeco
 * desta frente passaram.
 *
 * ⚠️ AS COLUNAS USAM AS CLASSES DE VERDADE (`rail-group`,
 * `rail-nav-item`, `picto`). Uma copia com marcacao propria divergiria do menu
 * no primeiro ajuste e passaria a aprovar um desenho que o produto nao tem — o
 * mesmo defeito que `docs/landing-nexo.md` ja registrou noutra frente.
 *
 * O que cada variante muda esta escrito na propria coluna, e o CSS delas vive
 * em `globals.css` sob `.menu-variante-*` — escopado, entao nada aqui vaza para
 * a barra de producao enquanto ela nao escolher.
 */

import { pictogramasNexo } from "../../components/pictogramasNexo";

type Item = { chave: string; rotulo: string; contador?: number; ativo?: boolean };
type Bloco = { titulo: string; itens: Item[] };

const BLOCOS: Bloco[] = [
  {
    titulo: "Painéis",
    itens: [
      { chave: "dashboard", rotulo: "Dashboard", ativo: true },
      { chave: "briefing", rotulo: "Briefing" },
      { chave: "monitor", rotulo: "Monitor da conta" },
      { chave: "auditoria", rotulo: "Pedidos a revisar", contador: 2 },
    ],
  },
  {
    titulo: "Catálogo",
    itens: [
      { chave: "anuncios", rotulo: "Anúncios" },
      { chave: "produtos", rotulo: "Produtos", contador: 3 },
      { chave: "estoque", rotulo: "Radar de estoque", contador: 3 },
    ],
  },
  {
    titulo: "Ferramentas",
    itens: [
      { chave: "performance", rotulo: "Curva ABC" },
      { chave: "calculator", rotulo: "Calculadora" },
    ],
  },
];

const VARIANTES = [
  {
    id: "hoje",
    nome: "A · Hoje",
    resumo: "Como está agora, para comparar.",
  },
  {
    id: "contadores",
    nome: "B · Contadores",
    resumo: "Número no item que tem trabalho. Zero não aparece — item sem pendência fica limpo.",
  },
  {
    id: "ativo",
    nome: "C · Ativo com presença",
    resumo: "Superfície branca, tinta cheia e barra de 2px na cor do canal.",
  },
  {
    id: "contraste",
    nome: "D · Rótulos mais escuros",
    resumo: "Itens em tinta 80%; só os títulos de bloco seguem claros.",
  },
  {
    id: "tudo",
    nome: "E · B + C + D juntos",
    resumo: "As três somadas. O movimento no hover está em todas — passe o mouse.",
  },
];

function Coluna({ id, nome, resumo }: { id: string; nome: string; resumo: string }) {
  const mostraContador = id === "contadores" || id === "tudo";
  return (
    <div className="menu-variante-col">
      <div className="menu-variante-rotulo">
        <strong>{nome}</strong>
        <span>{resumo}</span>
      </div>
      <div className={`nexo-sidebar menu-variante menu-variante-${id}`}>
        <nav className="nexo-sidebar-nav">
          {BLOCOS.map((b) => (
            <div className="rail-group" key={b.titulo}>
              <div className="rail-group-header">
                <span className="rail-group-label">{b.titulo}</span>
                <svg className="rail-group-chevron is-open" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path
                    d="M8.67171 5.25C9.66052 5.25031 10.2007 6.40372 9.56777 7.16351L7.8964 9.1693C7.43003 9.72866 6.57066 9.72854 6.10423 9.1693L4.43286 7.16351C3.79969 6.40366 4.33991 5.25012 5.32894 5.25H8.67171Z"
                    fill="currentColor"
                  />
                </svg>
              </div>
              <div className="rail-group-body is-open">
                <div className="rail-group-body-inner">
                  {b.itens.map((i) => (
                    <span
                      className={`rail-nav-item${i.ativo ? " is-ativo" : ""}`}
                      key={i.rotulo}
                    >
                      {pictogramasNexo[i.chave] ?? pictogramasNexo.dashboard}
                      <span className="rail-nav-text">{i.rotulo}</span>
                      {/* ⚠️ ZERO NAO VIRA BADGE. Item sem pendencia
                          fica limpo; "0" ao lado do nome parece alarme apagado
                          e treina a pessoa a ignorar o numero. */}
                      {mostraContador && i.contador ? (
                        <em className="rail-nav-contador">{i.contador}</em>
                      ) : null}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}

export default function BancadaDoMenu() {
  return (
    <div className="menu-variantes">
      <header className="menu-variantes-cab">
        <h1>Variantes do menu</h1>
        <p>
          Cinco colunas com a marcação e os pictogramas de verdade. Passe o mouse nos itens: o
          movimento (ícone 4% maior, item 1px para a direita) está em todas as variantes, porque
          é o único que não dá para ver parado.
        </p>
      </header>
      <div className="menu-variantes-grade">
        {VARIANTES.map((v) => (
          <Coluna key={v.id} {...v} />
        ))}
      </div>
    </div>
  );
}
