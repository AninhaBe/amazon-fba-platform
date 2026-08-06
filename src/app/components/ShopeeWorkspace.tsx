"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "./EmptyState";
import { DashboardSkeleton } from "./LoadingState";
import { PageHeader } from "./PageHeader";
import { brDate } from "@/lib/datetime";

interface ShopeeStatus {
  configured: boolean;
  connections: Array<{
    id: string;
    externalAccountId: string;
    displayName?: string | null;
    region?: string | null;
    status: string;
    connectedAt?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
  connectHref?: string;
}

// Enquanto o sync do canal não existe, esta tela cumpre um papel só: mostrar o
// estado real da conexão e dar o caminho para conectar. Nada de número inventado —
// os dashboards entram quando houver loja autorizada e ingestão validada.
export function ShopeeWorkspace() {
  const [status, setStatus] = useState<ShopeeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/integrations", { cache: "no-store" });
        if (!response.ok) throw new Error("Não foi possível carregar as integrações.");
        const data = await response.json();
        const shopee = (data.providers ?? []).find(
          (provider: { id: string }) => provider.id === "shopee"
        );
        if (!cancelled) {
          setStatus({
            configured: Boolean(shopee?.configured),
            connections: shopee?.connections ?? [],
            connectHref: shopee?.connectHref,
          });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <>
        <PageHeader eyebrow="Shopee" title="Visão do canal" />
        <EmptyState title="Não foi possível carregar" description={error} kind="permission" />
      </>
    );
  }

  if (!status) {
    return (
      <>
        <PageHeader eyebrow="Shopee" title="Visão do canal" />
        <DashboardSkeleton />
      </>
    );
  }

  const connection = status.connections[0];

  if (!status.configured) {
    return (
      <>
        <PageHeader eyebrow="Shopee" title="Visão do canal" subtitle="Canal ainda não configurado no servidor." />
        <EmptyState
          kind="permission"
          title="Credenciais da Shopee ausentes"
          description="Defina SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY no ambiente para habilitar a conexão."
        />
      </>
    );
  }

  if (!connection) {
    return (
      <>
        <PageHeader
          eyebrow="Shopee"
          title="Visão do canal"
          subtitle="Conecte uma loja para começar a sincronizar pedidos e taxas."
        />
        <EmptyState
          title="Nenhuma loja Shopee conectada"
          description="Ao autorizar, o SellerCore passa a ler pedidos, produtos e as taxas reais de cada venda (escrow)."
          action={
            status.connectHref ? (
              <Link className="meli-primary-action" href={status.connectHref}>
                Conectar loja Shopee <span aria-hidden="true">→</span>
              </Link>
            ) : (
              <Link className="meli-primary-action" href="/integracoes">
                Ir para integrações <span aria-hidden="true">→</span>
              </Link>
            )
          }
        />
      </>
    );
  }

  const authorizedAt = typeof connection.metadata?.authorizedAt === "string" ? connection.metadata.authorizedAt : null;
  const sandbox = connection.metadata?.sandbox === true;

  return (
    <>
      <PageHeader
        eyebrow="Shopee"
        title={connection.displayName || `Loja ${connection.externalAccountId}`}
        subtitle={
          <>
            Loja {connection.externalAccountId}
            {connection.region ? ` · ${connection.region}` : ""}
            {sandbox ? " · ambiente de teste" : ""}
            {authorizedAt ? ` · autorizada em ${brDate(authorizedAt)}` : ""}
          </>
        }
      />
      <EmptyState
        title="Loja conectada — sincronização em construção"
        description="A autorização está válida. A ingestão de pedidos, produtos e taxas entra em seguida; até lá esta tela não mostra números para não exibir dado incompleto."
        action={
          <Link className="meli-primary-action" href="/integracoes">
            Gerenciar conexão <span aria-hidden="true">→</span>
          </Link>
        }
      />
    </>
  );
}
