import { NexoWordmark } from "../components/NexoWordmark";
import { RecoverForm } from "./RecoverForm";

export const dynamic = "force-dynamic";

export default function RecuperarSenhaPage() {
  return (
    <main className="auth-page">
      <section className="auth-intro" aria-labelledby="recover-title">
        <NexoWordmark className="mb-6" />
        <p className="auth-kicker">Acesso</p>
        <h1 id="recover-title">Esqueceu a senha? Isso a gente resolve.</h1>
        <div className="auth-intro-copy">
          <p>Informe o e-mail da conta e enviamos um link para você definir uma senha nova.</p>
          <p>O link expira e só funciona uma vez. Sua operação continua onde estava.</p>
        </div>
      </section>
      <RecoverForm />
    </main>
  );
}
