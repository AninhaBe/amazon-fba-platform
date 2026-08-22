import Link from "next/link";
import { Cable, LockKeyhole, Settings, UserRound } from "lucide-react";
import styles from "./SettingsPages.module.css";

type SettingsSection = "general" | "profile" | "integrations" | "privacy";

const groups = [
  {
    label: "Conta",
    links: [
      { id: "general" as const, href: "/configuracoes", label: "Geral", icon: Settings },
      { id: "profile" as const, href: "/perfil", label: "Perfil", icon: UserRound },
    ],
  },
  {
    label: "Dados",
    links: [
      { id: "integrations" as const, href: "/integracoes", label: "Integrações", icon: Cable },
      { id: "privacy" as const, href: "/privacidade", label: "Privacidade", icon: LockKeyhole },
    ],
  },
];

export function SettingsNavigation({ current }: { current: SettingsSection }) {
  return (
    <aside className={styles.navigation} aria-label="Configurações do NEXO">
      {groups.map((group) => (
        <div key={group.label} className={styles.navigationGroup}>
          <p className={styles.navigationLabel}>{group.label}</p>
          {group.links.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.id}
                href={link.href}
                className={styles.navigationLink}
                aria-current={current === link.id ? "page" : undefined}
              >
                <Icon aria-hidden />
                <span>{link.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
