import { createHmac, timingSafeEqual } from "crypto";

/**
 * PUSH DA SHOPEE — verificação de assinatura e leitura do evento.
 *
 * ⚠️ A CHAVE DO PUSH **NÃO É** A `SHOPEE_PARTNER_KEY`. É uma chave própria,
 * gerada no botão "Generate" do formulário *Set Push* do console
 * (`Live Push Partner Key`), e mora em `SHOPEE_PUSH_PARTNER_KEY`. Medido no
 * console com a dona do produto em 02/09/2026 — eu tinha ASSUMIDO que era a
 * mesma, e assunção não é medição.
 *
 * 📌 E a separação é boa de propósito: chave de push comprometida não dá acesso
 * à API, e chave de API comprometida não permite forjar push. Duas superfícies.
 *
 * ⚠️ SEM A CHAVE CONFIGURADA, O ENDPOINT É FECHADO — rejeita tudo, não aceita
 * nada, não escreve nada. Nascer fechado é melhor que nascer ecoando: um
 * endpoint que responde 200 para qualquer um enquanto espera configuração é uma
 * porta aberta com prazo que ninguém garante.
 */

/**
 * As formas candidatas da base string do HMAC.
 *
 * ⚠️ POR QUE HÁ MAIS DE UMA, E POR QUE ISSO **NÃO** AFROUXA A VERIFICAÇÃO: a
 * documentação oficial não é alcançável do ambiente onde isto foi escrito, o
 * doc interno nunca registrou o formato (o push nunca existiu aqui), e as fontes
 * de terceiro se contradizem — umas dizem `url|corpo` no header `Authorization`,
 * outras dizem só o corpo em `x-shopee-signature`.
 *
 * Chutar tem dois modos de falha ruins: rejeitar todo push real (o canal fica
 * mudo e ninguém entende por quê) ou aceitar o que não devia.
 *
 * A saída: **só a PRIMEIRA da lista autoriza**. As demais existem apenas para o
 * diagnóstico — quando a verificação falha, o log diz qual delas *teria* batido,
 * e a resposta continua sendo 401. Assim o primeiro push real nos entrega o
 * formato certo em vez de virar caça ao tesouro, e em nenhum momento aceitamos
 * requisição não verificada.
 */
export const FORMULAS: Array<{ nome: string; base: (url: string, corpo: string) => string }> = [
  { nome: "url|corpo", base: (url, corpo) => `${url}|${corpo}` },
  { nome: "corpo", base: (_url, corpo) => corpo },
  { nome: "caminho|corpo", base: (url, corpo) => `${caminhoDe(url)}|${corpo}` },
  { nome: "url+corpo", base: (url, corpo) => `${url}${corpo}` },
];

function caminhoDe(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function assinar(chave: string, base: string) {
  return createHmac("sha256", chave).update(base, "utf8").digest("hex");
}

/** Comparação em tempo constante — igualdade de string vaza o prefixo correto. */
function iguais(a: string, b: string) {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export interface ResultadoDaAssinatura {
  valida: boolean;
  /**
   * Preenchido só quando `valida` é falso E alguma candidata bateria. É o
   * diagnóstico que evita a caça ao tesouro — nunca autoriza nada.
   */
  formulaQueBateria: string | null;
}

export function verificarAssinaturaDoPush(entrada: {
  url: string;
  corpoBruto: string;
  assinatura: string | null;
  chave: string | null | undefined;
}): ResultadoDaAssinatura {
  const { url, corpoBruto, assinatura, chave } = entrada;
  if (!chave || !assinatura) return { valida: false, formulaQueBateria: null };

  const [oficial, ...diagnosticas] = FORMULAS;
  if (iguais(assinar(chave, oficial.base(url, corpoBruto)), assinatura)) {
    return { valida: true, formulaQueBateria: null };
  }
  for (const candidata of diagnosticas) {
    if (iguais(assinar(chave, candidata.base(url, corpoBruto)), assinatura)) {
      return { valida: false, formulaQueBateria: candidata.nome };
    }
  }
  return { valida: false, formulaQueBateria: null };
}

/**
 * O evento do push, reduzido ao que precisamos.
 *
 * ⚠️ O PUSH **NÃO** É A FONTE DO DADO — ele é o AVISO. O corpo traz o estado no
 * momento do evento, e usá-lo para escrever o pedido criaria um segundo caminho
 * de escrita ao lado da varredura. Dois caminhos é como os dois divergem: o
 * push escreveria um formato e o poll outro, e a diferença apareceria semanas
 * depois como número que não bate.
 *
 * Por isso só extraímos a IDENTIDADE (qual loja, qual pedido). O conteúdo vem
 * de `get_order_detail`, pelo mesmo caminho canônico que a varredura usa.
 */
export interface EventoDePush {
  shopId: string;
  orderSn: string;
  /** Código do tipo de push (3 = order status, na numeração da Shopee). */
  code: number | null;
  /** Status do pedido no momento do evento — só para a chave de dedupe. */
  status: string | null;
  timestamp: number | null;
}

export function interpretarPush(corpo: unknown): EventoDePush | null {
  if (typeof corpo !== "object" || corpo === null) return null;
  const raiz = corpo as Record<string, unknown>;
  const dados = (typeof raiz.data === "object" && raiz.data !== null
    ? raiz.data
    : {}) as Record<string, unknown>;

  const shopId = raiz.shop_id ?? dados.shop_id;
  const orderSn = dados.ordersn ?? dados.order_sn ?? raiz.ordersn ?? raiz.order_sn;
  if (shopId == null || orderSn == null) return null;

  const status = dados.status ?? dados.order_status;
  const timestamp = raiz.timestamp;
  return {
    shopId: String(shopId),
    orderSn: String(orderSn),
    code: typeof raiz.code === "number" ? raiz.code : null,
    status: status == null ? null : String(status),
    timestamp: typeof timestamp === "number" ? timestamp : null,
  };
}

/**
 * Chave de dedupe.
 *
 * ⚠️ INCLUI O STATUS: a Shopee reentrega o MESMO pedido a cada mudança de
 * estado, e cada mudança é um evento legítimo que precisa ser processado. Uma
 * chave só com `order_sn` engoliria a transição de UNPAID para pago — que é
 * exatamente o evento que a decisão de 02/09 tornou o mais importante do canal.
 *
 * O `timestamp` fica de fora: reentrega do MESMO evento (a Shopee reenvia
 * quando não confirmamos a tempo) traria timestamp novo e escaparia do dedupe.
 */
export function chaveDoEvento(evento: EventoDePush) {
  return `shopee:${evento.shopId}:${evento.orderSn}:${evento.status ?? "sem-status"}`;
}
