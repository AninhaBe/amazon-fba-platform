"use client";

import { useEffect, useState } from "react";

import { buscaCompartilhada } from "./buscaCompartilhada";
import type { WorkspaceId } from "@/lib/integrations/workspaces";

/**
 * Quais canais este workspace TEM conectados — para o seletor listar só eles.
 *
 * Pedido da dona do produto em 12/09/2026: *"só vai aparecer as integrações no
 * menu que a pessoa esteja conectada (para os admins aparecem todas)"*.
 *
 * ⚠️ A FONTE E `/api/integrations`, QUE JA EXISTE, e isso não é
 * economia de código: essa rota é a única que sabe as três formas de conexão
 * deste produto (conta Amazon em `workspace_accounts`, integração genérica do
 * ML/Shopee, loja do TikTok) e ela responde SEMPRE escopada pela sessão
 * (`withAuthenticatedWorkspace`). Uma segunda leitura própria daqui seria uma
 * segunda verdade sobre "o que está conectado" — e é assim que uma fica para
 * trás sem ninguém notar.
 *
 * ⚠️ TRES ESTADOS, NAO DOIS, e cada um tem resposta diferente na
 * tela. Colapsá-los foi a primeira tentação e daria defeito nas duas pontas:
 *
 *   `null` (ainda não sei) — o seletor mostra a central e o canal atual, e mais
 *     nada. Nunca a lista cheia: mostrar os quatro e depois cortar faria piscar
 *     na tela exatamente o que ela pediu para esconder. É a mesma disciplina do
 *     `useEhAdmin`, que só libera o link DEPOIS que o servidor confirma.
 *   `Set` (sei) — filtra.
 *   `"indisponivel"` (a rota falhou) — mostra os quatro, que é o comportamento
 *     de HOJE. Um 500 passageiro não pode fazer os canais da pessoa
 *     desaparecerem do menu; degradar para o que já existia é degradar para
 *     algo conhecido, não para uma tela quebrada.
 */
export type CanaisConectados = ReadonlySet<WorkspaceId> | null | "indisponivel";

/**
 * O que a resposta de `/api/integrations` diz sobre canais CONECTADOS.
 *
 * ⚠️ A FRONTEIRA E `connections.length`, NAO A PRESENCA DO
 * PROVEDOR. A rota devolve os quatro provedores SEMPRE — conectados ou não —,
 * cada um com a sua lista de conexões. Ler `providers.map(id)` daria "os quatro
 * estão conectados" em todo workspace, e o filtro inteiro viraria enfeite sem
 * nada ficar vermelho: a tela continuaria mostrando os quatro, que é o estado
 * que ela pediu para mudar.
 */
export function canaisDoCorpo(corpo: { providers?: Array<{ id: string; connections?: unknown[] }> }): ReadonlySet<WorkspaceId> {
  const conectados = (corpo.providers ?? [])
    .filter((provedor) => (provedor.connections?.length ?? 0) > 0)
    .map((provedor) => provedor.id as WorkspaceId);
  return new Set(conectados);
}

/**
 * Resultado guardado no módulo: uma consulta por CARGA DE PÁGINA, não por tela.
 *
 * ⚠️ E ISSO BASTA PORQUE CONECTAR RECARREGA A PAGINA. Medido em
 * 12/09/2026: os quatro canais conectam por redirect de OAuth
 * (`/api/auth/login`, `/api/integrations/mercado-livre/connect`,
 * `/api/tiktok/login`, `/api/integrations/shopee/connect`) e voltam em
 * `/integracoes?connected=...` — carga nova, módulo novo, menu já com o canal
 * novo. Quem muda conexão SEM recarregar é a tela de Integrações ao
 * desconectar, e é ela que chama `esquecerCanaisConectados()`.
 */
let conhecidos: CanaisConectados = null;

/**
 * Quem está com o seletor na tela agora.
 *
 * ⚠️ SO O CACHE NAO BASTAVA, e o furo era estreito mas real: a
 * sidebar NAO desmonta na navegação entre telas do app. Zerar a variável do
 * módulo faria efeito na próxima montagem — que, para quem desconectou um canal
 * e continuou navegando, só acontece no próximo carregamento inteiro. Até lá o
 * menu seguiria oferecendo um canal que a pessoa acabou de remover.
 */
const ouvintes = new Set<() => void>();

/** A tela de Integrações chama isto quando a lista de conexões muda. */
export function esquecerCanaisConectados() {
  conhecidos = null;
  for (const avisar of [...ouvintes]) avisar();
}

export function useCanaisConectados(): CanaisConectados {
  const [canais, setCanais] = useState<CanaisConectados>(conhecidos);

  useEffect(() => {
    let vivo = true;
    const perguntar = () => {
      if (conhecidos !== null) return;
      buscaCompartilhada<CanaisConectados>("integrations/conectados", () =>
        fetch("/api/integrations", { cache: "no-store" })
          .then((resposta) => (resposta.ok ? resposta.json() : Promise.reject(new Error("sem resposta"))))
          .then(canaisDoCorpo),
      )
        .catch((): CanaisConectados => "indisponivel")
        .then((resultado) => {
          conhecidos = resultado;
          if (vivo) setCanais(resultado);
        });
    };
    perguntar();
    const aoEsquecer = () => {
      if (!vivo) return;
      setCanais(null);
      perguntar();
    };
    ouvintes.add(aoEsquecer);
    return () => {
      vivo = false;
      ouvintes.delete(aoEsquecer);
    };
  }, []);

  return canais;
}

/**
 * A regra de listagem, num lugar só — as duas telas que têm o seletor (a
 * sidebar do desktop e a tira do mobile) chamam esta função.
 *
 * ⚠️ DUAS COPIAS DESTA CONDICAO ERA O RISCO OBVIO: o menu do
 * desktop e o do celular são componentes diferentes, e a regra ("conectado, ou
 * admin, ou é onde eu estou") tem quatro ramos. Duplicada, ela divergiria no
 * primeiro ajuste — e o defeito apareceria só num dos dois tamanhos de tela,
 * que é o tipo de coisa que ninguém vê até um cliente ver.
 *
 * `atual` entra sempre: a pessoa está OLHANDO aquele canal, e um seletor que
 * não lista onde você está perde o destaque do item corrente e mente sobre onde
 * você pode voltar. Inclusive quando a conexão daquele canal acabou de sair.
 */
export function canalEntraNoSeletor(
  canal: WorkspaceId,
  { canais, ehAdmin, atual }: { canais: CanaisConectados; ehAdmin: boolean; atual: WorkspaceId },
): boolean {
  if (canal === "overview") return true;
  if (ehAdmin) return true;
  if (canal === atual) return true;
  if (canais === "indisponivel") return true;
  if (canais === null) return false;
  return canais.has(canal);
}
