import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeCheck, Cable, CalendarDays, ChevronRight, Clock3, LockKeyhole, LogOut, Mail } from "lucide-react";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import { LogoutButton } from "../components/LogoutButton";
import { PageHeader } from "../components/PageHeader";
import { SettingsNavigation } from "../components/SettingsNavigation";
import styles from "../components/SettingsPages.module.css";
import { ProfileNameForm } from "./ProfileNameForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Perfil — NEXO",
  description: "Dados da sua conta e sessão no NEXO.",
};

function formatDate(value?: string | null) {
  if (!value) return "Não disponível";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Não disponível";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export default async function PerfilPage() {
  if (!supabaseConfigured()) redirect("/login?next=/perfil");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login?next=/perfil");

  const user = data.user;
  const rawName = user.user_metadata?.display_name ?? user.user_metadata?.full_name;
  const displayName = typeof rawName === "string" && rawName.trim() ? rawName.trim() : "Conta NEXO";
  const email = user.email ?? "E-mail não disponível";
  const initial = displayName.charAt(0) || "N";

  return (
    <div className={`${styles.page} analysis-page`}>
      <PageHeader
        eyebrow="Conta e produto"
        title="Perfil"
        subtitle="Identidade da conta, acesso e atalhos para os dados conectados ao seu workspace."
      />

      <div className={styles.shell}>
        <SettingsNavigation current="profile" />

        <div className={styles.content}>
          <section className={styles.section} aria-labelledby="profile-title">
            <div className={styles.profileSummary}>
              <span className={styles.avatar} aria-hidden>{initial}</span>
              <div>
                <h2 id="profile-title">{displayName}</h2>
                <p>{email}</p>
              </div>
              {user.email_confirmed_at && (
                <span className={styles.verified}><BadgeCheck aria-hidden /> E-mail verificado</span>
              )}
            </div>
            <ProfileNameForm defaultName={displayName} />
          </section>

          <section className={styles.section} aria-labelledby="account-title">
            <header className={styles.sectionHeading}>
              <div>
                <p className="section-kicker">Conta</p>
                <h2 id="account-title">Acesso e sessão</h2>
                <p>Informações confirmadas pelo provedor de autenticação do NEXO.</p>
              </div>
            </header>
            <div className={styles.rows}>
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden><Mail /></span>
                <span className={styles.rowText}><strong>E-mail</strong><span>{email}</span></span>
                <span className={styles.rowValue}>{user.email_confirmed_at ? "Verificado" : "Confirmação pendente"}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden><CalendarDays /></span>
                <span className={styles.rowText}><strong>Conta criada</strong><span>Primeiro registro desta identidade no NEXO.</span></span>
                <span className={styles.rowValue}>{formatDate(user.created_at)}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden><Clock3 /></span>
                <span className={styles.rowText}><strong>Último acesso</strong><span>Última autenticação registrada para esta conta.</span></span>
                <span className={styles.rowValue}>{formatDate(user.last_sign_in_at)}</span>
              </div>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="workspace-title">
            <header className={styles.sectionHeading}>
              <div>
                <p className="section-kicker">Workspace</p>
                <h2 id="workspace-title">Canais e dados</h2>
                <p>A identidade da conta é única; cada marketplace mantém conexão e dados operacionais separados.</p>
              </div>
            </header>
            <div className={styles.rows}>
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden><Cable /></span>
                <span className={styles.rowText}><strong>Integrações</strong><span>Revise as contas que alimentam este workspace.</span></span>
                <Link href="/integracoes" className={styles.rowAction}>Gerenciar <ChevronRight /></Link>
              </div>
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden><LockKeyhole /></span>
                <span className={styles.rowText}><strong>Privacidade</strong><span>Consulte tratamento, retenção e exclusão dos dados.</span></span>
                <Link href="/privacidade" className={styles.rowAction}>Consultar <ChevronRight /></Link>
              </div>
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden><LogOut /></span>
                <span className={styles.rowText}><strong>Encerrar sessão</strong><span>Remove a sessão deste navegador e volta para a entrada do NEXO.</span></span>
                <span className={styles.logoutInline}><LogoutButton /></span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
