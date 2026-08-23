"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn, signUp, type AuthActionState } from "./actions";

const initialState: AuthActionState = {};
const emailDomains = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com.br", "icloud.com"];

function suggestionsFor(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return [];

  const separator = trimmed.indexOf("@");
  const localPart = separator >= 0 ? trimmed.slice(0, separator) : trimmed;
  const domainPart = separator >= 0 ? trimmed.slice(separator + 1).toLocaleLowerCase("pt-BR") : "";
  if (!localPart) return [];

  return emailDomains
    .filter((domain) => !domainPart || domain.startsWith(domainPart))
    .map((domain) => `${localPart}@${domain}`)
    .filter((suggestion) => suggestion.toLocaleLowerCase("pt-BR") !== trimmed.toLocaleLowerCase("pt-BR"));
}

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

export function LoginForm() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [emailDraft, setEmailDraft] = useState("");
  const [emailSuggestionsOpen, setEmailSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [confirmationDraft, setConfirmationDraft] = useState("");
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const confirmationInputRef = useRef<HTMLInputElement>(null);
  const action = mode === "login" ? signIn : signUp;
  const [state, formAction, pending] = useActionState(action, initialState);
  const setupMissing = searchParams.get("setup") === "1";
  const confirmationFailed = searchParams.get("error") === "confirmation";
  const emailSuggestions = suggestionsFor(emailDraft);
  const suggestionsVisible = emailSuggestionsOpen && emailSuggestions.length > 0;
  const confirmationStarted = mode === "signup" && confirmationDraft.length > 0;
  const passwordsMatch = confirmationStarted && passwordDraft === confirmationDraft;
  const passwordsMismatch = confirmationStarted && passwordDraft !== confirmationDraft;

  function selectEmailSuggestion(suggestion: string) {
    if (emailInputRef.current) emailInputRef.current.value = suggestion;
    setEmailDraft(suggestion);
    setEmailSuggestionsOpen(false);
    setActiveSuggestion(0);
    emailInputRef.current?.focus();
  }

  return (
    <div className="auth-card">
      <header className="auth-card-heading">
        <h2>{mode === "login" ? "Acesse seu workspace" : "Crie seu workspace"}</h2>
        <p>{mode === "login" ? "Continue de onde sua operação parou." : "Comece com uma conta individual e conecte seus canais depois."}</p>
      </header>
      <div className="auth-tabs" role="tablist" aria-label="Acesso ao NEXO">
        <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "is-active" : ""} onClick={() => {
          setMode("login");
          setConfirmationDraft("");
          setConfirmationVisible(false);
        }}>Entrar</button>
        <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "is-active" : ""} onClick={() => {
          setMode("signup");
          setPasswordDraft(passwordInputRef.current?.value ?? "");
        }}>Criar conta</button>
      </div>

      <form
        action={formAction}
        className="auth-form"
        onSubmit={(event) => {
          if (mode !== "signup") return;
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
        <input type="hidden" name="next" value={searchParams.get("next") ?? ""} />
        <label htmlFor="email">E-mail</label>
        <div className="auth-email-combobox">
          <input
            ref={emailInputRef}
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="voce@empresa.com"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggestionsVisible}
            aria-controls="email-domain-suggestions"
            aria-activedescendant={suggestionsVisible ? `email-suggestion-${activeSuggestion}` : undefined}
            onFocus={(event) => {
              setEmailDraft(event.currentTarget.value);
              setEmailSuggestionsOpen(true);
            }}
            onBlur={() => setEmailSuggestionsOpen(false)}
            onChange={(event) => {
              setEmailDraft(event.currentTarget.value);
              setEmailSuggestionsOpen(true);
              setActiveSuggestion(0);
            }}
            onKeyDown={(event) => {
              if (!emailSuggestions.length) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setEmailSuggestionsOpen(true);
                setActiveSuggestion((current) => (current + 1) % emailSuggestions.length);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setEmailSuggestionsOpen(true);
                setActiveSuggestion((current) => (current - 1 + emailSuggestions.length) % emailSuggestions.length);
              } else if (event.key === "Enter" && suggestionsVisible) {
                event.preventDefault();
                selectEmailSuggestion(emailSuggestions[activeSuggestion]);
              } else if (event.key === "Escape") {
                setEmailSuggestionsOpen(false);
              }
            }}
            required
          />
          {suggestionsVisible ? (
            <div className="auth-email-suggestions" id="email-domain-suggestions" role="listbox" aria-label="Completar endereço de e-mail">
              {emailSuggestions.map((suggestion, index) => (
                <button
                  key={suggestion}
                  id={`email-suggestion-${index}`}
                  type="button"
                  role="option"
                  aria-selected={activeSuggestion === index}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveSuggestion(index)}
                  onClick={() => selectEmailSuggestion(suggestion)}
                >
                  <span>{suggestion.slice(0, suggestion.indexOf("@"))}</span>
                  <strong>{suggestion.slice(suggestion.indexOf("@"))}</strong>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <label htmlFor="password">Senha</label>
        <div className="auth-password-field">
          <input ref={passwordInputRef} id="password" name="password" type={passwordVisible ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} placeholder="Mínimo de 8 caracteres" onChange={(event) => setPasswordDraft(event.currentTarget.value)} required />
          <PasswordVisibilityToggle visible={passwordVisible} onToggle={() => setPasswordVisible((visible) => !visible)} fieldLabel="senha" />
        </div>

        {mode === "signup" ? (
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
        ) : null}

        {(setupMissing || confirmationFailed || state.message) && (
          <p className={state.success ? "auth-message is-success" : "auth-message"} role="status">
            {setupMissing
              ? "O acesso está bloqueado até as credenciais do Supabase serem configuradas no Render."
              : confirmationFailed
                ? "Não foi possível confirmar esse acesso. Solicite um novo cadastro ou tente novamente."
                : state.message}
          </p>
        )}

        <button className="auth-submit" type="submit" disabled={pending || setupMissing || passwordsMismatch}>
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
