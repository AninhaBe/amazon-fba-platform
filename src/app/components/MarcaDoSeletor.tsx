"use client";

/**
 * A marca dentro do seletor de canal, que se transforma: **NEXO → NX → a seta**.
 *
 * ⚠️ EU ACONSELHEI CONTRA E ELA MANTEVE — decisão dela em
 * 09/09/2026, reafirmada depois do meu parecer. Fica registrado o parecer, para
 * quem mexer aqui saber o que já foi pesado:
 *
 *   • o mesmo controle passa a ter aparências diferentes em momentos
 *     diferentes, e quem volta depois de um tempo encontra um controle mais
 *     curto do que o que viu;
 *   • o nome do produto já é ensinado pelo login, pelo título da aba e pelo
 *     domínio.
 *
 * Nada disso é impeditivo, e o efeito tem uma vantagem real que o meu parecer
 * subestimou: o estado de repouso é **só a seta**, que é o que devolve mais
 * espaço ao nome do canal — 116px contra os 81px de "seta + NEXO" escrito, que
 * cortavam "Todos os canais" em −10px (medido em 09/09/2026).
 *
 * ⚠️ A SETA NÃO EXISTE ANTES DO ÚLTIMO QUADRO. A primeira versão
 * deixava o ícone ao lado do texto o tempo todo e animava só a largura — não
 * era transformação nenhuma, era um texto encolhendo ao lado de um ícone
 * parado. Verbatim dela: *"o icone ficou ali o tempo todo"*. Os três quadros
 * dividem UM slot (grid, todos em `1 / 1`), e a seta é a forma final da marca.
 *
 * ## As três decisões que este arquivo toma, e o porquê de cada uma
 *
 * **1 · Começa em "NEXO" no servidor, não no estado final.** Ler storage no
 * render quebraria a hidratação (o servidor não tem storage), então o passo só
 * pode mudar DEPOIS de montar. Se o padrão fosse "só o ícone", quem vê a
 * entrada veria a marca ABRIR antes de fechar — parece defeito. Começando
 * aberta, quem já viu vê um quadro de NEXO e o resto colapsa: mesma direção do
 * efeito, então lê como uma versão rápida dele, não como um salto.
 *
 * **2 · A cada carregamento da página, sem estado guardado.** Já foi uma vez
 * por sessão, e o efeito virou invisível para quem precisava revisá-lo — a
 * primeira carga gastava a única exibição. Sem gate, o que limita a repetição é
 * a ÁRVORE, não um contador: este componente vive no layout do grupo `(app)`,
 * que não remonta ao trocar de rota. Toca ao abrir ou recarregar o app; fica
 * quieto enquanto ela navega.
 *
 * **3 · `prefers-reduced-motion` pula direto para o repouso.** Não é enfeite: o
 * sistema operacional já respondeu essa pergunta por quem tem enxaqueca ou
 * distúrbio vestibular, e ignorar a resposta é escolher por essa pessoa.
 */

import { useEffect, useState } from "react";
import { MarcaMorfismo } from "./MarcaMorfismo";
import { NexoSymbol } from "./NexoSymbol";

/** Quanto cada quadro dura. O total é curto de propósito: é uma assinatura de
 *  abertura, não uma animação que faz esperar para clicar. */
const ATE_NX = 900;
/** Quando o NX comeca a VIRAR a seta. */
const ATE_MORFISMO = 1600;
/**
 * Quando o morfismo acaba e a marca de verdade assume.
 *
 * ⚠️ TEM DE CASAR COM A DURACAO DA ANIMACAO no CSS (560ms nas
 * hastes e no corpo). Se este numero encurtar, a troca acontece no meio do
 * trajeto e a seta SALTA — o corte que este efeito inteiro existe para nao ter.
 */
const ATE_ICONE = ATE_MORFISMO + 560;

type Passo = "nexo" | "nx" | "morfismo" | "so-icone";

/**
 * A largura da caixa em cada quadro.
 *
 * ⚠️ VEM DO ESTADO, INLINE, e nao de `[data-passo]` no CSS. Medido
 * tres vezes em 09/09/2026: a regra de atributo simplesmente nao alcancava este
 * elemento no dev server — um CLONE identico, no mesmo pai, recebia os 18px, e
 * o no do React ficava nos 36px, comendo os pixels que este efeito existe para
 * devolver ao nome do canal. Largura e ESTADO do componente; estado inline e
 * deterministico e nao depende de ordem de folha nem de recompilacao.
 */
/**
 * ⚠️ O TAMANHO DA MARCA MORA AQUI E EM `.nexo-marca-morf` NO CSS —
 * os dois PRECISAM casar. O morfismo desenha a seta em SVG e o repouso mostra o
 * arquivo da marca; se um crescer sem o outro, a seta muda de tamanho no
 * instante em que o efeito termina, que e o salto que este efeito inteiro
 * existe para nao ter.
 */
export const TAMANHO_DA_MARCA = 22;

