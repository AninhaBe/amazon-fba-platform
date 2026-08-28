"use client";

import type { FiltroDeAtividade as Valor } from "@/lib/integrations/filtroDeAtividade";

/**
 * Seletor de atividade do catálogo, compartilhado pelos canais.
 *
 * O padrão da tela é **só os ativos** — medido em 28/08/2026 na loja real: 265
 * de 372 anúncios da Shopee estão pausados ou encerrados, e no Mercado Livre são
 * 367 inativos para 26 ativos. A pessoa abria a página para cadastrar custo e
 * dava de cara com centenas de anúncios que ela não quer tocar.
 *
 * ⚠️ Inativo não é removido, é despriorizado: o seletor continua oferecendo
 * "todos" e "só inativos", e o aviso abaixo diz quantos ficaram de fora e leva a
 * eles num clique. Esconder em silêncio seria remover informação.
 */
export function FiltroDeAtividade({ atual, onChange }: {
  atual?: Valor;
  onChange: (valor: Valor) => void;
}) {
  return (
    <label className="listing-search">
      <span className="sr-only">Anúncios exibidos</span>
      <select value={atual ?? "ativos"} onChange={(event) => onChange(event.target.value as Valor)}>
        <option value="ativos">Só ativos</option>
        <option value="todos">Todos</option>
        <option value="inativos">Só inativos</option>
      </select>
    </label>
  );
}

/**
 * Diz quantos anúncios o filtro deixou de fora, com o caminho para vê-los.
 *
 * Zero oculto não vira frase: afirmar "0 anúncios ocultos" é ruído. E o texto
 * aponta o que fazer ("ver todos"), em vez de se desculpar pelo recorte.
 */
export function AvisoDeOcultos({ ocultados, atividade, verTodos }: {
  ocultados?: number;
  atividade?: Valor;
  verTodos: () => void;
}) {
  if (!ocultados || ocultados <= 0 || atividade === "todos") return null;
  const plural = ocultados === 1 ? "anúncio inativo" : "anúncios inativos";
  return (
    <p className="channel-module-method" role="status">
      {ocultados} {plural} fora desta lista.{" "}
      <button type="button" className="link-button" onClick={verTodos}>Ver todos</button>
    </p>
  );
}
