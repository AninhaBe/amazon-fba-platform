import { Suspense } from "react";
import { NexoWordmark } from "../components/NexoWordmark";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

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
      </section>
      <Suspense fallback={<div className="auth-card min-h-[390px]" aria-label="Carregando acesso" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
