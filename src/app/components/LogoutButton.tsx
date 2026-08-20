import { signOut } from "../login/actions";

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  return (
    <form action={signOut} className={compact ? "logout-form is-compact" : "logout-form"}>
      <button type="submit" title="Sair do NEXO" aria-label="Sair do NEXO">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M14 8l4 4-4 4M9 12h9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {!compact && <span>Sair</span>}
      </button>
    </form>
  );
}
