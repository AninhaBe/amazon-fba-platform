"use client";


import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search, Settings, ShieldCheck } from "lucide-react";
import { useEhAdmin } from "./useEhAdmin";
import type { WorkspaceId } from "@/lib/integrations/workspaces";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { NavLinks } from "./Nav";
import { MarcaDoSeletor } from "./MarcaDoSeletor";
import { LogoutButton } from "./LogoutButton";
import { AccountSwitcher } from "./AccountSwitcher";
import accountStyles from "./ShellAccountLinks.module.css";
import { NEXO_ONBOARDING_CHANNELS_EVENT } from "@/lib/productTour";

/**
 * SIDEBAR ÚNICA — a estrutura de navegação do NEXO na anatomia medida em
 * `docs/peec-ui-audit.md`.
 *
 * ## O que mudou e por quê
 *
 * A casca anterior tinha DUAS calhas de ícone (canal + páginas, 118px), e o
 * painel com os rótulos só abria no hover. Funciona, e a mecânica está bem
 * resolvida em `OperationsRail.tsx` — que **continua no repositório** e é o que
 * a bancada `/lab/rail` exercita.
 *
 * O problema não era a mecânica, era o que ficava visível em repouso: **ícone
 * sem rótulo**. Numa operação com 12 páginas por canal, o ícone sozinho obriga
 * a decorar ou a passar o mouse para ler. A referência resolve isso com uma
 * sidebar única onde o rótulo está sempre na tela.
 *
 * ## A troca que destrava o espaço
 *
 * A referência não tem calha de canal — ela troca de contexto por um **dropdown
 * no topo da própria sidebar**. Transferir esse padrão é o que permite ter
 * rótulo sempre visível sem estourar a largura: os quatro marketplaces saem da
 * coluna de ícones e viram esse seletor.
 *
 * Largura: 240px, contra 118px fechada / 288px aberta da versão anterior. Em
 * repouso ocupa mais; aberta ocupa menos; e nunca cobre o conteúdo.
 */

const NOME_CANAL: Record<WorkspaceId, string> = {
  overview: "Todos os canais",
  amazon: "Amazon",
  mercado_livre: "Mercado Livre",
  shopee: "Shopee",
  tiktok_shop: "TikTok Shop",
};

const CANAIS: Array<{ id: WorkspaceId; href: string }> = [
  { id: "overview", href: "/" },
  { id: "amazon", href: "/amazon" },
  { id: "mercado_livre", href: "/mercado-livre" },
  { id: "shopee", href: "/shopee" },
  { id: "tiktok_shop", href: "/tiktok" },
];

