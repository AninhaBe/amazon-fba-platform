/**
 * Criação da sessão de pagamento — HTTP direto, sem SDK.
 *
 * ⚠️ O PREÇO NÃO MORA AQUI, por ordem da dona do produto (07/09/2026). Nós
 * mandamos o `price` que a Stripe já conhece e ela responde quanto custa. Uma
 * constante nossa seria uma segunda fonte da verdade sobre dinheiro: no dia em
 * que o preço mudasse no painel, a tela mentiria — e mentira sobre preço não
 * é divergência, é defeito.
 */
export interface SessaoDeCheckout {
  url: string;
  id: string;
}

export function checkoutConfigurado(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

export async function criarSessaoDeCheckout(entrada: {
  email: string | null;
  workspaceId: string;
  baseUrl: string;
}): Promise<SessaoDeCheckout> {
  const chave = process.env.STRIPE_SECRET_KEY;
  const preco = process.env.STRIPE_PRICE_ID;
  if (!chave || !preco) throw new Error("Checkout não configurado: falta STRIPE_SECRET_KEY ou STRIPE_PRICE_ID.");

  const corpo = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": preco,
    "line_items[0][quantity]": "1",
    success_url: `${entrada.baseUrl}/reativar?pago=1`,
    cancel_url: `${entrada.baseUrl}/reativar?cancelado=1`,
    // O webhook acha a conta por e-mail quando ainda não há cliente Stripe
    // gravado. Sem isto, um pagamento de conta nova não teria como ser ligado
    // a ninguém — e o evento cairia como "conta não encontrada".
    client_reference_id: entrada.workspaceId,
    "metadata[workspaceId]": entrada.workspaceId,
  });
  if (entrada.email) corpo.set("customer_email", entrada.email);

  const resposta = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${chave}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: corpo,
  });
  const dados = (await resposta.json().catch(() => null)) as { url?: string; id?: string; error?: { message?: string } } | null;
  if (!resposta.ok || !dados?.url || !dados?.id) {
    throw new Error(`Stripe respondeu ${resposta.status}: ${dados?.error?.message ?? "sessão sem url"}`);
  }
  return { url: dados.url, id: dados.id };
}