const LARGURA: Record<Passo, number> = {
  nexo: 36,
  nx: 22,
  morfismo: TAMANHO_DA_MARCA,
  "so-icone": TAMANHO_DA_MARCA,
};

export function MarcaDoSeletor() {
  const [passo, setPasso] = useState<Passo>("nexo");
  /** Desliga a transição no colapso instantâneo de quem já viu a entrada. */
  const [semTransicao, setSemTransicao] = useState(false);

  useEffect(() => {
    /**
     * ⚠️ NAO HA MAIS GATE DE "JA VIU". A versao anterior tocava uma
     * vez por SESSAO, guardado em `sessionStorage`, e o resultado pratico foi
     * que ela nao conseguia rever o efeito: a primeira carga gastou a unica
     * exibicao e toda navegacao seguinte ia direto para a seta. Verbatim,
     * 09/09/2026: *"mas cade os efeitos? so aparece a seta aqui"*.
     *
     * Sem gate, tambem some a objecao que eu mesmo tinha levantado contra o
     * efeito — a de depender de estado por dispositivo que pode falhar.
     *
     * ⚠️ E ISSO NAO O TORNA REPETITIVO. Este componente vive no
     * layout do grupo `(app)`, que NAO remonta ao trocar de rota: o efeito toca
     * quando ela abre ou recarrega o app, e fica quieto enquanto ela navega
     * entre canais e paginas. Mover a marca para fora desse layout mudaria
     * isso sem ninguem perceber.
     */
    const querMenosMovimento =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (querMenosMovimento) {
      // O sistema operacional ja respondeu essa pergunta por quem tem enxaqueca
      // ou disturbio vestibular; ignorar a resposta e escolher por essa pessoa.
      setSemTransicao(true);
      setPasso("so-icone");
      const solta = window.setTimeout(() => setSemTransicao(false), 60);
      return () => window.clearTimeout(solta);
    }

    const paraNx = window.setTimeout(() => setPasso("nx"), ATE_NX);
    const paraMorfismo = window.setTimeout(() => setPasso("morfismo"), ATE_MORFISMO);
    const paraIcone = window.setTimeout(() => setPasso("so-icone"), ATE_ICONE);
    return () => {
      window.clearTimeout(paraNx);
      window.clearTimeout(paraMorfismo);
      window.clearTimeout(paraIcone);
    };
  }, []);

  return (
    <span
      className="nexo-switcher-marca"
      data-passo={passo}
      data-sem-transicao={semTransicao ? "" : undefined}
      /* ⚠️ ALTURA INLINE PELO MESMO MOTIVO DA LARGURA: a folha
         servida ficou para tras nesta sessao quatro vezes, e a caixa continuou
         com 18px de altura enquanto a marca ja media 22 — a seta sobrava para
         fora. Tamanho da marca e estado; estado inline nao depende de
         recompilacao. */
      style={{ width: LARGURA[passo], height: TAMANHO_DA_MARCA }}
    >
      {/* ⚠️ `key={passo}` REMONTA O TEXTO A CADA TROCA, e é o que faz
          a animação de entrada TOCAR DE NOVO no NEXO → NX. Sem a chave o React
          reaproveita o nó, a animação não reinicia, e a troca vira corte seco. */}
      {passo === "nexo" || passo === "nx" ? (
        <span key={passo} className="nexo-switcher-marca-txt" aria-hidden>
          {passo === "nexo" ? "NEXO" : "NX"}
        </span>
      ) : null}

      {/* ⚠️ O QUADRO EM QUE O NX VIRA A SETA. Ele monta EXATAMENTE
          onde o texto "NX" estava e comeca desenhando o mesmo X — por isso a
          troca do texto pelo SVG nao se ve. Se o desenho de partida deixar de
          coincidir com a letra, volta a haver um corte no meio do efeito. */}
      {passo === "morfismo" ? <MarcaMorfismo /> : null}
      {/* ⚠️ `aria-hidden` porque isto é DECORAÇÃO DE MARCA, não o
          nome do controle. Quem usa leitor de tela ouviria "NEXO", depois "NX",
          depois nada, sem que nada tenha mudado de função. O nome acessível do
          botão está no `aria-label` dele, e diz o que ele faz. */}
      {/* ⚠️ A SETA SO EXISTE NO ULTIMO QUADRO, e isso não é
          detalhe de estilo — é o que tira a visibilidade dela da mão de uma
          TRANSIÇÃO. Medido em 09/09/2026: com o ícone sempre montado e a
          opacidade indo de 0 a 1 por `transition`, o valor computado ficava
          preso em 0 sem nenhuma animação em curso (`getAnimations()` vazio), e
          só voltava ao normal com `transition: none`. Montando no passo, ele
          entra por `animation` — que toca na montagem e não depende de o
          navegador ter registrado um estado anterior. */}
      {passo === "so-icone" ? <NexoSymbol size={TAMANHO_DA_MARCA} className="nexo-switcher-marca-icone" /> : null}
    </span>
  );
}
