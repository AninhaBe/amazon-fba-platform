"use client";

import { useEffect, useState } from "react";
import { PageHeader, pageIcons } from "../../components/PageHeader";
import { PanelLoading } from "../../components/LoadingState";

// Tela de administração — a única do produto que lê entre workspaces.
// Ver docs/adr/ADR-024-tela-de-administracao.md.
//
// 📌 Deliberadamente simples. Hoje o banco tem 4 workspaces (duas contas reais,
// uma de demonstração e uma sem integração); investir em gráfico e aba para
// quatro linhas é trabalho que se refaz quando houver cliente de verdade.
//
// ⚠️ Só AGREGADO. Nenhum número aqui pode vir acompanhado de nome ou e-mail de
// vendedor — regra do ADR, e a que mais importa manter quando alguém adicionar
// uma coluna nova aqui daqui a três meses.

const NOME_CANAL: Record<string, string> = {
  amazon: "Amazon",
  mercado_livre: "Mercado Livre",
  shopee: "Shopee",
  tiktok_shop: "TikTok Shop",
};

interface Metricas {
  canais: Array<{ canal: string; conexoes: number; comErro: number; workspaces: number; frescorMin: number | null }>;
  volume: Array<{ canal: string; pedidos30d: number; workspacesComVenda: number }>;
  adocao: { workspacesTotal: number; comAlgumaIntegracao: number; comCustoCadastrado: number; comWatchlist: number };
  geradoEm: string;
}

function frescor(min: number | null): string {
  if (min == null) return "nunca sincronizou";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `há ${h}h` : `há ${Math.floor(h / 24)}d`;
}

export default function AdminPage() {
  const [dados, setDados] = useState<Metricas | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/metricas")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? "Não encontrado." : "Falha ao carregar."))))
      .then(setDados)
      .catch((e: Error) => setErro(e.message));
  }, []);

  if (erro) return <div className="dashboard-sections"><p className="text-sm text-[var(--ink-muted)]">{erro}</p></div>;
  if (!dados) return <PanelLoading label="Carregando métricas" />;

  const totalPedidos = dados.volume.reduce((s, v) => s + v.pedidos30d, 0);

  return (
    <div className="dashboard-sections">
      <PageHeader
        eyebrow="Uso do NEXO"
        title="Administração"
        icon={pageIcons.chart}
        subtitle="Retrato agregado de todas as contas. Nenhum dado identificável de vendedor."
      />

      <section className="listing-summary-band is-4" aria-label="Adoção">
        <div><span>Workspaces</span><strong>{dados.adocao.workspacesTotal}</strong><small>com sincronização</small></div>
        <div><span>Com integração ativa</span><strong>{dados.adocao.comAlgumaIntegracao}</strong><small>ao menos um canal</small></div>
        <div><span>Com custo cadastrado</span><strong>{dados.adocao.comCustoCadastrado}</strong><small>já lançaram custo</small></div>
        <div><span>Com watchlist</span><strong>{dados.adocao.comWatchlist}</strong><small>acompanham posição</small></div>
      </section>

      <section className="listing-table-shell" aria-labelledby="admin-canais">
        <header><div><p className="section-kicker">Integrações</p><h2 id="admin-canais">Conexões por canal</h2></div></header>
        <div className="overflow-x-auto">
          <table className="listing-table">
            <thead><tr><th>Canal</th><th>Conexões</th><th>Workspaces</th><th>Com erro</th><th>Sync mais recente</th></tr></thead>
            <tbody>
              {dados.canais.map((c) => (
                <tr key={c.canal}>
                  <td><strong>{NOME_CANAL[c.canal] ?? c.canal}</strong></td>
                  <td className="tabular-nums">{c.conexoes}</td>
                  <td className="tabular-nums">{c.workspaces}</td>
                  <td className={`tabular-nums ${c.comErro > 0 ? "text-red-600 font-semibold" : ""}`}>{c.comErro}</td>
                  <td className="text-[var(--ink-muted)]">{frescor(c.frescorMin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="listing-table-shell" aria-labelledby="admin-volume">
        <header>
          <div><p className="section-kicker">Últimos 30 dias</p><h2 id="admin-volume">Volume por canal</h2></div>
          <p>{totalPedidos.toLocaleString("pt-BR")} pedidos</p>
        </header>
        <div className="overflow-x-auto">
          <table className="listing-table">
            <thead><tr><th>Canal</th><th>Pedidos</th><th>Participação</th><th>Workspaces com venda</th></tr></thead>
            <tbody>
              {dados.volume.map((v) => (
                <tr key={v.canal}>
                  <td><strong>{NOME_CANAL[v.canal] ?? v.canal}</strong></td>
                  <td className="tabular-nums">{v.pedidos30d.toLocaleString("pt-BR")}</td>
                  <td className="tabular-nums">{totalPedidos > 0 ? `${((v.pedidos30d / totalPedidos) * 100).toFixed(1)}%` : "—"}</td>
                  <td className="tabular-nums">{v.workspacesComVenda}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-[var(--ink-muted)]">
        Contas de demonstração ficam de fora de toda contagem. Gerado em{" "}
        {new Date(dados.geradoEm).toLocaleString("pt-BR")}.
      </p>
    </div>
  );
}
