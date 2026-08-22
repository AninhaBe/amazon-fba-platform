import { Suspense } from "react";
import { NexoSymbol } from "../components/NexoSymbol";
import { NexoWordmark } from "../components/NexoWordmark";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

function AuthChannelFlow() {
  return (
    <div className="auth-channel-flow" aria-hidden="true">
      <div className="auth-flow-caption">
        <span>Seus canais</span>
        <span>Uma leitura operacional</span>
      </div>
      <svg className="auth-flow-lines" viewBox="0 0 560 170" preserveAspectRatio="none">
        <path d="M82 28 C190 28 212 85 280 85" />
        <path d="M82 66 C192 66 220 85 280 85" />
        <path d="M82 104 C192 104 220 85 280 85" />
        <path d="M82 142 C190 142 212 85 280 85" />
        <path className="auth-flow-output-line" d="M328 85 C398 85 423 85 486 85" />
      </svg>

      <div className="auth-flow-sources">
        <span className="is-amazon"><i />Amazon</span>
        <span className="is-meli"><i />Mercado Livre</span>
        <span className="is-shopee"><i />Shopee</span>
        <span className="is-tiktok"><i />TikTok Shop</span>
      </div>

      <div className="auth-flow-core">
        <span className="auth-flow-core-ring" />
        <span className="auth-flow-core-mark"><NexoSymbol size={42} /></span>
      </div>

      <span className="auth-flow-runner"><NexoSymbol size={18} /></span>
      <div className="auth-flow-outcome"><span>Decisão</span><strong>com contexto</strong></div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="auth-intro" aria-labelledby="auth-title">
        {/* Assinatura da marca. Trocar de volta é uma linha: <Logo />. */}
        <NexoWordmark className="mb-6" />
        <p className="auth-kicker">Operação multicanal, acesso individual</p>
        <h1 id="auth-title">Seus canais pertencem ao seu workspace.</h1>
        <p>Amazon, Mercado Livre e os próximos canais ficam isolados por conta. Você só vê as integrações autorizadas por você.</p>
        <dl className="auth-assurance-list">
          <div><dt>Isolamento</dt><dd>Dados separados por usuário e workspace</dd></div>
          <div><dt>Autorização</dt><dd>Somente as lojas conectadas por você</dd></div>
          <div><dt>Transparência</dt><dd>Dado ausente nunca aparece como zero</dd></div>
        </dl>
        <AuthChannelFlow />
      </section>
      <Suspense fallback={<div className="auth-card min-h-[390px]" aria-label="Carregando acesso" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
