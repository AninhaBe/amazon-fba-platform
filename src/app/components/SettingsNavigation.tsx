import Link from "next/link";
import { Cable, CreditCard, LockKeyhole, PanelLeft, SlidersHorizontal, UserRound } from "lucide-react";
import styles from "./SettingsPages.module.css";

const groups = [
  {
    label: "Conta",
    links: [
      { href: "#perfil", label: "Perfil", icon: UserRound },
      { href: "#plano", label: "Plano e pagamento", icon: CreditCard },
    ],
  },
  {
    label: "Produto",
    links: [
      { href: "#preferencias", label: "Navegação", icon: PanelLeft },
      { href: "#operacao", label: "Canais e custos", icon: SlidersHorizontal },
    ],
  },
  {
    label: "Dados",
    links: [
      { href: "/integracoes", label: "Integrações", icon: Cable },
      { href: "/privacidade", label: "Privacidade", icon: LockKeyhole },
    ],
  },
];

export function SettingsNavigation() {
  return (
    <aside className={styles.navigation} aria-label="Configurações do NEXO">
      {groups.map((group) => (
        <div key={group.label} className={styles.navigationGroup}>
          <p className={styles.navigationLabel}>{group.label}</p>
          {group.links.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={styles.navigationLink}
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
