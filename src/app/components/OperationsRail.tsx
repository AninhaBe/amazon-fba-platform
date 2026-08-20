"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AccountSwitcher } from "./AccountSwitcher";
import { ChannelRail } from "./ChannelRail";
import { NavLinks } from "./Nav";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { LogoutButton } from "./LogoutButton";
import type { WorkspaceId } from "@/lib/integrations/workspaces";

/**
 * O menu lateral do app, em componente próprio.
 *
 * Ele saiu de dentro do `AppShell` por um motivo prático: o `AppShell` só
 * aparece para quem tem sessão, então mexer no menu obrigava a estar logado
 * para conferir qualquer ajuste. Aqui ele pode ser montado sozinho em
 * `/lab/rail` — mesmos componentes, mesmas classes, mesmo CSS — e o que se vê
 * lá é o que vai para produção.
 *
 * ## Como ele encolhe
 *
 * Forma escolhida em 19/08/2026 a partir de `2.datadive.tools` (opção B do
 * laboratório). A `<aside>` tem largura FIXA de 118px e **nunca muda**: ela só
 * reserva o espaço. Quem anima é o `.rail-panel`, `absolute`, que cresce a
 * própria largura por cima do canvas. Por isso a página não reflui quando o
 * menu abre.
 *
 *   58px   canais, sempre visíveis
 *   60px   painel fechado — só os ícones das páginas
 *   230px  painel aberto (58 + 230 = 288px, a largura que o menu tinha antes)
 *
 * A geometria e as transições estão em `globals.css` → "Menu que encolhe". Não
 * mexer nos 60px sem refazer a conta que centraliza o ícone, que está lá.
 */

const channelName: Record<WorkspaceId, string> = {
  overview: "Central",
  amazon: "Amazon",
  mercado_livre: "Mercado Livre",
  shopee: "Shopee",
  tiktok_shop: "TikTok Shop",
};
const channelSub: Record<WorkspaceId, string> = {
  overview: "Todos os canais",
  amazon: "Operação Amazon",
  mercado_livre: "Operação Mercado Livre",
  shopee: "Operação Shopee",
  tiktok_shop: "Operação TikTok Shop",
};

/** Preferência de menu fixo aberto. Mesmo padrão de chave usado em `Nav.tsx`. */
const FIXO_KEY = "nexo:menu-fixo";

export function OperationsRail({ workspace }: { workspace: WorkspaceId }) {
  // Quem prefere o menu sempre aberto fixa no botão, e a escolha sobrevive ao
  // reload. O `setTimeout(0)` para ler o storage é o mesmo padrão de `Nav.tsx`:
  // mantém o primeiro render igual ao do servidor (evita descasamento de
  // hidratação) e não chama `setState` direto no corpo do efeito.
  const [fixo, setFixo] = useState(false);
  const hidratado = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (localStorage.getItem(FIXO_KEY) === "1") setFixo(true);
      } catch {
        // ignora storage indisponível
      } finally {
        hidratado.current = true;
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hidratado.current) return;
    try {
      localStorage.setItem(FIXO_KEY, fixo ? "1" : "0");
    } catch {
      // ignora storage indisponível
    }
  }, [fixo]);

  // Foco de TECLADO abre o painel; foco de clique não.
  //
  // Isto existia como `:focus-within` no CSS e estava errado: clicar em
  // qualquer item deixa o foco dentro do painel, e ele nunca mais fechava — o
  // seletor não sabe diferenciar as duas origens do foco. `:focus-visible` sabe,
  // mas só dá para consultá-lo por elemento, não pelo ancestral.
  const [focoTeclado, setFocoTeclado] = useState(false);

  const aoFocar = (evento: React.FocusEvent<HTMLElement>) => {
    let porTeclado = true;
    try {
      porTeclado = evento.target.matches(":focus-visible");
    } catch {
      // Navegador sem `:focus-visible`: abrir a mais é melhor do que prender
      // quem navega por teclado num painel de 60px sem rótulo.
    }
    // Atribui, não só liga: mover o foco por clique de um item para outro dentro
    // do próprio menu tem que DESLIGAR a flag. Só ligando, um `Tab` inicial
    // deixava o painel preso aberto pelo resto da sessão.
    setFocoTeclado(porTeclado);
  };

  const aoDesfocar = (evento: React.FocusEvent<HTMLElement>) => {
    // Trocar de item dentro do próprio menu não é sair dele.
    if (!evento.currentTarget.contains(evento.relatedTarget)) setFocoTeclado(false);
  };

  return (
    <aside
      className={`operations-rail sticky top-0 h-screen shrink-0${fixo ? " is-fixo" : ""}${focoTeclado ? " is-teclado" : ""}`}
      onFocus={aoFocar}
      onBlur={aoDesfocar}
    >
      <ChannelRail workspace={workspace} />
      <div className="rail-panel flex min-w-0 flex-col">
        <div className="rail-panel-head">
          <div className="rail-panel-head-texto">
            <p className="rail-panel-title">{channelName[workspace]}</p>
            <p className="rail-panel-sub">{channelSub[workspace]}</p>
          </div>
          <button
            type="button"
            className="rail-fixar"
            aria-pressed={fixo}
            title={fixo ? "Soltar o menu" : "Fixar o menu aberto"}
            onClick={() => setFixo((f) => !f)}
          >
            {fixo ? <PanelLeftClose className="h-4 w-4" aria-hidden /> : <PanelLeftOpen className="h-4 w-4" aria-hidden />}
            <span className="sr-only">{fixo ? "Soltar o menu lateral" : "Fixar o menu lateral aberto"}</span>
          </button>
        </div>
        <div className="rail-panel-nav flex-1 overflow-y-auto px-2 py-3">
          <NavLinks variant="sidebar" workspace={workspace} />
        </div>
        <div className="rail-account px-3 py-4">
          {workspace === "amazon" ? <AccountSwitcher /> : (
            <Link href="/integracoes" className="workspace-account-link">
              <span className="workspace-account-mark" aria-hidden="true">
                <MarketplaceIcon provider={workspace === "mercado_livre" ? "mercado_livre" : "sellercore"} size={30} app />
              </span>
              <span>
                <small>{workspace === "mercado_livre" ? "Conta Mercado Livre" : "Ecossistema NEXO"}</small>
                <strong>{workspace === "mercado_livre" ? "Gerenciar integração" : "Ver integrações"}</strong>
              </span>
            </Link>
          )}
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}
