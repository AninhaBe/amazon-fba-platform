"use client";

import { useEffect, useState } from "react";
import { PanelLeft, RotateCcw } from "lucide-react";
import {
  NAV_GROUPS_COLLAPSED_KEY,
  NAV_SUBGROUPS_OPEN_KEY,
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_PREFERENCE_EVENT,
  type SidebarPreferenceDetail,
} from "@/lib/navigationPreferences";
import styles from "./SettingsPages.module.css";

export function SettingsPreferences() {
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
      } catch {
        setCollapsed(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function applySidebar(nextCollapsed: boolean) {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, nextCollapsed ? "1" : "0");
    } catch {
      setMessage("O navegador não permitiu salvar esta preferência.");
      return;
    }
    setCollapsed(nextCollapsed);
    window.dispatchEvent(
      new CustomEvent<SidebarPreferenceDetail>(SIDEBAR_PREFERENCE_EVENT, {
        detail: { collapsed: nextCollapsed },
      })
    );
    setMessage(nextCollapsed ? "Menu compacto aplicado." : "Menu expandido aplicado.");
  }

  function resetNavigation() {
    try {
      localStorage.removeItem(NAV_GROUPS_COLLAPSED_KEY);
      localStorage.removeItem(NAV_SUBGROUPS_OPEN_KEY);
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "0");
    } catch {
      setMessage("O navegador não permitiu restaurar as preferências.");
      return;
    }
    setCollapsed(false);
    window.dispatchEvent(
      new CustomEvent<SidebarPreferenceDetail>(SIDEBAR_PREFERENCE_EVENT, {
        detail: { collapsed: false },
      })
    );
    setMessage("Navegação restaurada ao padrão do NEXO.");
  }

  return (
    <>
      <div className={styles.row}>
        <span className={styles.rowIcon} aria-hidden><PanelLeft /></span>
        <span className={styles.rowText}>
          <strong>Largura do menu lateral</strong>
          <span>Esta preferência fica somente neste navegador.</span>
        </span>
        <span className={styles.preferenceControl} aria-label="Largura do menu lateral">
          <button type="button" aria-pressed={collapsed === false} onClick={() => applySidebar(false)}>Expandido</button>
          <button type="button" aria-pressed={collapsed === true} onClick={() => applySidebar(true)}>Compacto</button>
        </span>
      </div>
      <div className={styles.row}>
        <span className={styles.rowIcon} aria-hidden><RotateCcw /></span>
        <span className={styles.rowText}>
          <strong>Restaurar navegação</strong>
          <span>Reabre os grupos padrão e remove escolhas locais de menu.</span>
        </span>
        <button type="button" className={styles.secondaryAction} onClick={resetNavigation}>
          Restaurar
        </button>
      </div>
      <p className={styles.statusMessage} role="status" aria-live="polite">{message}</p>
    </>
  );
}
