import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  Cable,
  CalendarDays,
  ChevronRight,
  Clock3,
  CreditCard,
  LockKeyhole,
  LogOut,
  Mail,
  PackageSearch,
  ReceiptText,
} from "lucide-react";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import { getTrialFor } from "@/lib/trial";
import { LogoutButton } from "../../components/LogoutButton";
import { MarketplaceIcon, type MarketplaceIconProvider } from "../../components/MarketplaceIcon";
import { PageHeader } from "../../components/PageHeader";
import { SettingsNavigation } from "../../components/SettingsNavigation";
import { SettingsPreferences } from "../../components/SettingsPreferences";
import styles from "../../components/SettingsPages.module.css";
import { ProfileNameForm } from "../perfil/ProfileNameForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Configurações — NEXO",
  description: "Conta, plano, pagamento e preferências da sua operação no NEXO.",
};

const channelSettings: Array<{
  provider: Exclude<MarketplaceIconProvider, "sellercore">;
  label: string;
  href: string;
}> = [
  { provider: "amazon", label: "Amazon", href: "/amazon/produtos" },
  { provider: "mercado_livre", label: "Mercado Livre", href: "/mercado-livre/anuncios" },
  { provider: "shopee", label: "Shopee", href: "/shopee/produtos" },
  { provider: "tiktok_shop", label: "TikTok Shop", href: "/tiktok/produtos" },
];

