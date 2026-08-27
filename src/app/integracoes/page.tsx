"use client";

import { useEffect, useState } from "react";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { PanelLoading } from "../components/LoadingState";
import { MarketplaceIcon } from "../components/MarketplaceIcon";
import {
  activeConnectionCount,
  connectionRemovalCopy,
  isRemovableProvider,
  providerState,
  providerStateLabel,
  type RemovableProviderId,
} from "./IntegrationsPageModel";

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
  issue?: {
    status: "attention";
    code: "OWNERSHIP_CONFLICT" | "PROVIDER_READ_FAILED";
    message: string;
  };
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

const canonicalProviderOrder: Provider["id"][] = ["amazon", "mercado_livre", "shopee", "tiktok_shop"];

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
      } else if (query.get("connected") === "shopee") {
        setMessage({ tone: "success", text: "Shopee conectada com sucesso." });
        window.history.replaceState({}, "", "/integracoes");
      } else if (query.get("error")) {
        setMessage({ tone: "error", text: query.get("error") || "Não foi possível concluir a conexão." });
        window.history.replaceState({}, "", "/integracoes");
      }
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function disconnect(connection: Connection, providerId: RemovableProviderId) {
    const copy = connectionRemovalCopy(providerId, connection.displayName || connection.externalAccountId);
    if (!window.confirm(copy.confirm)) return;
    setBusy(connection.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/integrations?id=${encodeURIComponent(connection.id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erro ao desconectar.");
      await load();
      if (copy.success) setMessage({ tone: "success", text: copy.success });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Erro ao desconectar." });
    } finally {
      setBusy(null);
    }
  }

  const connectedCount = activeConnectionCount(providers);
  const connectedProviders = providers.filter((provider) => provider.connections.some((connection) => connection.status === "connected")).length;
  const attentionProviders = providers.filter((provider) => provider.issue || provider.connections.some((connection) => connection.status !== "connected")).length;
  const availableProviders = providers.filter((provider) => provider.availability === "available").length;
  const orderedProviders = [...providers].sort((a, b) => canonicalProviderOrder.indexOf(a.id) - canonicalProviderOrder.indexOf(b.id));

  return (
    <div className="integrations-page analysis-page">
      <PageHeader
        eyebrow="Configuração do NEXO"
        title="Integrações"
        subtitle="Conecte seus canais de venda em uma única operação. Cada integração alimenta o mesmo catálogo, pedidos, estoque e visão financeira."
        icon={pageIcons.integrations}
      />

      {message && (
        <div role="status" className={`integration-message is-${message.tone}`}>{message.text}</div>
      )}

      <section className="listing-summary-band is-4 integration-summary-band" aria-label="Resumo das integrações">
        <div><span>Contas conectadas</span><strong>{connectedCount}</strong><small>credenciais ativas nesta operação</small></div>
        <div><span>Canais ativos</span><strong>{connectedProviders}</strong><small>de {providers.length || 4} canais mapeados</small></div>
        <div className={attentionProviders > 0 ? "is-warning" : "is-positive"}><span>Pedem atenção</span><strong>{attentionProviders}</strong><small>conexões degradadas ou interrompidas</small></div>
        <div><span>Disponíveis agora</span><strong>{availableProviders}</strong><small>provedores com conexão habilitada</small></div>
      </section>

      <section className="integration-settings-layout" aria-labelledby="channels-title">
        <div className="integration-provider-workspace">
          <header className="integration-section-heading">
            <div>
              <p className="section-kicker">Canais de venda</p>
              <h2 id="channels-title">Contas e permissões</h2>
            </div>
            <p>O estado de cada canal fica explícito; reconexões e remoções continuam separadas.</p>
          </header>

        {loading ? (
          <PanelLoading label="Carregando integrações" />
        ) : (
          <div className="integration-grid integration-provider-list">
            {orderedProviders.map((provider) => {
              const planned = provider.availability === "planned";
              const state = providerState(provider.connections, {
                planned,
                configured: provider.configured,
                issueStatus: provider.issue?.status,
              });
              const connected = state === "connected";
              const needsReconnect = state === "attention" || state === "disconnected";
              const removableProvider = isRemovableProvider(provider.id) ? provider.id : null;
              const capabilities = provider.id === "mercado_livre" && !provider.capabilities.includes("finance")
                ? [...provider.capabilities, "finance"]
                : provider.capabilities;
              return (
                <article key={provider.id} className={`integration-card provider-${provider.id}${connected ? " is-connected" : ""}`}>
                  <header>
                    <span className="provider-mark" aria-hidden="true"><MarketplaceIcon provider={provider.id} size={40} app /></span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3>{provider.name}</h3>
                        <span className={`connection-status is-${state}`}>
                          {providerStateLabel[state]}
                        </span>
                      </div>
                      <p>{provider.description}</p>
                    </div>
                  </header>

                  <div className="capability-list" aria-label={`Recursos de ${provider.name}`}>
                    {capabilities.map((capability) => <span key={capability}>{capabilityLabels[capability] || capability}</span>)}
                  </div>

                  {provider.issue && (
                    <p role="status" className="mx-5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      {provider.issue.message}
                    </p>
                  )}

                  {provider.connections.length > 0 && (
                    <ul className="connection-list">
                      {provider.connections.map((connection) => (
                        <li key={connection.id}>
                          <span className={`connection-dot is-${connection.status}`} aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <strong>{connection.displayName || connection.externalAccountId}</strong>
                            <small>{connection.region || connection.externalAccountId}</small>
                          </span>
                          {removableProvider && (
                            <button type="button" onClick={() => void disconnect(connection, removableProvider)} disabled={busy === connection.id} className="connection-remove">
                              {busy === connection.id
                                ? "Removendo…"
                                : connectionRemovalCopy(removableProvider, connection.displayName || connection.externalAccountId).button}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  <footer>
                    {provider.issue ? (
                      <span className="integration-disabled">Canal protegido até a correção da conexão</span>
                    ) : planned ? (
                      <span className="integration-disabled">Integração preparada para a próxima fase</span>
                    ) : connected ? (
                      <span className="integration-active-state"><span aria-hidden="true">✓</span> Integração ativa nesta conta</span>
                    ) : needsReconnect && provider.configured && provider.connectHref ? (
                      <a href={provider.connectHref} className="integration-connect">
                        Reconectar {provider.name}
                        <span aria-hidden="true">→</span>
                      </a>
                    ) : provider.configured && provider.connectHref ? (
                      <a href={provider.connectHref} className="integration-connect">
                        Conectar {provider.name}
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
        </div>
      </section>

      <section className="integration-architecture" aria-labelledby="architecture-title">
        <div>
          <p className="section-kicker">Arquitetura comum</p>
          <h2 id="architecture-title">Um produto, vários canais</h2>
          <p>O NEXO normaliza as diferenças de cada marketplace antes de entregar os dados às telas.</p>
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
