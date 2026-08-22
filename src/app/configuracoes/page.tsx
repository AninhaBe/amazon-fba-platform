import type { Metadata } from "next";
import Link from "next/link";
import { Cable, ChevronRight, LockKeyhole, PackageSearch } from "lucide-react";
import { MarketplaceIcon, type MarketplaceIconProvider } from "../components/MarketplaceIcon";
import { PageHeader } from "../components/PageHeader";
import { SettingsNavigation } from "../components/SettingsNavigation";
import { SettingsPreferences } from "../components/SettingsPreferences";
import styles from "../components/SettingsPages.module.css";

export const metadata: Metadata = {
  title: "Configurações — NEXO",
  description: "Preferências de interface, canais e dados da sua operação no NEXO.",
};

const channelSettings: Array<{
  provider: Exclude<MarketplaceIconProvider, "sellercore">;
  label: string;
  href: string;
}> = [
  { provider: "amazon", label: "Amazon", href: "/amazon/produtos" },
  { provider: "mercado_livre", label: "Mercado Livre", href: "/mercado-livre/produtos" },
  { provider: "shopee", label: "Shopee", href: "/shopee/produtos" },
  { provider: "tiktok_shop", label: "TikTok Shop", href: "/tiktok/produtos" },
];

export default function ConfiguracoesPage() {
  return (
    <div className={`${styles.page} analysis-page`}>
      <PageHeader
        eyebrow="Conta e produto"
        title="Configurações"
        subtitle="Ajuste a experiência do NEXO e acesse as configurações operacionais de cada canal."
      />

      <div className={styles.shell}>
        <SettingsNavigation current="general" />

        <div className={styles.content}>
          <section className={styles.section} aria-labelledby="interface-title">
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

          <section className={styles.section} aria-labelledby="operation-title">
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

          <section className={styles.section} aria-labelledby="data-title">
            <header className={styles.sectionHeading}>
              <div>
                <p className="section-kicker">Conta e dados</p>
                <h2 id="data-title">Privacidade</h2>
                <p>Consulte como o NEXO trata, protege e exclui os dados da sua operação.</p>
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
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
