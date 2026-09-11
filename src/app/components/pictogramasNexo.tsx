"use client";

/**
 * Pictogramas PRÓPRIOS do NEXO — teste de quatro peças (09/09/2026).
 *
 * ⚠️ ISTO É UM TESTE, NÃO A TROCA. Existe para ser comparado lado a
 * lado com o Fluent Emoji em `/lab/icones`. A decisão de substituir é dela,
 * depois de ver os dois no mesmo tamanho e no fundo escuro do menu.
 *
 * ⚠️ TROCAR NÃO É OBRIGAÇÃO LEGAL. O Fluent Emoji é MIT (Microsoft) —
 * pode ser usado comercialmente, modificado e distribuído, bastando manter o
 * aviso de licença. O motivo de desenhar os nossos é IDENTIDADE, não licença.
 *
 * AS REGRAS DO CONJUNTO — é o que separa "ícone nosso" de "emoji":
 *
 *   1. grade de 24px, cantos de 1.5–2px, mesma massa em todos;
 *   2. **flat**: sem gradiente, sem brilho, sem sombra interna. É o que mais
 *      afasta de emoji de sistema;
 *   3. **um matiz por ícone, em até três valores** (claro/médio/escuro). Três
 *      valores dão volume sem gradiente; matiz único impede a barra de virar
 *      arco-íris;
 *   4. silhueta cheia com UM detalhe interno. Detalhe demais some em 18px.
 *
 * Se este teste for aprovado, o conjunto cresce seguindo estas quatro regras —
 * ícone novo que precise quebrar uma delas é sinal de que a regra está errada,
 * e aí ela muda para todos, nunca só para o novo.
 */

import type { ReactNode } from "react";

/* Um matiz por ícone, três valores. Saem da paleta de dados do v3. */
const VIOLETA = { claro: "#a99cf2", medio: "#7b68e8", escuro: "#5546c9" };
const AMBAR = { claro: "#f9c95c", medio: "#eeab2e", escuro: "#c98a1c" };
const LILAS = { claro: "#dda6e8", medio: "#c47fd6", escuro: "#9d59b0" };
const TEAL = { claro: "#7fd4c8", medio: "#45b0a2", escuro: "#2c8b80", forte: "#166b61" };
const RADAR = { claro: "#ff7a5c", medio: "#e8452c", escuro: "#8f1f10", fundo: "#2b1410" };
const AZUL = { claro: "#bfdcfd", medio: "#4b9bf5", escuro: "#1f5fbf" };

