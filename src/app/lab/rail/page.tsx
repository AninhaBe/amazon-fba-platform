"use client";

import { useState } from "react";
import { OperationsRail } from "../../components/OperationsRail";
import type { WorkspaceId } from "@/lib/integrations/workspaces";

/**
 * O menu lateral DE VERDADE, montado fora da sessão.
 *
 * `AppShell` só existe para quem está logado, então qualquer ajuste no menu
 * exigiria uma sessão para ser conferido. Aqui o `OperationsRail` é montado
 * sozinho, com os mesmos componentes e as mesmas classes de `globals.css` —
 * o que aparece nesta página é o que vai para produção.
 *
 * Não é protótipo (esse é o `/lab/menu`, com as três opções que foram
 * comparadas). É bancada de conferência do componente real.
 *
 * ⚠️ Uma diferença que importa: aqui não há dados nem sessão, então
 * `AccountSwitcher` e `LogoutButton` renderizam no estado vazio deles. O
 * esqueleto do menu é fiel; o conteúdo do rodapé, não.
 */

const CANAIS: Array<{ id: WorkspaceId; nome: string }> = [
  { id: "overview", nome: "Central" },
  { id: "amazon", nome: "Amazon" },
  { id: "mercado_livre", nome: "Mercado Livre" },
  { id: "shopee", nome: "Shopee" },
  { id: "tiktok_shop", nome: "TikTok Shop" },
];

export default function LabRail() {
  const [workspace, setWorkspace] = useState<WorkspaceId>("amazon");

  return (
    <div className="app-shell flex min-h-screen" data-channel={workspace}>
      <OperationsRail workspace={workspace} />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="operations-canvas mx-auto w-full max-w-[1500px] flex-1 px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
          <div className="mb-6 rounded-xl border border-[var(--line-strong)] bg-white p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">
              Bancada do menu real
            </p>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              Este é o <code>OperationsRail</code> de produção. Passe o mouse: o painel abre
              por cima e os cards abaixo <strong>não se mexem</strong>. O botão no topo do
              painel fixa aberto, e a escolha sobrevive ao reload.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {CANAIS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setWorkspace(c.id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    c.id === workspace
                      ? "border-[var(--ink)] bg-[var(--ink)] text-white"
                      : "border-[var(--line-strong)] bg-white text-[var(--ink-soft)]"
                  }`}
                >
                  {c.nome}
                </button>
              ))}
            </div>
          </div>

          {/* Cards de mentira: existem só para ter o que o painel sobrepor. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {["Faturamento", "Taxas", "Lucro", "Estoque"].map((t) => (
              <div key={t} className="rounded-xl border border-[var(--line-strong)] bg-white p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">{t}</p>
                <div className="mt-3 h-4 rounded bg-[var(--ink-05)]" />
                <div className="mt-2 h-2.5 w-1/2 rounded bg-[var(--ink-03)]" />
              </div>
            ))}
          </div>
          <div className="mt-3 h-64 rounded-xl border border-[var(--line-strong)] bg-white" />
          <div className="mt-3 h-40 rounded-xl border border-[var(--line-strong)] bg-white" />
        </main>
      </div>
    </div>
  );
}
