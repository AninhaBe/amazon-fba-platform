"use client";

/**
 * Sol/lua — alterna o tema DA BARRA LATERAL entre claro e escuro.
 *
 * ⚠️ É O TEMA DO MENU, NÃO DO APP. O conteúdo continua claro por
 * decisão dela ("somente light mode"); o que ganhou versão escura foi a calha de
 * navegação. Chamar isto de "modo escuro" no futuro seria prometer uma coisa que
 * o produto não faz — por isso o rótulo é "Menu claro"/"Menu escuro".
 *
 * ⚠️ LER `localStorage` NO RENDER QUEBRA A HIDRATAÇÃO. O servidor
 * não tem storage: ele renderiza o padrão, o cliente leria outro valor e o React
 * acusaria divergência. Por isso o valor guardado só entra DEPOIS de montar, no
 * mesmo padrão que `AppShell` já usa para a barra recolhida.
 *
 * O efeito colateral disso é um respingo: quem escolheu claro vê escuro por um
 * instante. Para não piscar, o atributo é escrito no `<aside>` por um script
 * mínimo antes da pintura — ver `aplicarTemaSalvo`, chamado no próprio efeito, e
 * a transição de cor desligada na primeira aplicação.
 */

import { useEffect, useState } from "react";

const CHAVE = "nexo-tema-do-menu";
type Tema = "claro" | "escuro";
const PADRAO: Tema = "escuro";

export function TemaDoMenu() {
  const [tema, setTema] = useState<Tema>(PADRAO);
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    let guardado: Tema | null = null;
    try {
      const v = localStorage.getItem(CHAVE);
      if (v === "claro" || v === "escuro") guardado = v;
    } catch {
      // Storage indisponível não impede navegar; fica o padrão.
    }
    if (guardado) setTema(guardado);
    setMontado(true);
  }, []);

  useEffect(() => {
    // O estado mora no <html>, não na barra: o dark mode vai valer para o site
    // inteiro mais adiante, e aí basta CSS novo — nenhum componente muda.
    const barra = document.documentElement;
    // Na primeira aplicação a transição fica desligada, senão o tema guardado
    // "entra animando" e vira um flash de cor a cada carregamento.
    if (!montado) barra.setAttribute("data-sem-transicao", "");
    barra.setAttribute("data-tema", tema);
    if (montado) {
      const t = window.setTimeout(() => barra.removeAttribute("data-sem-transicao"), 60);
      return () => window.clearTimeout(t);
    }
  }, [tema, montado]);

  const alternar = () => {
    const proximo: Tema = tema === "escuro" ? "claro" : "escuro";
    setTema(proximo);
    try {
      localStorage.setItem(CHAVE, proximo);
    } catch {
      // Preferência não persistida é aceitável; o clique continua valendo agora.
    }
  };

  const vaiParaClaro = tema === "escuro";
  const rotulo = vaiParaClaro ? "Deixar o menu claro" : "Deixar o menu escuro";

  return (
    <button
      type="button"
      className="tema-do-menu"
      onClick={alternar}
      aria-label={rotulo}
      title={rotulo}
      /* O estado é do BOTÃO, não só visual: leitor de tela precisa saber que
         isto é um interruptor e em que posição ele está. */
      role="switch"
      aria-checked={tema === "escuro"}
      data-tema={tema}
      /* ⚠️ SEM FUNDO, NUNCA. Existem DUAS regras globais que pintam
         o fundo de qualquer <button> no hover: uma da barra de topo
         (`.app-topbar-actions button:hover`) e uma do app inteiro
         (`button:not(:disabled)…:hover`, especificidade 0-4-1). As duas faziam
         aparecer um retangulo atras do interruptor.

         Estilo inline resolve porque vence QUALQUER regra sem `!important` —
         e aqui e o certo: este botao nao tem superficie propria, a superficie
         dele e o trilho. Combater especificidade com seletor mais longo so
         adiaria o problema ate a proxima regra global. */
      style={{ background: "none" }}
    >
      {/* ⚠️ O TRILHO TAMBEM E ESTADO, nao so a bola: pedido dela em
          09/09/2026. Com o trilho sempre claro, o controle dizia "modo escuro"
          apenas pela bolinha; agora a peca INTEIRA mostra em que modo voce esta,
          mesmo estando numa barra de topo clara. Inline pelo mesmo motivo da
          bola — e estado, e estado nao depende de ordem de folha de estilo. */}
      <span
        className="tema-do-menu-trilho"
        aria-hidden
        style={{
          background: tema === "escuro" ? "#17161c" : "#e9e8e4",
          borderColor: tema === "escuro" ? "#3a3844" : "#d5d3cd",
        }}
      >
        {/* O apagado é o destino do clique; a bola mostra onde você está. */}
        <span
          className="tema-do-menu-apagado"
          style={{ color: tema === "escuro" ? "#7c7a88" : "#a3a099" }}
        >
          {tema === "escuro" ? <Sol /> : <Lua />}
        </span>
        {/* ⚠️ COR E POSICAO DA BOLA VEM DO ESTADO, nao do CSS. Foram
            duas rodadas com a bola presa na cor errada por briga de cascata com
            regra antiga que o dev server insistia em servir. Isto e ESTADO do
            componente — inline aqui e deterministico e nao depende de ordem de
            folha de estilo. O resto da aparencia continua no CSS. */}
        <span
          className="tema-do-menu-bola"
          style={{
            background: tema === "escuro" ? "#2f2b52" : "#f0a91c",
            translate: tema === "escuro" ? "22px 0" : "0px 0",
          }}
        >
          {tema === "escuro" ? <Lua /> : <Sol />}
        </span>
      </span>
    </button>
  );
}

function Sol() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="3.2" fill="currentColor" />
      <path
        d="M8 1.4v1.8M8 12.8v1.8M14.6 8h-1.8M3.2 8H1.4M12.67 3.33l-1.27 1.27M4.6 11.4l-1.27 1.27M12.67 12.67 11.4 11.4M4.6 4.6 3.33 3.33"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function Lua() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M13.6 9.9A6 6 0 0 1 6.1 2.4a6.1 6.1 0 1 0 7.5 7.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
