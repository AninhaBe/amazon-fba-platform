"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "./EmptyState";
import { DashboardSkeleton } from "./LoadingState";
import { PageHeader } from "./PageHeader";

// Visão do canal TikTok Shop. Enquanto não há ingestão, esta tela só reporta o
// estado real da conexão — nunca zeros que pareçam "não vendeu nada"
// (docs/estado-atual.md, decisão 3). O dashboard entra junto com o sync.

interface ProviderStatus {
  configured: boolean;
  connected: boolean;
  connectHref?: string;
  lojas: Array<{ id: string; nome: string }>;
}

export function TikTokWorkspace() {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const resposta = await fetch("/api/integrations", { cache: "no-store" });
        if (!resposta.ok) throw new Error("Não foi possível carregar as integrações.");
        const dados = await resposta.json();
        const provider = (dados.providers ?? []).find((item: { id: string }) => item.id === "tiktok_shop");
        if (cancelado) return;
        const conexoes = provider?.connections ?? [];
        setStatus({
          configured: Boolean(provider?.configured),
          connected: conexoes.length > 0,
          connectHref: provider?.connectHref,
          lojas: conexoes.map((c: { externalAccountId: string; displayName?: string }) => ({
            id: c.externalAccountId,
            nome: c.displayName || c.externalAccountId,
          })),
        });
      } catch (err) {
        if (!cancelado) setError(err instanceof Error ? err.message : "Erro ao carregar.");
      }
    })();
    return () => { cancelado = true; };
  }, []);

  if (error) {
    return (
      <>
        <PageHeader eyebrow="TikTok Shop" title="Visão do canal" />
        <EmptyState title="Não foi possível carregar" description={error} kind="permission" />
      </>
    );
  }

  if (!status) {
    return (
      <>
        <PageHeader eyebrow="TikTok Shop" title="Visão do canal" />
        <DashboardSkeleton />
      </>
    );
  }

  // Mesma regra da Shopee: credencial do servidor habilita CONECTAR, não ver.
  if (!status.connected) {
    if (!status.configured) {
      return (
        <>
          <PageHeader eyebrow="TikTok Shop" title="Visão do canal" subtitle="Canal ainda não configurado no servidor." />
          <EmptyState
            kind="permission"
            title="Credenciais do TikTok Shop ausentes"
            description="Defina TIKTOK_APP_KEY, TIKTOK_APP_SECRET e TIKTOK_SERVICE_ID no ambiente para habilitar a conexão."
          />
        </>
      );
    }
    return (
      <>
        <PageHeader eyebrow="TikTok Shop" title="Visão do canal" subtitle="Conecte sua loja para começar." />
        <EmptyState
          title="Nenhuma loja TikTok Shop conectada"
          description="Ao autorizar, o SellerCore passa a ler pedidos, produtos e o extrato financeiro de cada venda."
          action={
            <Link className="meli-primary-action" href={status.connectHref || "/integracoes"}>
              Conectar TikTok Shop <span aria-hidden="true">→</span>
            </Link>
          }
        />
      </>
    );
  }

  // Conectado, mas a ingestão ainda não existe. Dizer isso é melhor do que
  // mostrar um dashboard zerado que passaria a ideia errada de "sem vendas".
  return (
    <>
      <PageHeader
        eyebrow="TikTok Shop"
        title={status.lojas[0]?.nome ?? "Loja conectada"}
        subtitle={status.lojas.length > 1 ? `${status.lojas.length} lojas autorizadas` : "Autorização ativa"}
      />
      <EmptyState
        title="Loja autorizada — sincronização ainda não disponível"
        description="A leitura de pedidos, produtos e extrato deste canal está em desenvolvimento. Assim que entrar no ar, os indicadores aparecem aqui sem você precisar reconectar."
        action={<Link className="meli-primary-action" href="/integracoes">Gerenciar conexão <span aria-hidden="true">→</span></Link>}
      />
    </>
  );
}