export function SidebarNexo({ workspace, collapsed = false }: { workspace: WorkspaceId; collapsed?: boolean }) {
  const ehAdmin = useEhAdmin();
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  const switcherRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAberto(false);
      switcherRef.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [aberto]);

  useEffect(() => {
    const syncTour = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: boolean }>).detail;
      if (typeof detail?.open === "boolean") setAberto(detail.open);
    };
    window.addEventListener(NEXO_ONBOARDING_CHANNELS_EVENT, syncTour);
    return () => window.removeEventListener(NEXO_ONBOARDING_CHANNELS_EVENT, syncTour);
  }, []);

  return (
    <aside className={`nexo-sidebar${collapsed ? " is-collapsed" : ""}`} aria-label="Navegação principal">
      <div className="nexo-sidebar-topo">
        <div className="nexo-switcher-wrap">
          <button
            ref={switcherRef}
            type="button"
            className="nexo-switcher"
            data-onboarding="channels"
            aria-expanded={aberto}
            aria-haspopup="menu"
            /* ⚠️ O NOME ACESSIVEL VIRA EXPLICITO porque a marca
               agora e um monograma com aria-hidden. Sem isto o botao seria
               anunciado so como "Mercado Livre", e nao como o CONTROLE que
               troca de canal. */
            aria-label={`Canal atual: ${NOME_CANAL[workspace]}. Trocar de canal`}
            onClick={() => setAberto((v) => !v)}
          >
            {/* ⚠️ A MARCA SE RECOLHE: NEXO → NX → so o icone. Decisao
                dela em 09/09/2026, reafirmada depois do meu parecer contrario —
                o parecer inteiro esta em MarcaDoSeletor.tsx, junto do codigo.

                O ganho medido: em repouso sobra o icone sozinho, e o nome do
                canal passa de 81px para 116px. Com "seta + NEXO" escrito,
                "Todos os canais" cortava em -10px. */}
            <MarcaDoSeletor />
            {/* ⚠️ ICONE E NOME NUM GRUPO SO, e o grupo e que centra.
                Antes o nome centrava sozinho numa faixa de 112px enquanto o
                icone ficava fixo ao lado da marca — com um nome curto como
                "Amazon" abria um vao entre os dois, fotografado por ela em
                09/09/2026. Ícone e nome dizem a MESMA coisa (qual canal), entao
                andam juntos: sem vao entre eles, e o par inteiro centrado. */}
            <span className="nexo-switcher-canal">
              {/* ⚠️ COMENTARIO FORA DA CONDICIONAL, nao dentro. Um
                  comentario JSX dentro do parenteses de `cond && (...)` vira
                  uma SEGUNDA expressao e o arquivo nao compila — quebrou a
                  barra inteira em 09/09/2026.

                  E cuidado ao ESCREVER sobre isso: citar o delimitador de
                  fechamento dentro do proprio comentario o encerra na hora.
                  Quebrou de novo, no comentario que explicava a primeira
                  quebra.

                  17px: dois a mais que os 15 originais, pedido dela. O icone do
                  canal e o chevron ficaram pequenos ao lado da marca, que subiu
                  para 22px na rodada anterior. */}
              {workspace !== "overview" && (
                <MarketplaceIcon provider={workspace} size={17} app />
              )}
              <span className="nexo-switcher-channel">{NOME_CANAL[workspace]}</span>
            </span>
            <svg className="nexo-switcher-chevron" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path
                d="M8.67171 5.25C9.66052 5.25031 10.2007 6.40372 9.56777 7.16351L7.8964 9.1693C7.43003 9.72866 6.57066 9.72854 6.10423 9.1693L4.43286 7.16351C3.79969 6.40366 4.33991 5.25012 5.32894 5.25H8.67171Z"
                fill="currentColor"
              />
            </svg>
          </button>

          {aberto && (
            <>
              {/* Clique fora fecha. Sem véu escuro: o menu é pequeno e escurecer
                  a tela inteira para uma escolha de cinco itens é desproporcional. */}
              <button
                type="button"
                className="nexo-switcher-fora"
                aria-label="Fechar seletor de canal"
                onClick={() => setAberto(false)}
              />
              <div className="nexo-switcher-menu" role="menu" data-onboarding="channels">
                {CANAIS.map((canal) => (
                  <Link
                    key={canal.id}
                    href={canal.href}
                    role="menuitem"
                    className={`nexo-switcher-item${canal.id === workspace ? " is-atual" : ""}`}
                    onClick={() => setAberto(false)}
                  >
                    <MarketplaceIcon
                      provider={canal.id === "overview" ? "sellercore" : canal.id}
                      size={16}
                      app
                    />
                    <span>{NOME_CANAL[canal.id]}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
        <Link href="/pesquisa" className="nexo-sidebar-busca" aria-label="Pesquisa">
          <Search aria-hidden />
        </Link>
      </div>

      {/* A nav agrupada com rótulo já existia; o que mudou é ela estar sempre
          visível em vez de morar num painel que só abre no hover. */}
      <nav className="nexo-sidebar-nav">
        <NavLinks variant="sidebar" workspace={workspace} compact={collapsed} />
      </nav>

      <div className="nexo-sidebar-rodape">
        {workspace === "amazon" ? (
          <AccountSwitcher compact />
        ) : (
          <Link href="/integracoes" className="nexo-sidebar-conta">
            <MarketplaceIcon
              provider={workspace === "mercado_livre" ? "mercado_livre" : "sellercore"}
              size={20}
              app
            />
            <span>{workspace === "mercado_livre" ? "Gerenciar integração" : "Ver integrações"}</span>
          </Link>
        )}
        <div className={accountStyles.utilityLinks} aria-label="Conta e configurações">
          <Link href="/configuracoes" className={`${accountStyles.utility}${collapsed ? ` ${accountStyles.utilityCollapsed}` : ""}`} aria-current={pathname === "/configuracoes" ? "page" : undefined}>
            <Settings aria-hidden />
            <span>Configurações</span>
          </Link>
          {/* Só aparece depois que o SERVIDOR confirma. Mostrar o link é
              conveniência; quem protege é o `comAdmin` na rota de dados. */}
          {ehAdmin && (
            <Link href="/admin" className={`${accountStyles.utility}${collapsed ? ` ${accountStyles.utilityCollapsed}` : ""}`} aria-current={pathname === "/admin" ? "page" : undefined}>
              <ShieldCheck aria-hidden />
              <span>Administração</span>
            </Link>
          )}
        </div>
        <LogoutButton />
      </div>
    </aside>
  );
}
