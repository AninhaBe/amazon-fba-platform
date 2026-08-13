import Link from "next/link";

// Aviso de conexão quebrada com o canal, no lugar do erro genérico.
//
// Existe porque o app já sabia o diagnóstico ("reconecte a conta") mas mostrava
// "Não foi possível abrir esta área" — o que faz procurar problema no
// marketplace quando a causa é autorização revogada deste lado.

export type BrokenChannel = "amazon" | "mercado_livre" | "shopee" | "tiktok_shop";

const RECONNECT: Record<BrokenChannel, { href: string; label: string }> = {
  amazon: { href: "/api/auth/login", label: "Reconectar conta Amazon" },
  mercado_livre: { href: "/api/integrations/mercado-livre/connect", label: "Reconectar Mercado Livre" },
  shopee: { href: "/api/integrations/shopee/connect", label: "Reconectar Shopee" },
  tiktok_shop: { href: "/api/tiktok/login", label: "Reconectar TikTok Shop" },
};

export function ConnectionBroken({
  channel,
  message,
  compact = false,
}: {
  channel: BrokenChannel;
  /** Mensagem do servidor; um texto padrão cobre quando ela não vem. */
  message?: string | null;
  compact?: boolean;
}) {
  const action = RECONNECT[channel];
  return (
    <div role="alert" className={`connection-broken${compact ? " is-compact" : ""}`}>
      <div className="connection-broken-copy">
        <p className="connection-broken-title">Conexão com o canal expirou</p>
        <p className="connection-broken-text">
          {message || "A autorização foi revogada ou perdeu a validade. Os dados já sincronizados continuam aqui; para voltar a receber novidades, refaça a conexão."}
        </p>
      </div>
      <Link href={action.href} className="connection-broken-action">
        {action.label} <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

/** Códigos de erro da API que significam "precisa reconectar". */
const BROKEN_CODES = new Set(["AMAZON_AUTH_EXPIRED", "AMAZON_FORBIDDEN", "CHANNEL_AUTH_EXPIRED", "REAUTH_REQUIRED"]);

export function isBrokenConnection(code?: string | null): boolean {
  return !!code && BROKEN_CODES.has(code);
}
