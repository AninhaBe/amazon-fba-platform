"use client";

import { useActionState } from "react";
import { updateProfile, type ProfileActionState } from "./actions";
import styles from "../../components/SettingsPages.module.css";

const initialState: ProfileActionState = {};

export function ProfileNameForm({ defaultName }: { defaultName: string }) {
  const [state, formAction, pending] = useActionState(updateProfile, initialState);

  return (
    <form action={formAction} className={styles.profileForm}>
      <label htmlFor="displayName">Nome de exibição</label>
      <input
        id="displayName"
        name="displayName"
        type="text"
        defaultValue={defaultName}
        minLength={2}
        maxLength={80}
        autoComplete="name"
        required
      />
      <button type="submit" className={styles.primaryAction} disabled={pending}>
        {pending ? "Salvando…" : "Salvar nome"}
      </button>
      <p className={styles.formMessage} data-tone={state.tone} role="status" aria-live="polite">
        {state.message ?? "Este nome aparece nas áreas de conta do NEXO."}
      </p>
    </form>
  );
}
