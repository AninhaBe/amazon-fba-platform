"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Seletor do NEXO — o `<select>` nativo trocado por um botão e uma lista nossa.
 *
 * ⚠️ EXISTE PORQUE A LISTA NATIVA NÃO SE ESTILIZA. Pedido dela
 * em 10/09/2026, com print da lista aberta: *"melhora aqui também, tá muito
 * simples"*. A caixa que o Chrome desenha ao abrir um `<select>` é do sistema
 * operacional: a faixa azul da opção sob o cursor, a fonte, o espaçamento e o
 * raio de canto não respondem a CSS nenhum. Não dava para "melhorar" o nativo —
 * ou ele fica como o Windows manda, ou vira componente.
 *
 * ⚠️ O QUE ISSO CUSTA, para quem for reverter saber: o nativo
 * traz de graça três coisas que aqui são código nosso e podem quebrar — a
 * navegação por teclado, o anúncio correto no leitor de tela, e a busca por
 * digitação (teclar "m" pula para a primeira opção com "m"). As duas primeiras
 * estão implementadas abaixo e têm teste; **a busca por digitação NÃO está** —
 * é a única perda real em relação ao nativo, e some quando a lista é curta como
 * as duas desta tela (4 e 5 itens).
 *
 * ⚠️ AS OPÇÕES SÃO PRETAS, e isso foi decidido olhando. A
 * primeira versão pintava "Margem positiva" de verde e "Margem negativa" de
 * vermelho — a mesma cor das margens na tabela, e o argumento era que ler a cor
 * é mais rápido que ler a palavra. Ela viu e decidiu o contrário, em
 * 10/09/2026: *"pode deixar a cor preta mesmo"*.
 *
 * O `tom` foi removido junto, e não deixado sem uso: opção de componente que
 * ninguém passa é código que ninguém exercita, e o primeiro a mexer nela vai
 * achar que é suportada. Se a cor voltar a fazer sentido, ela volta como
 * propriedade nova, com o caso de uso na mão.
 */

export interface OpcaoDoSeletor {
  valor: string;
  rotulo: string;
}

export function SeletorNexo({
  valor,
  opcoes,
  aoEscolher,
  rotuloAcessivel,
}: {
  valor: string;
  opcoes: readonly OpcaoDoSeletor[];
  aoEscolher: (valor: string) => void;
  rotuloAcessivel: string;
}) {
  const [aberto, setAberto] = useState(false);
  /**
   * ⚠️ O FOCO DA LISTA É ESTADO PRÓPRIO, separado do valor
   * escolhido: quem navega de seta precisa passear pelas opções sem que a tela
   * atrás mude a cada tecla. O valor só muda no Enter ou no clique — que é o
   * que o `<select>` do Windows também faz.
   */
  const [focada, setFocada] = useState(0);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);
  const id = useId();

  const indiceAtual = Math.max(0, opcoes.findIndex((o) => o.valor === valor));
  const escolhida = opcoes[indiceAtual] ?? opcoes[0];

  useEffect(() => {
    if (!aberto) return;
    setFocada(indiceAtual);
    // O foco vai para a lista para que as setas cheguem no `onKeyDown` dela, e
    // não continuem rolando a página.
    const t = window.setTimeout(() => listaRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [aberto, indiceAtual]);

  useEffect(() => {
    if (!aberto) return;
    const foraDaqui = (evento: MouseEvent) => {
      const alvo = evento.target as Node;
      if (botaoRef.current?.contains(alvo) || listaRef.current?.contains(alvo)) return;
      setAberto(false);
    };
    document.addEventListener("mousedown", foraDaqui);
    return () => document.removeEventListener("mousedown", foraDaqui);
  }, [aberto]);

  const fecharEVoltarOFoco = () => {
    setAberto(false);
    botaoRef.current?.focus();
  };

  const escolher = (indice: number) => {
    const opcao = opcoes[indice];
    if (opcao) aoEscolher(opcao.valor);
    fecharEVoltarOFoco();
  };

  const teclasDaLista = (evento: React.KeyboardEvent) => {
    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      const passo = evento.key === "ArrowDown" ? 1 : -1;
      setFocada((atual) => (atual + passo + opcoes.length) % opcoes.length);
      return;
    }
    if (evento.key === "Home" || evento.key === "End") {
      evento.preventDefault();
      setFocada(evento.key === "Home" ? 0 : opcoes.length - 1);
      return;
    }
    if (evento.key === "Enter" || evento.key === " ") {
      evento.preventDefault();
      escolher(focada);
      return;
    }
    if (evento.key === "Escape" || evento.key === "Tab") {
      // Esc devolve o foco ao botão; Tab deixa o navegador seguir o caminho
      // normal, mas com a lista já fechada.
      if (evento.key === "Escape") evento.preventDefault();
      fecharEVoltarOFoco();
    }
  };

  const teclasDoBotao = (evento: React.KeyboardEvent) => {
    if (evento.key === "ArrowDown" || evento.key === "Enter" || evento.key === " ") {
      evento.preventDefault();
      setAberto(true);
    }
  };

  return (
    <div className="v3-seletor">
      <button
        ref={botaoRef}
        type="button"
        className={`v3-seletor-botao${aberto ? " is-aberto" : ""}`}
        role="combobox"
        aria-expanded={aberto}
        aria-haspopup="listbox"
        aria-controls={`${id}-lista`}
        aria-label={rotuloAcessivel}
        onClick={() => setAberto((v) => !v)}
        onKeyDown={teclasDoBotao}
      >
        <span className="v3-seletor-rotulo">{escolhida?.rotulo ?? ""}</span>
        <svg className="v3-seletor-seta" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path
            d="M8.67171 5.25C9.66052 5.25031 10.2007 6.40372 9.56777 7.16351L7.8964 9.1693C7.43003 9.72866 6.57066 9.72854 6.10423 9.1693L4.43286 7.16351C3.79969 6.40366 4.33991 5.25012 5.32894 5.25H8.67171Z"
            fill="currentColor"
          />
        </svg>
      </button>

      {aberto && (
        <ul
          ref={listaRef}
          id={`${id}-lista`}
          className="v3-seletor-lista"
          role="listbox"
          aria-label={rotuloAcessivel}
          aria-activedescendant={`${id}-opcao-${focada}`}
          tabIndex={-1}
          onKeyDown={teclasDaLista}
        >
          {opcoes.map((opcao, indice) => (
            <li
              key={opcao.valor}
              id={`${id}-opcao-${indice}`}
              role="option"
              aria-selected={opcao.valor === valor}
              className={
                "v3-seletor-opcao"
                + (indice === focada ? " is-focada" : "")
                + (opcao.valor === valor ? " is-escolhida" : "")
              }
              onMouseEnter={() => setFocada(indice)}
              onClick={() => escolher(indice)}
            >
              <span>{opcao.rotulo}</span>
              {opcao.valor === valor && (
                <svg viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path
                    d="M2.9 7.4 5.6 10.1 11.1 4.2"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
