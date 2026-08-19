"use client";

import { useState } from "react";
import {
  Activity,
  Blocks,
  Boxes,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  Radar,
  Search,
  TrendingUp,
  User,
} from "lucide-react";
import { MarketplaceIcon, type MarketplaceIconProvider } from "../../components/MarketplaceIcon";
import "./lab.css";

/**
 * LABORATÓRIO — três formas de encolher o menu lateral, para escolher olhando.
 *
 * Rota isolada (`/lab/menu`): o `AppShell` a ignora, então nada aqui toca o menu
 * que está no ar. É protótipo para decisão, não código de produção — quando uma
 * opção for escolhida, ela é reescrita dentro de `AppShell`/`Nav`/`ChannelRail`,
 * que é onde a navegação de verdade mora.
 *
 * ## A mecânica, medida em `2.datadive.tools` (19/08/2026)
 *
 * O truque do DataDive é a `<aside>` **nunca mudar de largura**: ela reserva os
 * 68px do rail e mais nada. Dentro dela, um painel `position: absolute` anima a
 * própria largura até 256px, passando POR CIMA do conteúdo. Por isso nada reflui
 * quando o menu abre — e é isso que separa esse efeito do menu que só empurra a
 * página para o lado.
 *
 *   aside     largura fixa, sticky, z-index alto
 *   painel    fechado → 288px, absolute, 300ms cubic-bezier(0, 0, 0.2, 1)
 *   rótulos   recortados pelo `overflow-x: hidden` do container de scroll
 *   item      36px de altura, raio 8px, fonte 13px
 *
 * Aqui o painel aberto usa 288px, não 256px, porque os itens do NEXO têm
 * descrição embaixo do rótulo — coisa que o DataDive não tem.
 *
 * ## O que muda entre as três
 *
 * O DataDive tem UMA coluna de ícones. O NEXO tem duas ideias para caber nela:
 * os 5 canais e as páginas de dentro do canal. Cada opção resolve isso de um
 * jeito, e o que está em jogo é o que sobra visível com o menu fechado.
 */

type Item = {
  rotulo: string;
  desc: string;
  icone: React.ReactNode;
  ativo?: boolean;
  filhos?: boolean;
};

const ip = { className: "h-[18px] w-[18px]", strokeWidth: 1.8, "aria-hidden": true } as const;

const CANAIS: Array<{
  id: string;
  nome: string;
  sub: string;
  provider: MarketplaceIconProvider;
  ativo?: boolean;
}> = [
  { id: "overview", nome: "Central", sub: "Todos os canais", provider: "sellercore" },
  { id: "amazon", nome: "Amazon", sub: "Operação Amazon", provider: "amazon", ativo: true },
  { id: "meli", nome: "Mercado Livre", sub: "Operação ML", provider: "mercado_livre" },
  { id: "shopee", nome: "Shopee", sub: "Operação Shopee", provider: "shopee" },
  { id: "tiktok", nome: "TikTok Shop", sub: "Operação TikTok", provider: "tiktok_shop" },
];

const PAGINAS: Item[] = [
  { rotulo: "Visão do canal", desc: "Faturamento e lucro", icone: <LayoutDashboard {...ip} />, ativo: true },
  { rotulo: "Monitor", desc: "Vendas em tempo real", icone: <Activity {...ip} /> },
  { rotulo: "Desempenho", desc: "Tráfego e conversão", icone: <TrendingUp {...ip} /> },
  { rotulo: "Anúncios", desc: "Campanhas e lances", icone: <Megaphone {...ip} />, filhos: true },
  { rotulo: "Catálogo", desc: "Produtos publicados", icone: <Boxes {...ip} /> },
  { rotulo: "Estoque", desc: "Cobertura e ruptura", icone: <Radar {...ip} /> },
  { rotulo: "Integrações", desc: "Conexões dos canais", icone: <Blocks {...ip} /> },
];

/** Uma linha do menu: ícone na calha fixa, rótulo e descrição depois dela. */
function Linha({ item }: { item: Item }) {
  return (
    <a
      href="#"
      className={`lab-item${item.ativo ? " is-ativo" : ""}`}
      onClick={(e) => e.preventDefault()}
    >
      <span className="lab-item-icone">{item.icone}</span>
      <span className="lab-item-texto">
        <strong>{item.rotulo}</strong>
        <small>{item.desc}</small>
      </span>
      {item.filhos && <ChevronRight className="lab-item-seta h-3.5 w-3.5" strokeWidth={2} aria-hidden />}
    </a>
  );
}

