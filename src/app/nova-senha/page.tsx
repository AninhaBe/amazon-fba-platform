import { NexoWordmark } from "../components/NexoWordmark";
import { NewPasswordForm } from "./NewPasswordForm";

export const dynamic = "force-dynamic";

export default function NovaSenhaPage() {
  return (
    <main className="auth-page">
      <section className="auth-intro" aria-labelledby="nova-senha-title">
        <NexoWordmark className="mb-6" />
        <p className="auth-kicker">Acesso</p>
        <h1 id="nova-senha-title">Escolha a senha que vai valer daqui para frente.</h1>
        <div className="auth-intro-copy">
          <p>Ao salvar, as outras sessões abertas nesta conta são encerradas.</p>
          <p>Se você não pediu esta troca, não salve nada e avise a gente.</p>
        </div>
      </section>
      <NewPasswordForm />
    </main>
  );
}
