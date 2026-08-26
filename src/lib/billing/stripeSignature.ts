import crypto from "node:crypto";

// Verificação do header `Stripe-Signature`, esquema v1.
//
// O header chega assim: `t=1724688000,v1=<hex>,v1=<hex>`. O `t` é o instante em
// que a Stripe assinou, e o que ela assina é `${t}.${corpo bruto}` com
// HMAC-SHA256 usando o segredo do endpoint. Podem vir vários `v1` durante uma
// rotação de segredo — basta um bater.
//
// Duas coisas que este módulo NÃO faz de propósito:
//   - não aceita corpo já parseado. O HMAC é sobre os bytes exatos que chegaram;
//     `JSON.parse` seguido de `JSON.stringify` reordena chaves e troca escapes,
//     e a assinatura passa a não fechar nunca.
//   - não cai para "sem segredo, deixa passar". Sem `STRIPE_WEBHOOK_SECRET` o
//     endpoint fica fechado: qualquer um saberia o formato do evento e liberaria
//     acesso pago com um curl.

/** Janela aceita entre o carimbo da Stripe e o relógio daqui. */
export const TOLERANCIA_PADRAO_SEGUNDOS = 300;

export class AssinaturaStripeInvalida extends RangeError {
  constructor(motivo: string) {
    super(motivo);
    this.name = "AssinaturaStripeInvalida";
  }
}

const HEX_SHA256 = /^[0-9a-f]{64}$/i;

interface CabecalhoStripe {
  timestamp: number;
  assinaturas: string[];
}

function lerCabecalho(cabecalho: string): CabecalhoStripe {
  let timestamp = Number.NaN;
  const assinaturas: string[] = [];
  for (const parte of cabecalho.split(",")) {
    const igual = parte.indexOf("=");
    if (igual < 0) continue;
    const chave = parte.slice(0, igual).trim();
    const valor = parte.slice(igual + 1).trim();
    if (chave === "t") timestamp = Number(valor);
    else if (chave === "v1" && HEX_SHA256.test(valor)) assinaturas.push(valor.toLowerCase());
  }
  if (!Number.isFinite(timestamp)) throw new AssinaturaStripeInvalida("Assinatura sem carimbo de tempo.");
  if (!assinaturas.length) throw new AssinaturaStripeInvalida("Assinatura sem esquema v1 reconhecível.");
  return { timestamp, assinaturas };
}

function confere(esperada: string, recebida: string): boolean {
  const a = Buffer.from(esperada, "hex");
  const b = Buffer.from(recebida, "hex");
  // Comprimentos diferentes fazem timingSafeEqual lançar; o regex acima já
  // garante 32 bytes dos dois lados, mas a checagem mantém a função total.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface EntradaAssinatura {
  /** Corpo EXATO recebido, sem reserializar. */
  corpo: string;
  cabecalho: string | null | undefined;
  segredo: string;
  toleranciaSegundos?: number;
  /** Injetável para teste; em produção é o relógio do processo. */
  agora?: number;
}

/**
 * Lança `AssinaturaStripeInvalida` quando o corpo não foi assinado por quem tem
 * o segredo, ou quando o carimbo está fora da janela (defesa contra replay de
 * um evento legítimo capturado antes).
 */
export function verificarAssinaturaStripe(entrada: EntradaAssinatura): void {
  const { corpo, cabecalho, segredo } = entrada;
  if (!segredo) throw new AssinaturaStripeInvalida("Segredo do webhook não configurado.");
  if (!cabecalho?.trim()) throw new AssinaturaStripeInvalida("Requisição sem cabeçalho Stripe-Signature.");

  const { timestamp, assinaturas } = lerCabecalho(cabecalho);
  const tolerancia = entrada.toleranciaSegundos ?? TOLERANCIA_PADRAO_SEGUNDOS;
  const agora = entrada.agora ?? Date.now();
  const distancia = Math.abs(Math.floor(agora / 1000) - timestamp);
  if (distancia > tolerancia) {
    throw new AssinaturaStripeInvalida("Assinatura fora da janela de tolerância.");
  }

  const esperada = crypto
    .createHmac("sha256", segredo)
    .update(`${timestamp}.${corpo}`, "utf8")
    .digest("hex");
  if (!assinaturas.some((recebida) => confere(esperada, recebida))) {
    throw new AssinaturaStripeInvalida("Assinatura não confere com o segredo do endpoint.");
  }
}