function LinhaCanal({ canal, comNome }: { canal: (typeof CANAIS)[number]; comNome: boolean }) {
  return (
    <a
      href="#"
      title={canal.nome}
      className={`lab-canal${canal.ativo ? " is-ativo" : ""}`}
      onClick={(e) => e.preventDefault()}
    >
      <span className="lab-canal-icone">
        <MarketplaceIcon provider={canal.provider} size={26} app />
      </span>
      {comNome && (
        <span className="lab-item-texto">
          <strong>{canal.nome}</strong>
          <small>{canal.sub}</small>
        </span>
      )}
    </a>
  );
}

function Rodape() {
  return (
    <div className="lab-rodape">
      <a href="#" className="lab-item" onClick={(e) => e.preventDefault()}>
        <span className="lab-item-icone"><User {...ip} /></span>
        <span className="lab-item-texto"><strong>Sua conta</strong><small>Plano e cobrança</small></span>
      </a>
      <a href="#" className="lab-item" onClick={(e) => e.preventDefault()}>
        <span className="lab-item-icone"><LifeBuoy {...ip} /></span>
        <span className="lab-item-texto"><strong>Ajuda</strong><small>Suporte e docs</small></span>
      </a>
    </div>
  );
}

/** Cabeçalho do painel: marca e o botão de fixar aberto — o do DataDive. */
function Cabeca({ fixo, onFixar }: { fixo: boolean; onFixar: () => void }) {
  return (
    <div className="lab-cabeca">
      <span className="lab-marca">
        <span className="lab-marca-mark">N</span>
        <span className="lab-item-texto"><strong>NEXO</strong></span>
      </span>
      <button
        type="button"
        className="lab-fixar"
        onClick={onFixar}
        aria-pressed={fixo}
        title={fixo ? "Soltar o menu" : "Fixar o menu aberto"}
      >
        {fixo ? <ChevronsLeft className="h-4 w-4" aria-hidden /> : <ChevronsRight className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}

/** A — coluna única: canais e páginas na mesma calha, separados por divisória. */
function MenuUnico({ fixo, onFixar }: { fixo: boolean; onFixar: () => void }) {
  return (
    <aside className={`lab-aside is-unico${fixo ? " is-fixo" : ""}`}>
      <div className="lab-painel">
        <Cabeca fixo={fixo} onFixar={onFixar} />
        <div className="lab-busca">
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <span>Buscar</span>
        </div>
        <div className="lab-scroll">
          <p className="lab-secao">Canais</p>
          {CANAIS.map((c) => <LinhaCanal key={c.id} canal={c} comNome />)}
          <hr className="lab-divisoria" />
          <p className="lab-secao">Operação Amazon</p>
          {PAGINAS.map((p) => <Linha key={p.rotulo} item={p} />)}
        </div>
        <Rodape />
      </div>
    </aside>
  );
}

/** B — duas calhas: canais fixos à esquerda, painel das páginas deslizando. */
function MenuDuplo({ fixo, onFixar }: { fixo: boolean; onFixar: () => void }) {
  return (
    <aside className={`lab-aside is-duplo${fixo ? " is-fixo" : ""}`}>
      <div className="lab-canais-fixos">
        {CANAIS.map((c) => <LinhaCanal key={c.id} canal={c} comNome={false} />)}
      </div>
      <div className="lab-painel">
        <Cabeca fixo={fixo} onFixar={onFixar} />
        <div className="lab-scroll">
          <p className="lab-secao">Operação Amazon</p>
          {PAGINAS.map((p) => <Linha key={p.rotulo} item={p} />)}
        </div>
        <Rodape />
      </div>
    </aside>
  );
}

/** C — só os canais ficam de fora; o painel inteiro some quando fechado. */
function MenuSoCanais({ fixo, onFixar }: { fixo: boolean; onFixar: () => void }) {
  return (
    <aside className={`lab-aside is-so-canais${fixo ? " is-fixo" : ""}`}>
      <div className="lab-canais-fixos">
        {CANAIS.map((c) => <LinhaCanal key={c.id} canal={c} comNome={false} />)}
      </div>
      <div className="lab-painel">
        <Cabeca fixo={fixo} onFixar={onFixar} />
        <div className="lab-scroll">
          <p className="lab-secao">Operação Amazon</p>
          {PAGINAS.map((p) => <Linha key={p.rotulo} item={p} />)}
        </div>
        <Rodape />
      </div>
    </aside>
  );
}

const OPCOES = [
  {
    id: "a",
    titulo: "Coluna única",
    fechado: "68px",
    resumo: "Canais e páginas na mesma calha, com divisória entre eles — a forma do DataDive.",
    ganho: "Canvas ganha 220px. Com o menu fechado você vê o canal E a página.",
    custo: "Mexe em AppShell, ChannelRail e Nav: os canais deixam de ter coluna própria.",
  },
  {
    id: "b",
    titulo: "Duas calhas",
    fechado: "110px",
    resumo: "Canais continuam numa coluna fixa; só o painel das páginas desliza por cima.",
    ganho: "Canvas ganha 178px. Nunca perde orientação de canal nem de página.",
    custo: "Rail quase o dobro do DataDive, e a divisão entre as colunas fica sempre à vista.",
  },
  {
    id: "c",
    titulo: "Só os canais",
    fechado: "58px",
    resumo: "Mantém o rail de canais que já existe e esconde o painel inteiro.",
    ganho: "Canvas ganha 230px, o maior dos três. É o menor toque no código.",
    custo: "Com o menu fechado você não vê em que página está — só em que canal.",
  },
] as const;

export default function LabMenu() {
  const [opcao, setOpcao] = useState<(typeof OPCOES)[number]["id"]>("a");
  const [fixo, setFixo] = useState(false);
  const atual = OPCOES.find((o) => o.id === opcao) ?? OPCOES[0];
  const alternarFixo = () => setFixo((f) => !f);

  return (
    <div className="lab">
      <header className="lab-topo">
        <div>
          <h1>Menu lateral — três formas de encolher</h1>
          <p>
            Passe o mouse sobre o menu. Repare que o conteúdo à direita <strong>não se mexe</strong>:
            o painel abre por cima, que é o efeito do DataDive. O botão de setas fixa aberto.
          </p>
        </div>
        <div className="lab-escolha" role="tablist" aria-label="Opção de menu">
          {OPCOES.map((o) => (
            <button
              key={o.id}
              type="button"
              role="tab"
              aria-selected={o.id === opcao}
              className={o.id === opcao ? "is-ativa" : ""}
              onClick={() => setOpcao(o.id)}
            >
              <strong>{o.titulo}</strong>
              <small>fechado: {o.fechado}</small>
            </button>
          ))}
        </div>
      </header>

      <div className="lab-palco">
        {opcao === "a" ? <MenuUnico fixo={fixo} onFixar={alternarFixo} />
          : opcao === "b" ? <MenuDuplo fixo={fixo} onFixar={alternarFixo} />
          : <MenuSoCanais fixo={fixo} onFixar={alternarFixo} />}

        <main className="lab-canvas">
          <div className="lab-ficha">
            <p className="lab-ficha-kicker">Opção {atual.id.toUpperCase()} · {atual.titulo}</p>
            <p className="lab-ficha-resumo">{atual.resumo}</p>
            <dl>
              <div><dt>Ganha</dt><dd>{atual.ganho}</dd></div>
              <div><dt>Custa</dt><dd>{atual.custo}</dd></div>
            </dl>
          </div>

          {/* Blocos de mentira: existem só para dar o que sobrepor e deixar
              evidente que a página não reflui quando o menu abre. */}
          <div className="lab-falso-cards">
            {["Faturamento", "Taxas", "Lucro", "Estoque"].map((t) => (
              <div key={t} className="lab-falso-card">
                <small>{t}</small>
                <span />
                <span className="is-curto" />
              </div>
            ))}
          </div>
          <div className="lab-falso-bloco" />
          <div className="lab-falso-bloco is-baixo" />
        </main>
      </div>
    </div>
  );
}
