"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { definirNovaSenha } from "./actions";
import type { AuthActionState } from "../login/actions";

const initialState: AuthActionState = {};

function PasswordVisibilityToggle({ visible, onToggle, fieldLabel }: { visible: boolean; onToggle: () => void; fieldLabel: string }) {
  const actionLabel = visible ? `Ocultar ${fieldLabel}` : `Mostrar ${fieldLabel}`;
  return (
    <button
      type="button"
      className="auth-password-toggle"
      aria-label={actionLabel}
      aria-pressed={visible}
      title={actionLabel}
      onClick={onToggle}
    >
      <span className={visible ? "" : "is-visible"}><Eye aria-hidden="true" /></span>
      <span className={visible ? "is-visible" : ""}><EyeOff aria-hidden="true" /></span>
    </button>
  );
}

export function NewPasswordForm() {
  const [state, formAction, pending] = useActionState(definirNovaSenha, initialState);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [confirmationDraft, setConfirmationDraft] = useState("");
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const confirmationInputRef = useRef<HTMLInputElement>(null);

  const confirmationStarted = confirmationDraft.length > 0;
  const passwordsMatch = confirmationStarted && passwordDraft === confirmationDraft;
  const passwordsMismatch = confirmationStarted && passwordDraft !== confirmationDraft;

  return (
    <div className="auth-card">
      <header className="auth-card-heading">
        <h2>Criar uma senha nova</h2>
        <p>Depois de salvar, você entra direto no NEXO.</p>
      </header>

      <form
        action={formAction}
        className="auth-form"
        onSubmit={(event) => {
          const password = passwordInputRef.current?.value ?? "";
          const confirmation = confirmationInputRef.current?.value ?? "";
          setPasswordDraft(password);
          setConfirmationDraft(confirmation);
          if (password !== confirmation) {
            event.preventDefault();
            confirmationInputRef.current?.focus();
          }
        }}
      >
        <label htmlFor="password">Senha nova</label>
        <div className="auth-password-field">
          <input
            ref={passwordInputRef}
            id="password"
            name="password"
            type={passwordVisible ? "text" : "password"}
            autoComplete="new-password"
            minLength={8}
            placeholder="Mínimo de 8 caracteres"
            onChange={(event) => setPasswordDraft(event.currentTarget.value)}
            required
          />
          <PasswordVisibilityToggle visible={passwordVisible} onToggle={() => setPasswordVisible((visible) => !visible)} fieldLabel="senha" />
        </div>

        <div className="auth-confirmation-group">
          <label htmlFor="password-confirmation">Confirme a senha</label>
          <div className="auth-password-field">
            <input
              ref={confirmationInputRef}
              id="password-confirmation"
              name="password_confirmation"
              type={confirmationVisible ? "text" : "password"}
              autoComplete="new-password"
              minLength={8}
              placeholder="Digite a senha novamente"
              aria-invalid={passwordsMismatch}
              aria-describedby={confirmationStarted ? "password-confirmation-status" : undefined}
              onChange={(event) => {
                setPasswordDraft(passwordInputRef.current?.value ?? "");
                setConfirmationDraft(event.currentTarget.value);
              }}
              required
            />
            <PasswordVisibilityToggle visible={confirmationVisible} onToggle={() => setConfirmationVisible((visible) => !visible)} fieldLabel="confirmação da senha" />
          </div>
          {confirmationStarted ? (
            <p id="password-confirmation-status" className={`auth-password-status ${passwordsMatch ? "is-match" : "is-mismatch"}`} role="status">
              {passwordsMatch ? "As senhas coincidem." : "As senhas não coincidem."}
            </p>
          ) : null}
        </div>

        {state.message ? (
          <p className="auth-message" role="status">{state.message}</p>
        ) : null}

        <button className="auth-submit" type="submit" disabled={pending || passwordsMismatch}>
          {pending ? "Salvando…" : "Salvar e entrar"}
        </button>
      </form>

      <footer className="auth-card-footer">
        <Link href="/recuperar-senha">Pedir outro link</Link>
        <Link href="/privacidade">Privacidade e dados</Link>
      </footer>
    </div>
  );
}
