"use client";

import { useEffect, useState } from "react";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { PanelLoading } from "../components/LoadingState";
import { MarketplaceIcon } from "../components/MarketplaceIcon";

interface Connection {
  id: string;
  externalAccountId: string;
  displayName?: string;
  region?: string;
  status: "connected" | "attention" | "disconnected";
  connectedAt: string;
}

interface Provider {
  id: "amazon" | "mercado_livre" | "shopee" | "tiktok_shop";
  name: string;
  shortName: string;
  description: string;
  capabilities: string[];
  availability: "available" | "planned";
  connectHref?: string;
  configured: boolean;
  connections: Connection[];
}

const capabilityLabels: Record<string, string> = {
  catalog: "Catálogo",
  orders: "Pedidos",
  inventory: "Estoque",
  pricing: "Preços",
  finance: "Financeiro",
  traffic: "Tráfego",
  messages: "Mensagens",
  promotions: "Promoções",
};

export default function IntegracoesPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/integrations", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erro ao carregar integrações.");
      setProviders(data.providers);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Erro ao carregar integrações." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams(window.location.search);
      if (query.get("connected") === "mercado_livre") {
        setMessage({ tone: "success", text: "Mercado Livre conectado com sucesso." });
        window.history.replaceState({}, "", "/integracoes");
      } else if (query.get("connected") === "tiktok_shop") {
        setMessage({ tone: "success", text: "TikTok Shop conectada com sucesso." });
        window.history.replaceState({}, "", "/integracoes");
      } else if (query.get("error")) {
        setMessage({ tone: "error", text: query.get("error") || "Não foi possível concluir a conexão." });
        window.history.replaceState({}, "", "/integracoes");
      }
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function disconnect(connection: Connection) {
    if (!window.confirm(`Desconectar ${connection.displayName || connection.externalAccountId}?`)) return;
    setBusy(connection.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/integrations?id=${encodeURIComponent(connection.id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erro ao desconectar.");
      await load();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Erro ao desconectar." });
    } finally {
      setBusy(null);
    }
  }

  const connectedCount = providers.reduce((total, provider) => total + provider.connections.length, 0);

  return (
    <div className="integrations-page space-y-8">
      <PageHeader
        eyebrow="Ecossistema SellerCore"
        title="Integrações"
        subtitle="Conecte seus canais de venda em uma única operação. Cada integração alimenta o mesmo catálogo, pedidos, estoque e visão financeira."
        icon={pageIcons.integrations}
        action={<span className="integration-summary">{connectedCount} {connectedCount === 1 ? "conta conectada" : "contas conectadas"}</span>}
      />

      {message && (
        <div role="status" className={`integration-message is-${message.tone}`}>{message.text}</div>
      )}

      <section aria-labelledby="channels-title">
        <div className="integration-section-heading">
          <div>
            <p className="section-kicker">Canais de venda</p>
            <h2 id="channels-title">Seu ecossistema comercial</h2>
          </div>
          <p>Comece conectando um canal. As próximas fontes entram sem mudar as telas operacionais.</p>
        </div>

        {loading ? (
          <PanelLoading label="Carregando integrações" />
        ) : (
          <div className="integration-grid">
            {providers.map((provider) => {
              const connected = provider.connections.length > 0;
              const planned = provider.availability === "planned";
              return (
                <article key={provider.id} className={`integration-card provider-${provider.id}${connected ? " is-connected" : ""}`}>
                  <header>
                    <span className="provider-mark" aria-hidden="true"><MarketplaceIcon provider={provider.id} size={30} /></span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3>{provider.name}</h3>
                        <span className={`connection-status ${connected ? "is-connected" : planned ? "is-planned" : ""}`}>
                          {connected ? "Conectado" : planned ? "Planejado" : "Disponível"}
                        </span>
                      </div>
                      <p>{provider.description}</p>
                    </div>
                  </header>

                  <div className="capability-list" aria-label={`Recursos de ${provider.name}`}>
                    {provider.capabilities.map((capability) => <span key={capability}>{capabilityLabels[capability] || capability}</span>)}
                  </div>

                  {provider.connections.length > 0 && (
                    <ul className="connection-list">
                      {provider.connections.map((connection) => (
                        <li key={connection.id}>
                          <span className="connection-dot" aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <strong>{connection.displayName || connection.externalAccountId}</strong>
                            <small>{connection.region || connection.externalAccountId}</small>
                          </span>
                          {(provider.id === "mercado_livre" || provider.id === "tiktok_shop") && (
                            <button type="button" onClick={() => void disconnect(connection)} disabled={busy === connection.id} className="connection-remove">
                              {busy === connection.id ? "Removendo…" : "Desconectar"}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  <footer>
                    {planned ? (
                      <span className="integration-disabled">Integração preparada para a próxima fase</span>
                    ) : provider.configured && provider.connectHref ? (
                      <a href={provider.connectHref} className="integration-connect">
                        {connected ? "Conectar outra conta" : `Conectar ${provider.name}`}
                        <span aria-hidden="true">→</span>
                      </a>
                    ) : (
                      <span className="integration-disabled">Configure as credenciais para habilitar</span>
                    )}
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="integration-architecture" aria-labelledby="architecture-title">
        <div>
          <p className="section-kicker">Arquitetura comum</p>
          <h2 id="architecture-title">Um produto, vários canais</h2>
          <p>O SellerCore normaliza as diferenças de cada marketplace antes de entregar os dados às telas.</p>
        </div>
        <ol>
          <li><span>01</span><strong>Conectar</strong><small>Acesso seguro e separado por canal</small></li>
          <li><span>02</span><strong>Normalizar</strong><small>Produtos, pedidos e estoque em um modelo comum</small></li>
          <li><span>03</span><strong>Decidir</strong><small>Indicadores comparáveis em uma visão consolidada</small></li>
        </ol>
      </section>
    </div>
  );
}