function formatDateTime(value?: string | null) {
  if (!value) return "Não disponível";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Não disponível";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function formatDate(value?: string | null) {
  if (!value) return "Não disponível";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Não disponível";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export default async function ConfiguracoesPage() {
  if (!supabaseConfigured()) redirect("/login?next=/configuracoes");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login?next=/configuracoes");

  const user = data.user;
  const trial = await getTrialFor(user.id).catch(() => null);
  const rawName = user.user_metadata?.display_name ?? user.user_metadata?.full_name;
  const displayName = typeof rawName === "string" && rawName.trim() ? rawName.trim() : "Conta NEXO";
  const email = user.email ?? "E-mail não disponível";
  const initial = displayName.charAt(0) || "N";
  const accessName = trial ? "Avaliação NEXO" : "Acesso NEXO";
  const accessStatus = trial?.expired ? "Encerrado" : "Ativo";
  const accessDescription = trial
    ? trial.expired
      ? `O período de avaliação terminou em ${formatDate(trial.endsAt)}.`
      : `Acesso de avaliação liberado até ${formatDate(trial.endsAt)}.`
    : "Acesso ativo sem assinatura recorrente registrada no produto.";

  return (
    <div className={`${styles.page} analysis-page`}>
      <PageHeader
        eyebrow="Conta e produto"
        title="Configurações"
        subtitle="Gerencie sua identidade, acesso, plano e preferências do NEXO em um único lugar."
      />

      <div className={styles.shell}>
        <SettingsNavigation />

        <div className={styles.content}>
          <section className={styles.section} id="perfil" aria-labelledby="profile-title">
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
            <div className={styles.rows}>
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden><Mail /></span>
                <span className={styles.rowText}><strong>E-mail</strong><span>{email}</span></span>
                <span className={styles.rowValue}>{user.email_confirmed_at ? "Verificado" : "Confirmação pendente"}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden><CalendarDays /></span>
                <span className={styles.rowText}><strong>Conta criada</strong><span>Primeiro registro desta identidade no NEXO.</span></span>
                <span className={styles.rowValue}>{formatDateTime(user.created_at)}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden><Clock3 /></span>
                <span className={styles.rowText}><strong>Último acesso</strong><span>Última autenticação registrada para esta conta.</span></span>
                <span className={styles.rowValue}>{formatDateTime(user.last_sign_in_at)}</span>
              </div>
            </div>
          </section>

          <section className={styles.section} id="plano" aria-labelledby="plan-title">
            <header className={styles.sectionHeading}>
              <div>
                <p className="section-kicker">Conta</p>
                <h2 id="plan-title">Plano e pagamento</h2>
                <p>O NEXO mostra somente o acesso e a cobrança realmente registrados para esta conta.</p>
              </div>
            </header>
            <div className={styles.planSummary}>
              <span className={styles.planIcon} aria-hidden><ReceiptText /></span>
              <span className={styles.planText}>
                <strong>{accessName}</strong>
                <span>{accessDescription}</span>
              </span>
              <span className={styles.planStatus} data-tone={trial?.expired ? "danger" : "positive"}>{accessStatus}</span>
            </div>
            <div className={styles.rows}>
              {trial && (
                <div className={styles.row}>
                  <span className={styles.rowIcon} aria-hidden><CalendarDays /></span>
                  <span className={styles.rowText}>
                    <strong>Período de avaliação</strong>
                    <span>De {formatDate(trial.startsAt)} até {formatDate(trial.endsAt)}.</span>
                  </span>
                  <span className={styles.rowValue}>
                    {trial.expired ? "Encerrado" : `${Math.max(0, trial.daysLeft)} ${trial.daysLeft === 1 ? "dia restante" : "dias restantes"}`}
                  </span>
                </div>
              )}
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden><CreditCard /></span>
                <span className={styles.rowText}>
                  <strong>Método de pagamento</strong>
                  <span>Nenhum cartão ou conta de pagamento está cadastrado no NEXO.</span>
                </span>
                <span className={styles.rowValue}>Não configurado</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden><ReceiptText /></span>
                <span className={styles.rowText}>
                  <strong>Cobrança recorrente</strong>
                  <span>Não há assinatura, renovação automática ou próxima cobrança registrada.</span>
                </span>
                <a
                  href="mailto:contato.anabeatrizoliver@gmail.com?subject=Assinatura%20NEXO"
                  className={styles.rowAction}
                >
                  Falar sobre assinatura <ChevronRight />
                </a>
              </div>
            </div>
          </section>

          <section className={styles.section} id="preferencias" aria-labelledby="interface-title">
            <header className={styles.sectionHeading}>
              <div>
                <p className="section-kicker">Interface</p>
                <h2 id="interface-title">Navegação</h2>
                <p>Preferências salvas neste navegador, sem alterar os dados da operação.</p>
              </div>
            </header>
            <div className={styles.rows}>
              <SettingsPreferences />
            </div>
          </section>

          <section className={styles.section} id="operacao" aria-labelledby="operation-title">
            <header className={styles.sectionHeading}>
              <div>
                <p className="section-kicker">Operação</p>
                <h2 id="operation-title">Canais e custos</h2>
                <p>Conexões ficam centralizadas; custos e impostos continuam vinculados aos produtos de cada marketplace.</p>
              </div>
            </header>
            <div className={styles.rows}>
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden><Cable /></span>
                <span className={styles.rowText}>
                  <strong>Integrações</strong>
                  <span>Conecte, reconecte ou acompanhe o estado das contas de marketplace.</span>
                </span>
                <Link href="/integracoes" className={styles.rowAction}>Gerenciar <ChevronRight /></Link>
              </div>

              {channelSettings.map((channel) => (
                <div className={styles.row} key={channel.provider}>
                  <span className={styles.rowIcon} aria-hidden>
                    <MarketplaceIcon provider={channel.provider} size={18} app />
                  </span>
                  <span className={styles.rowText}>
                    <strong>Custos de produtos — {channel.label}</strong>
                    <span>Revise custo unitário e configuração fiscal sem transformar valor desconhecido em zero.</span>
                  </span>
                  <Link href={channel.href} className={styles.rowAction}>Abrir produtos <ChevronRight /></Link>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section} id="dados" aria-labelledby="data-title">
            <header className={styles.sectionHeading}>
              <div>
                <p className="section-kicker">Conta e dados</p>
                <h2 id="data-title">Privacidade e sessão</h2>
                <p>Consulte o tratamento dos dados ou encerre com segurança a sessão deste navegador.</p>
              </div>
            </header>
            <div className={styles.rows}>
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden><LockKeyhole /></span>
                <span className={styles.rowText}>
                  <strong>Política de Privacidade</strong>
                  <span>Finalidades, retenção, compartilhamento, segurança e direitos previstos na LGPD.</span>
                </span>
                <Link href="/privacidade" className={styles.rowAction}>Consultar <ChevronRight /></Link>
              </div>
              <div className={styles.row}>
                <span className={styles.rowIcon} aria-hidden><PackageSearch /></span>
                <span className={styles.rowText}>
                  <strong>Dados operacionais</strong>
                  <span>Catálogo, pedidos e financeiro permanecem separados por conta e normalizados pelo NEXO.</span>
                </span>
                <Link href="/" className={styles.rowAction}>Ver consolidado <ChevronRight /></Link>
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
