import { Suspense } from "react";
import { NexoSymbol } from "../components/NexoSymbol";
import { NexoWordmark } from "../components/NexoWordmark";
import { RodapePublico } from "../components/RodapePublico";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

function AuthChannelFlow() {
  return (
    <div className="auth-channel-flow" aria-hidden="true">
      <div className="auth-flow-caption">
        <span>Seus marketplaces</span>
        <span>Uma operação</span>
      </div>
      <svg className="auth-flow-lines" viewBox="0 0 560 170" preserveAspectRatio="none">
        <path d="M82 28 C190 28 212 85 280 85" />
        <path d="M82 66 C192 66 220 85 280 85" />
        <path d="M82 104 C192 104 220 85 280 85" />
        <path d="M82 142 C190 142 212 85 280 85" />
        <path className="auth-flow-output-line" d="M328 85 C398 85 423 85 486 85" />
        <g className="auth-flow-packets">
          <circle className="auth-flow-packet is-amazon" r="3.5">
            <animateMotion dur="5.6s" begin="0s" repeatCount="indefinite" path="M82 28 C190 28 212 85 280 85" />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.12;.82;1" dur="5.6s" begin="0s" repeatCount="indefinite" />
          </circle>
          <circle className="auth-flow-packet is-meli" r="3.5">
            <animateMotion dur="5.6s" begin=".7s" repeatCount="indefinite" path="M82 66 C192 66 220 85 280 85" />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.12;.82;1" dur="5.6s" begin=".7s" repeatCount="indefinite" />
          </circle>
          <circle className="auth-flow-packet is-shopee" r="3.5">
            <animateMotion dur="5.6s" begin="1.4s" repeatCount="indefinite" path="M82 104 C192 104 220 85 280 85" />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.12;.82;1" dur="5.6s" begin="1.4s" repeatCount="indefinite" />
          </circle>
          <circle className="auth-flow-packet is-tiktok" r="3.5">
            <animateMotion dur="5.6s" begin="2.1s" repeatCount="indefinite" path="M82 142 C190 142 212 85 280 85" />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.12;.82;1" dur="5.6s" begin="2.1s" repeatCount="indefinite" />
          </circle>
        </g>
      </svg>

      <div className="auth-flow-sources">
        <span className="is-amazon"><i />Amazon</span>
        <span className="is-meli"><i />Mercado Livre</span>
        <span className="is-shopee"><i />Shopee</span>
        <span className="is-tiktok"><i />TikTok Shop</span>
      </div>

      <div className="auth-flow-core">
        <span className="auth-flow-core-ring" />
        <span className="auth-flow-core-ring is-delayed" />
        <span className="auth-flow-core-mark"><NexoSymbol size={42} /></span>
      </div>

      <span className="auth-flow-runner"><NexoSymbol size={18} /></span>
      <div className="auth-flow-outcome"><span>NEXO</span><strong>Conectando os pontos.</strong></div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="auth-intro" aria-labelledby="auth-title">
        {/* Assinatura da marca. Trocar de volta é uma linha: <Logo />. */}
        <NexoWordmark className="mb-6" />
        <p className="auth-kicker">Sua operação, conectada</p>
        <h1 id="auth-title">Entre no lugar onde tudo começa a fazer sentido.</h1>
        <div className="auth-intro-copy">
          <p>Amazon, Mercado Livre, Shopee e TikTok Shop deixam de ser quatro histórias separadas.</p>
          <p>No <strong>NEXO</strong>, vendas, margem, estoque e cobranças fazem parte da mesma operação.</p>
        </div>
        <dl className="auth-assurance-list">
          <div><dt>Todos os canais</dt><dd>Uma visão única do que está acontecendo.</dd></div>
          <div><dt>Números com contexto</dt><dd>Não apenas quanto mudou. O que existe por trás.</dd></div>
          <div><dt>Decisão mais rápida</dt><dd>Saiba onde agir sem perder tempo interpretando painel.</dd></div>
        </dl>
        <AuthChannelFlow />
      </section>
      <Suspense fallback={<div className="auth-card min-h-[390px]" aria-label="Carregando acesso" />}>
        <LoginForm />
      </Suspense>
      {/* Identificacao de quem opera o NEXO, visivel sem login — a tira e
          posicionada e nao entra na grade de duas colunas acima. */}
      <RodapePublico variante="compacto" />
    </main>
  );
}
