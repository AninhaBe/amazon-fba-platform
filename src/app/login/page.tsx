import { Suspense } from "react";
import { Logo } from "../components/Logo";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="auth-intro" aria-labelledby="auth-title">
        <Logo />
        <p className="auth-kicker">Operação multicanal, acesso individual</p>
        <h1 id="auth-title">Seus canais pertencem ao seu workspace.</h1>
        <p>Amazon, Mercado Livre e os próximos canais ficam isolados por conta. Você só vê as integrações autorizadas por você.</p>
        <div className="auth-assurance"><span aria-hidden="true">✓</span> Sessão protegida e dados separados por usuário</div>
      </section>
      <Suspense fallback={<div className="auth-card min-h-[390px]" aria-label="Carregando acesso" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
