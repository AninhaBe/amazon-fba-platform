"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// Widget de suporte do Crisp (frente M, decisão da Ana em 28/08/2026 — plano
// Free). Três regras que não são estéticas:
//
// 1. SÓ no app logado. O componente é montado dentro do ramo autenticado do
//    AppShell — landing, login, /privacidade e /lab fazem early-return antes
//    dele, então a página pública nunca carrega script de terceiro.
// 2. DORMENTE sem a env. `NEXT_PUBLIC_CRISP_WEBSITE_ID` entra no bundle no
//    BUILD (build-arg no Dockerfile/fly-deploy.sh); ausente = nenhum script,
//    nenhuma requisição, nada. O código pode subir de carona em qualquer
//    release antes de a conta Crisp existir.
// 3. Identidade mínima (parecer LGPD): APENAS e-mail e nome do usuário logado
//    vão ao widget — nenhum dado de operação, venda, canal ou workspace.
//    O Crisp está listado como subprocessador em /privacidade.

const CRISP_WEBSITE_ID = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID;

declare global {
  interface Window {
    $crisp?: unknown[];
    CRISP_WEBSITE_ID?: string;
  }
}

export function CrispChat() {
  useEffect(() => {
    if (!CRISP_WEBSITE_ID) return;
    if (window.$crisp) return; // já carregado nesta sessão de navegação
    window.$crisp = [];
    window.CRISP_WEBSITE_ID = CRISP_WEBSITE_ID;
    const script = document.createElement("script");
    script.src = "https://client.crisp.chat/l.js";
    script.async = true;
    document.head.appendChild(script);

    // Identidade só com sessão real; sem sessão o widget fica anônimo.
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        const user = data.user;
        if (!user?.email || !window.$crisp) return;
        window.$crisp.push(["set", "user:email", [user.email]]);
        const nome = (user.user_metadata?.name ?? user.user_metadata?.full_name) as string | undefined;
        if (nome) window.$crisp.push(["set", "user:nickname", [nome]]);
      })
      .catch(() => {
        // Sem sessão legível não há identidade a setar — o chat segue anônimo.
      });
  }, []);

  return null;
}
