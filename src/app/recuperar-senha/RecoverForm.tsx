"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset } from "./actions";
import type { AuthActionState } from "../login/actions";

const initialState: AuthActionState = {};

export function RecoverForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  return (
    <div className="auth-card">
      <header className="auth-card-heading">
        <h2>Recuperar acesso</h2>
        <p>Enviamos um link para você criar uma senha nova.</p>
      </header>

      <form action={formAction} className="auth-form">
        <label htmlFor="email">E-mail da conta</label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="voce@empresa.com"
          required
        />

        {state.message ? (
          <p className={state.success ? "auth-message is-success" : "auth-message"} role="status">
            {state.message}
          </p>
        ) : null}

        <button className="auth-submit" type="submit" disabled={pending}>
          {pending ? "Enviando…" : "Enviar link de recuperação"}
        </button>
      </form>

      <footer className="auth-card-footer">
        <Link href="/login">Voltar para o login</Link>
        <Link href="/privacidade">Privacidade e dados</Link>
      </footer>
    </div>
  );
}
