"use client";

import { useEffect, useState } from "react";

import {
  CICLO_ESPERADO_MIN,
  formatarDefasagem,
  piorSaturacao,
  saturacaoDoSync,
  type ProviderComCiclo,
} from "@/lib/saturacaoDoSync";

type Conexao = { connectionId: string; coveredFrom: string | null; lastSuccessAt: string | null };

/**
 * "Sincronizado há X min" nos quatro monitores (Monitor Unificado, E0).
 *
 * Autossuficiente de propósito: busca a própria rota (/api/sync-estado) e
 * decide com a régua de `saturacaoDoSync`, então entrar num monitor novo é uma
 * linha — nenhum payload de canal precisou mudar. Falha da rota = silêncio: o
 * estado do sync é acessório e nunca derruba nem polui o monitor.
 *
 * Primeira sincronização também é silêncio (regra travada por teste na régua).
 */
export function EstadoDoSync({ provider, connectionId }: { provider: ProviderComCiclo; connectionId?: string }) {
  const [conexoes, setConexoes] = useState<Conexao[] | null>(null);
  // O relógio ancora no fetch e avança por interval — nada de Date.now() no
  // render (react-hooks/purity), mesmo padrão do TikTokWorkspace.
  const [agoraMs, setAgoraMs] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    const query = new URLSearchParams({ provider });
    if (connectionId) query.set("connection_id", connectionId);
    fetch(`/api/sync-estado?${query}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!live || !body) return;
        setConexoes(Array.isArray(body.conexoes) ? body.conexoes : []);
        setAgoraMs(Date.now());
      })
      .catch(() => {
        /* silêncio: acessório nunca derruba o monitor */
      });
    const tique = setInterval(() => setAgoraMs((atual) => (atual == null ? atual : Date.now())), 60_000);
    return () => {
      live = false;
      clearInterval(tique);
    };
  }, [provider, connectionId]);

  if (!conexoes?.length || agoraMs == null) return null;
  const cicloEsperadoMin = CICLO_ESPERADO_MIN[provider];
  const estado = piorSaturacao(
    conexoes.map((conexao) =>
      saturacaoDoSync({
        coveredFrom: conexao.coveredFrom,
        lastSuccessAt: conexao.lastSuccessAt,
        cicloEsperadoMin,
        agoraMs,
      })
    )
  );
  if (estado.estado === "silencio") return null;
  if (estado.estado === "atrasado") {
    return (
      <aside role="status" className="channel-module-notice is-warning estado-do-sync-alerta">
        <strong>Sincronização atrasada</strong>
        <p>
          Última sincronização há {formatarDefasagem(estado.minutosAtras)} — o ciclo esperado deste canal é ~
          {estado.cicloEsperadoMin} min. Os números abaixo podem estar defasados.
        </p>
      </aside>
    );
  }
  return (
    <p className="estado-do-sync" role="status">
      Sincronizado há <strong>{formatarDefasagem(estado.minutosAtras)}</strong>.
    </p>
  );
}
