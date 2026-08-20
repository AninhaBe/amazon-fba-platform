"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn, signUp, type AuthActionState } from "./actions";

const initialState: AuthActionState = {};

export function LoginForm() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const action = mode === "login" ? signIn : signUp;
  const [state, formAction, pending] = useActionState(action, initialState);
  const setupMissing = searchParams.get("setup") === "1";
  const confirmationFailed = searchParams.get("error") === "confirmation";

  return (
    <div className="auth-card">
      <header className="auth-card-heading">
        <span>Conta NEXO</span>
        <h2>{mode === "login" ? "Acesse seu workspace" : "Crie seu workspace"}</h2>
        <p>{mode === "login" ? "Continue de onde sua operação parou." : "Comece com uma conta individual e conecte seus canais depois."}</p>
      </header>
      <div className="auth-tabs" role="tablist" aria-label="Acesso ao NEXO">
        <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "is-active" : ""} onClick={() => setMode("login")}>Entrar</button>
        <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "is-active" : ""} onClick={() => setMode("signup")}>Criar conta</button>
      </div>

      <form action={formAction} className="auth-form">
        <input type="hidden" name="next" value={searchParams.get("next") ?? ""} />
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" inputMode="email" autoComplete="email" placeholder="voce@empresa.com" required />

        <label htmlFor="password">Senha</label>
        <input id="password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} placeholder="Mínimo de 8 caracteres" required />

        {(setupMissing || confirmationFailed || state.message) && (
          <p className={state.success ? "auth-message is-success" : "auth-message"} role="status">
            {setupMissing
              ? "O acesso está bloqueado até as credenciais do Supabase serem configuradas no Render."
              : confirmationFailed
                ? "Não foi possível confirmar esse acesso. Solicite um novo cadastro ou tente novamente."
                : state.message}
          </p>
        )}

        <button className="auth-submit" type="submit" disabled={pending || setupMissing}>
          {pending ? "Aguarde…" : mode === "login" ? "Entrar no NEXO" : "Criar minha conta"}
        </button>
      </form>
      <footer className="auth-card-footer">
        <Link href="/landing">Conhecer o NEXO</Link>
        <Link href="/privacidade">Privacidade e dados</Link>
      </footer>
    </div>
  );
}
