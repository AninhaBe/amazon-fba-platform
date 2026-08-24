"use client";

import { useEffect, useState } from "react";
import { NexoMensagem } from "./NexoMensagem";
import { readJson } from "../../lib/readJson";

/**
 * A leitura do NEXO do dia, exibida nos dashboards de canal.
 *
 * É o MESMO texto da Visão geral e do Briefing — mesma chamada, mesma narração
 * diária por workspace. Não gera nada: usa o caminho rápido (`GET`) que devolve
 * o que já foi escrito hoje.
 *
 * ⚠️ Por que só GET, e por que não fica "carregando":
 *
 * Gerar leva ~18s (o modelo escreve na hora). Um shimmer de 18 segundos não
 * resolve nada — ela apontou isso em 24/08/2026: *"como ela vai saber que algo
 * vai aparecer? ela vai ficar navegando em outras telas"*. Então a regra aqui é
 * simples: **se o texto existe, aparece na hora; se não existe, não aparece
 * nada.** Nenhuma tela de canal fica esperando modelo.
 *
 * Quem gera continua sendo a Visão geral e o Briefing, no POST. O dia em que a
 * geração for para o cron, esta tela passa a ter texto sempre — sem mudar uma
 * linha aqui.
 */
export function NexoDoDia({ ctaHref = "/briefing" }: { ctaHref?: string }) {
  const [texto, setTexto] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/central/briefing?modo=resumo", { cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? readJson(r) : null))
      .then((d) => {
        const t = (d as { texto?: string | null } | null)?.texto;
        if (typeof t === "string" && t.trim()) setTexto(t);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // Sem texto pronto, o bloco não existe — e isso é diferente do "some da tela"
  // que já foi bug: aqui nunca houve promessa de que algo apareceria.
  if (!texto) return null;
  return <NexoMensagem texto={texto} ctaHref={ctaHref} />;
}