export const pictogramasNexo: Record<string, ReactNode> = {
  /* Painel: quatro blocos de um quadro. O maior à esquerda ancora a leitura. */
  dashboard: (
    <svg viewBox="0 0 24 24" className="picto" aria-hidden>
      <rect x="3" y="3" width="8.5" height="11" rx="2" fill={VIOLETA.escuro} />
      <rect x="13.5" y="3" width="7.5" height="6.5" rx="2" fill={VIOLETA.claro} />
      <rect x="3" y="16" width="8.5" height="5" rx="2" fill={VIOLETA.claro} />
      <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2" fill={VIOLETA.medio} />
    </svg>
  ),

  /* Produto: caixa isométrica. Três faces = os três valores do matiz. */
  produtos: (
    <svg viewBox="0 0 24 24" className="picto" aria-hidden>
      <path d="M12 2.5 21.5 7 12 11.5 2.5 7Z" fill={AMBAR.claro} />
      <path d="M2.5 7 12 11.5V21.5L2.5 17Z" fill={AMBAR.escuro} />
      <path d="M21.5 7 12 11.5V21.5L21.5 17Z" fill={AMBAR.medio} />
    </svg>
  ),

  /* Anúncio = catálogo publicado. Duas etiquetas: a diagonal e a ponta dão uma
     silhueta que nenhum outro ícone do menu tem, e o par diz "vários itens".
     O furo é buraco de verdade (evenodd) — pintado de branco, sumiria no menu
     escuro. */
  anuncios: (
    <svg viewBox="0 0 24 24" className="picto" aria-hidden>
      <path d="M9.6 1.6h5.2a2 2 0 0 1 2 2v5.2a2 2 0 0 1-.59 1.41l-7.4 7.4a2 2 0 0 1-2.83 0L1.6 12.2a2 2 0 0 1 0-2.83l7.4-7.4A2 2 0 0 1 9.6 1.6Z" fill={LILAS.claro} />
      <path fillRule="evenodd" clipRule="evenodd" d="M14.4 5.2h5.6a2.4 2.4 0 0 1 2.4 2.4V13.2a2.4 2.4 0 0 1-.7 1.7l-7.8 7.8a2.4 2.4 0 0 1-3.4 0l-5.6-5.6a2.4 2.4 0 0 1 0-3.4l7.8-7.8a2.4 2.4 0 0 1 1.7-.7Zm4 2.6a2.05 2.05 0 1 0 0 4.1 2.05 2.05 0 0 0 0-4.1Z" fill={LILAS.escuro} />
    </svg>
  ),

  /* Radar de estoque — tela de radar: disco escuro, anel, feixe de varredura e
     ponto central. Um anel só e grosso: em 18px, traço fino desaparece.

     O vermelho é escolha dela. Aqui ele é cor de OBJETO (a tela), não estado —
     o item do menu não está alarmado. Se confundir com prejuízo em uso, é uma
     linha para trocar. */
  estoque: (
    <svg viewBox="0 0 24 24" className="picto" aria-hidden>
      <circle cx="12" cy="12" r="10" fill={RADAR.fundo} />
      <path d="M12 12 1.6 8.6A11 11 0 0 0 1.6 15.4Z" fill={RADAR.claro} />
      <circle cx="12" cy="12" r="6" fill="none" stroke={RADAR.medio} strokeWidth="2.2" />
      <circle cx="12" cy="12" r="2.4" fill={RADAR.claro} />
    </svg>
  ),


  /* Briefing — a leitura do dia — derivado do Fluent light-bulb (MIT), matiz amarelo. */
  briefing: (
    <svg viewBox="0 0 32 32" className="picto" aria-hidden>
      <g fill="none">
      <path fill="#c08910" d="M17.651 22.27h-3.89c-.79 0-1.44.64-1.43 1.43v3.89c0 .79.64 1.43 1.43 1.43h.248a1.94 1.94 0 0 0 3.384 0h.258c.79 0 1.43-.64 1.43-1.43V23.7c0-.79-.64-1.43-1.43-1.43"/>
      <path fill="#f5b722" d="M18.161 23.13c.24 0 .43-.18.45-.41c.07-.86.44-2.95 2.46-5.19a8.66 8.66 0 0 0 3.29-6.31c.02-.24.03-.4.03-.5v-.1c-.06-4.78-3.93-8.62-8.7-8.62a8.69 8.69 0 0 0-8.69 8.6s-.01.24.03.64c.16 2.54 1.4 4.79 3.29 6.28c2.02 2.25 2.42 4.34 2.49 5.2c.02.23.21.41.45.41z"/>
      <path fill="#f5b722" d="M15.701 10.7c1.62 0 2.94 1.31 2.96 2.93v.08c0 .03 0 .07-.01.13c-.05.84-.46 1.63-1.12 2.15l-.07.05l-.06.06c-1.1 1.22-1.33 4.32-1.37 6.02h-.65c-.05-1.7-.29-4.8-1.39-6.02l-.06-.06l-.07-.05a2.96 2.96 0 0 1-1.12-2.17c0-.04-.01-.07-.01-.09v-.09c.03-1.62 1.36-2.94 2.97-2.94m0-1a3.96 3.96 0 0 0-2.45 7.07c1.2 1.34 1.14 6.36 1.14 6.36h2.64s-.08-5.02 1.13-6.35c.86-.68 1.43-1.71 1.5-2.88c.01-.11.01-.18.01-.23v-.04a3.97 3.97 0 0 0-3.97-3.93"/>
      <path fill="#ffd97a" d="M19.167 25.053a.5.5 0 1 0-.172-.986l-6.74 1.18a.5.5 0 1 0 .172.986zm-.05 2.15a.5.5 0 0 0-.172-.985l-6.65 1.17a.5.5 0 1 0 .173.984z"/>
      <path fill="#ffe9b3" d="M13.791 5.44c-1.11 1.92-.55 4.32 1.25 5.35s4.15.32 5.26-1.6s.55-4.32-1.25-5.35s-4.15-.32-5.26 1.6"/>
      </g>
    </svg>
  ),

  /* Monitor da conta = pedidos e financeiro. Tela com linha de pulso: a palavra
     "monitor" já dá a forma, e o pulso é o que ele mostra. Desenho nosso — é
     geometria (retângulo e zigue-zague), que é onde o desenho próprio ganha. */
  monitor: (
    <svg viewBox="0 0 24 24" className="picto" aria-hidden>
      <rect x="1.5" y="3.5" width="21" height="15" rx="3" fill={AZUL.escuro} />
      <path d="M4.6 11.6h3.1l2-4.2 2.9 8 2-3.8h2.8" fill="none" stroke={AZUL.claro} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="8" y="19.6" width="8" height="2.4" rx="1.2" fill={AZUL.medio} />
    </svg>
  ),

  /* Pedidos a revisar = frete cobrado x declarado. Balanca: o item e uma
     COMPARACAO entre dois valores, e a prancheta anterior nao dizia isso.
     Derivado do Fluent "balance-scale" (MIT), matiz teal. */
  auditoria: (
    <svg viewBox="0 0 32 32" className="picto" aria-hidden>
      <g fill="none">
      <path fill="#2c8b80" d="M19.949 11.75h4.02a.749.749 0 1 0 0-1.5h-4.02c-.38 0-.73-.18-.95-.48l-2.37-3.25a.77.77 0 0 0-.705-.296a.75.75 0 0 0-.585.306l-2.37 3.24c-.22.3-.58.48-.95.48h-4.02c-.41 0-.75.34-.75.75s.34.75.75.75h4.02c.85 0 1.66-.41 2.16-1.09l1.809-2.473l1.801 2.463c.5.69 1.31 1.1 2.16 1.1"/>
      <path fill="#aee6dd" d="M15.249 4h1.5v24h-1.5zm-2.21 16.73c.09.15.26.23.42.23c.09 0 .18-.02.24-.08a.5.5 0 0 0 .15-.69l-5.372-8.338A.494.494 0 0 0 8 11.5c-.16 0-.45.27-.45.27l-5.39 8.38c-.07.08-.11.19-.11.31c0 .28.22.5.5.5c.17 0 .33-.09.42-.23l4.53-7.034V20.8c0 .28.22.5.5.5s.5-.22.5-.5v-7.105zm16 0c.09.15.26.23.42.23c.09 0 .18-.02.24-.08a.5.5 0 0 0 .15-.69l-5.372-8.338A.494.494 0 0 0 24 11.5c-.16 0-.359.155-.45.27l-5.39 8.38c-.07.08-.11.19-.11.31c0 .28.22.5.5.5c.17 0 .33-.09.42-.23l4.53-7.034V20.8c0 .28.22.5.5.5s.5-.22.5-.5v-7.105z"/>
      <path fill="#45b0a2" d="M17.59 3.59a1.59 1.59 0 1 1-3.18 0a1.59 1.59 0 0 1 3.18 0m-8 7.41a1.59 1.59 0 1 1-3.181 0a1.59 1.59 0 0 1 3.18 0m-7.57 9.64c-.09-.32.15-.64.49-.64h10.98c.34 0 .58.32.49.64c-.74 2.56-3.13 4.36-5.98 4.36s-5.24-1.8-5.98-4.36m16 0c-.09-.32.15-.64.49-.64h10.98c.34 0 .58.32.49.64c-.74 2.56-3.13 4.36-5.98 4.36s-5.24-1.8-5.98-4.36M23.4 30c.48 0 .71-.58.36-.91A11.22 11.22 0 0 0 16 26c-3.01 0-5.74 1.17-7.76 3.09c-.35.33-.12.91.36.91zm.6-17.41a1.59 1.59 0 1 0-.001-3.18a1.59 1.59 0 0 0 0 3.18"/>
      </g>
    </svg>
  ),

  /* Curva ABC — lucro por produto — derivado do Fluent chart-increasing (MIT), matiz verde. */
  performance: (
    <svg viewBox="0 0 32 32" className="picto" aria-hidden>
      <g fill="none">
      <path fill="#b6eed0" d="M2 6a4 4 0 0 1 4-4h20a4 4 0 0 1 3.731 2.556l-.585 1.776l.854.846V26a4 4 0 0 1-4 4H6a4 4 0 0 1-3.888-3.056l.67-1.893l-.782-.71z"/>
      <path fill="#3fb37a" d="M10 11v10H2v1h8v8h1v-8h10v8h1v-8h8v-1h-8V11h8v-1h-8V2h-1v8H11V2h-1v8H2v1zm1 0h10v10H11z"/>
      <path fill="#1f7d51" d="M2.12 26.976A4 4 0 0 1 2 26v-1.701l7.062-6.973a2.2 2.2 0 0 1 3.06-.03l2.15 2.04a.5.5 0 0 0 .698-.009L29.722 4.531c.18.455.278.95.278 1.469v1.187L16.132 20.902a2.2 2.2 0 0 1-3.052.04l-2.15-2.017a.5.5 0 0 0-.694.01z"/>
      </g>
    </svg>
  ),

  /* Calculadora — preco e margem — derivado do Fluent abacus (MIT), matiz cinza. */
  calculator: (
    <svg viewBox="0 0 32 32" className="picto" aria-hidden>
      <g fill="none">
      <path fill="#e3e6ea" d="M29 8H3v1h26zm0 5H3v1h26zM3 18h26v1H3zm26 5H3v1h26z"/>
      <path fill="#9aa1a9" d="M8 2a6 6 0 0 0-6 6v16a6 6 0 0 0 6 6h16a6 6 0 0 0 6-6V8a6 6 0 0 0-6-6zm0 2h16a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4"/>
      <path fill="#5d646c" d="M6 8a1.5 1.5 0 1 1 3 0a1.5 1.5 0 1 1 3 0a1.5 1.5 0 0 1 3 0a1.5 1.5 0 0 1 3 0v1a1.5 1.5 0 0 1-3 0a1.5 1.5 0 0 1-3 0a1.5 1.5 0 0 1-3 0a1.5 1.5 0 1 1-3 0zm18.5-1.5A1.5 1.5 0 0 0 23 8v1a1.5 1.5 0 0 0 3 0V8a1.5 1.5 0 0 0-1.5-1.5"/>
      <path fill="#9aa1a9" d="M6 13a1.5 1.5 0 0 1 3 0a1.5 1.5 0 0 1 3 0a1.5 1.5 0 0 1 3 0a1.5 1.5 0 0 1 3 0v1a1.5 1.5 0 0 1-3 0a1.5 1.5 0 0 1-3 0a1.5 1.5 0 0 1-3 0a1.5 1.5 0 0 1-3 0zm18.5-1.5A1.5 1.5 0 0 0 23 13v1a1.5 1.5 0 0 0 3 0v-1a1.5 1.5 0 0 0-1.5-1.5"/>
      <path fill="#cfd3d8" d="M6 18a1.5 1.5 0 0 1 3 0a1.5 1.5 0 0 1 3 0a1.5 1.5 0 0 1 3 0a1.5 1.5 0 0 1 3 0v1a1.5 1.5 0 0 1-3 0a1.5 1.5 0 0 1-3 0a1.5 1.5 0 0 1-3 0a1.5 1.5 0 0 1-3 0zm18.5-1.5A1.5 1.5 0 0 0 23 18v1a1.5 1.5 0 0 0 3 0v-1a1.5 1.5 0 0 0-1.5-1.5"/>
      <path fill="#cfd3d8" d="M6 23a1.5 1.5 0 0 1 3 0a1.5 1.5 0 0 1 3 0a1.5 1.5 0 0 1 3 0a1.5 1.5 0 0 1 3 0v1a1.5 1.5 0 0 1-3 0a1.5 1.5 0 0 1-3 0a1.5 1.5 0 0 1-3 0a1.5 1.5 0 0 1-3 0zm18.5-1.5A1.5 1.5 0 0 0 23 23v1a1.5 1.5 0 0 0 3 0v-1a1.5 1.5 0 0 0-1.5-1.5"/>
      </g>
    </svg>
  ),

  /* Integracoes — as lojas conectadas — derivado do Fluent electric-plug (MIT), matiz laranja. */
  integrations: (
    <svg viewBox="0 0 32 32" className="picto" aria-hidden>
      <g fill="none">
      <path fill="#ffd6c2" d="M13 7.076c0 .506.453.924 1 .924s1-.418 1-.924V2.924C15 2.418 14.547 2 14 2s-1 .418-1 .924zm5 0c0 .506.453.924 1 .924s1-.418 1-.924V2.924C20 2.418 19.547 2 19 2s-1 .418-1 .924z"/>
      <path fill="#c04f1c" d="M11.06 9.935A1.5 1.5 0 0 1 10 8.5c0-.83.67-1.5 1.5-1.5h10c.83 0 1.5.67 1.5 1.5c0 .65-.412 1.203-.99 1.411v3.359A5.48 5.48 0 0 1 19 18.166v3.918c0 .507-.41.916-.916.916H18v7h-3v-7h-.084a.915.915 0 0 1-.916-.916v-3.958a5.48 5.48 0 0 1-2.94-4.856z"/>
      <path fill="#f0763c" d="M15 12h3c.27 0 .5-.23.5-.5c0-.28-.23-.5-.5-.5h-3c-.28 0-.5.23-.5.5s.23.5.5.5m0 2h3c.27 0 .5-.22.5-.5c0-.27-.23-.5-.5-.5h-3c-.28 0-.5.23-.5.5c0 .28.23.5.5.5"/>
      </g>
    </svg>
  ),

  /* Pesquisa de mercado — derivado do Fluent magnifying-glass-tilted-left (MIT), matiz azul. */
  search: (
    <svg viewBox="0 0 32 32" className="picto" aria-hidden>
      <g fill="none">
      <path fill="#4b9bf5" d="M3 13c0 5.523 4.477 10 10 10s10-4.477 10-10S18.523 3 13 3S3 7.477 3 13"/>
      <path fill="#bfdcfd" d="M18.348 7.732c.552.957.419 2.068-.299 2.482c-.717.414-1.747-.025-2.299-.982s-.418-2.068.299-2.482c.718-.414 1.747.025 2.3.982"/>
      <path fill="#1f5fbf" d="M2 13c0 6.075 4.925 11 11 11c2.295 0 4.426-.703 6.19-1.905a3.75 3.75 0 0 0 1.005 3.483l3.182 3.182a3.75 3.75 0 0 0 5.303-5.303l-3.182-3.182a3.75 3.75 0 0 0-3.454-1.012A10.95 10.95 0 0 0 24 13c0-6.075-4.925-11-11-11S2 6.925 2 13m20 0a9 9 0 1 1-18 0a9 9 0 0 1 18 0"/>
      </g>
    </svg>
  ),

  /* Historico — derivado do Fluent hourglass-not-done (MIT), matiz rosa. */
  history: (
    <svg viewBox="0 0 32 32" className="picto" aria-hidden>
      <g fill="none">
      <path fill="#e8558f" d="m25 4l-9-1l-9 1v3.5c.19 2.484 1.823 6.52 7 7.348v2.304c-5.177.829-6.81 4.864-7 7.348V28l9 1l9-1v-3.5c-.19-2.484-1.823-6.52-7-7.348v-2.304c5.177-.829 6.81-4.864 7-7.348z"/>
      <path fill="#b32a63" d="M17 22.2v-7.4c0-.5.3-.9.8-1c3.2-.7 5.6-3.3 6.1-6.6c.1-.6-.4-1.2-1-1.2H9.1c-.6 0-1.1.6-1 1.2c.5 3.3 2.9 5.9 6.1 6.6c.5.1.8.5.8 1v7.4c0 .5-.3.9-.8 1c-1.9.4-3.5 1.5-4.6 3c-.6.8 0 1.8.9 1.8h11c.9 0 1.5-1 .9-1.7c-1.1-1.5-2.8-2.6-4.6-3c-.5-.2-.8-.6-.8-1.1"/>
      <path fill="#f9a8c7" d="M7 2a1 1 0 0 0 0 2h18a1 1 0 1 0 0-2zm0 26a1 1 0 1 0 0 2h18a1 1 0 1 0 0-2z"/>
      <path fill="#fbd0e2" d="M22.007 6.117c.14 1.193-.021 2.147-.4 2.86c-.37.696-.99 1.246-1.939 1.58a1 1 0 1 0 .664 1.886c1.376-.484 2.414-1.347 3.041-2.528c.618-1.164.794-2.551.62-4.032a1 1 0 1 0-1.986.234m-3.136 12.954a1 1 0 0 0-.742 1.857c1.151.46 2.117 1.079 2.79 1.887C21.58 23.605 22 24.628 22 26a1 1 0 1 0 2 0c0-1.828-.578-3.306-1.544-4.465c-.952-1.142-2.236-1.924-3.585-2.464"/>
      </g>
    </svg>
  ),

  /* Criar anuncio — derivado do Fluent memo (MIT), matiz rosa. */
  create: (
    <svg viewBox="0 0 32 32" className="picto" aria-hidden>
      <g fill="none">
      <path fill="#e8558f" d="M20.343 2.293A1 1 0 0 0 19.636 2H7a2 2 0 0 0-2 2v24a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V9.364a1 1 0 0 0-.293-.707z"/>
      <path fill="#fbd0e2" d="M19.682 3H7a1 1 0 0 0-1 1v24a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V9.453z"/>
      <path fill="#e8558f" d="M9.5 12h13a.5.5 0 0 1 0 1h-13a.5.5 0 0 1 0-1m0 3a.5.5 0 0 0 0 1h13a.5.5 0 0 0 0-1zM9 18.5a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 0 1h-13a.5.5 0 0 1-.5-.5m.5 2.5a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1z"/>
      <path fill="#f9a8c7" d="M26 9.453h-4.61a1.707 1.707 0 0 1-1.708-1.707V3z"/>
      <path fill="#e8558f" d="m26.766 20.172l-1.08-3.231l-2.796-2.006l-10.607 7.849l1.148 3.156l2.727 2.082z"/>
      <path fill="#f9a8c7" d="m11.106 26.655l.171.893l.836.468l4.039-.006l-3.86-5.216z"/>
      <path fill="#b32a63" d="m10.687 28.018l.418-1.363l1.007 1.36z"/>
      <path fill="#b32a63" d="M26.52 12.249a2 2 0 0 1 2.798.418l1.496 2.022a2 2 0 0 1-.418 2.797l-2.058 1.524l-2.805-2.069l-1.071-3.17z"/>
      <path fill="#fbd0e2" d="m24.462 13.772l3.876 5.238l-1.572 1.162l-3.875-5.237z"/>
      </g>
    </svg>
  ),

  /* Saude da conta — derivado do Fluent beating-heart (MIT), matiz verde. */
  health: (
    <svg viewBox="0 0 32 32" className="picto" aria-hidden>
      <g fill="#3fb37a">
      <path d="M11.372 4.011c-3.845-.961-7.089.014-8.933 2.781a.527.527 0 1 1-.877-.584c2.155-3.233 5.911-4.258 10.066-3.22a.527.527 0 0 1-.256 1.023m8.926 4.123C17.87 8.557 16 11.37 16 11.37s-1.86-2.823-4.298-3.236C5.695 7.1 3.216 12.275 4.215 16.132c1.397 5.36 7.792 10.496 10.533 12.493a2.12 2.12 0 0 0 2.505 0c2.74-1.997 9.135-7.134 10.532-12.493c1-3.847-1.48-9.031-7.487-7.998"/>
      <path d="M4.917 7.777c.445-.672 1.008-1.21 1.724-1.535c.713-.324 1.615-.455 2.772-.25a.5.5 0 0 0 .174-.984c-1.323-.235-2.435-.097-3.36.324c-.922.42-1.619 1.101-2.144 1.892a.5.5 0 1 0 .834.553m15.711-3.766c3.846-.961 7.09.014 8.934 2.781a.527.527 0 0 0 .877-.584c-2.156-3.233-5.912-4.258-10.067-3.22a.527.527 0 0 0 .256 1.023"/>
      <path d="M27.084 7.777c-.446-.672-1.01-1.21-1.725-1.535c-.713-.324-1.615-.455-2.772-.25a.5.5 0 1 1-.174-.984c1.323-.235 2.436-.097 3.36.324c.922.42 1.62 1.101 2.144 1.892a.5.5 0 1 1-.834.553"/>
      </g>
    </svg>
  ),
};
