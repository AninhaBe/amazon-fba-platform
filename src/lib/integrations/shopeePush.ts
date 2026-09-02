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
/**
 * A URL QUE ENTRA NA BASE STRING — a PÚBLICA, nunca a que a requisição carrega.
 *
 * 🔴 FOI ISTO QUE QUEBROU O PRIMEIRO VERIFY (02/09/2026), e o diagnóstico cravou:
 *
 *   urlQueRecebemos = "https://0.0.0.0:3000/api/webhooks/shopee"
 *
 * `req.nextUrl.href` é o endereço INTERNO da máquina atrás do proxy do Fly. A
 * Shopee assina a URL pública que está cadastrada no console. Assinando hosts
 * diferentes, o HMAC nunca bate — por mais certa que esteja a fórmula, e por
 * mais certa que esteja a chave.
 *
 * 📌 E é por isso que `chaveQueBateria: null` na primeira tentativa NÃO era
 * conclusão sobre a chave: com a base string errada, nenhuma das combinações
 * poderia bater. Diagnóstico que testa a coisa errada responde "nada bate" com
 * a mesma cara de "está tudo errado".
 *
 * ⚠️ CONSTANTE, e não derivada da requisição, de propósito: aceitar o host do
 * pedido deixaria um atacante escolher a base string, e aí ele assina a própria
 * URL com uma chave que ele conhece. A URL da assinatura tem de ser a que NÓS
 * cadastramos, não a que o chamador diz ter usado.
 */
export function urlPublicaDoPush() {
  const base = process.env.APP_BASE_URL?.replace(/\/+$/, "") || "https://nexoaihub.com.br";
  return `${base}/api/webhooks/shopee`;
}

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

/**
 * O SEGREDO É A STRING DA CHAVE, COMO CONFIGURADA.
 *
 * ⚠️ AQUI ESTEVE UM `Buffer.from(chave, "hex")` POR MEIA HORA, e ele nasceu de um
 * ARTEFATO — vale registrar porque a armadilha é boa demais para esquecer.
 *
 * A chave da Shopee é `shpk` + 60 caracteres hex. Ela **não é hex puro**, e
 * `Buffer.from("shpk…", "hex")` não falha: o Node **trunca no primeiro par
 * inválido e devolve um buffer VAZIO**, em silêncio. HMAC com chave vazia é uma
 * função perfeitamente determinística — e foi ela que reproduziu a assinatura
 * do verify, completa, byte a byte.
 *
 * A conclusão parecia "a chave precisa ser hex-decodificada". A verdade é outra:
 * **a Shopee assinou com a push key ARMAZENADA NELA, que estava vazia porque a
 * chave gerada nunca foi salva.** A fórmula oficial (`url|corpo`, hex,
 * `Authorization`) estava certa desde o início.
 *
 * 📌 A LIÇÃO: uma coincidência que "bate perfeitamente" é evidência forte de que
 * as duas pontas fazem a MESMA coisa — inclusive a mesma coisa ERRADA. Chave
 * vazia dos dois lados bate 100%, e não prova nada sobre a chave.
 */
/**
 * O PING DE VERIFICAÇÃO do console — o único corpo que pode passar com a chave
 * do APP em vez da chave de push.
 *
 * ⚠️ E a exceção é estreita de propósito: este corpo **não carrega dado nenhum**
 * (nem loja, nem pedido) e a rota não escreve nada ao processá-lo. O que ele
 * precisa é de um 200 para o console cadastrar a URL. Push de DADOS continua
 * exigindo exclusivamente a push key — a separação de superfícies que a Shopee
 * criou fica intacta: chave de API comprometida não permite forjar um evento.
 */
export function ehPingDeVerificacao(corpo: unknown): boolean {
  if (typeof corpo !== "object" || corpo === null) return false;
  const raiz = corpo as Record<string, unknown>;
  const dados = (typeof raiz.data === "object" && raiz.data !== null ? raiz.data : {}) as Record<string, unknown>;
  // Tem `verify_info` E não tem identidade de pedido: as duas condições, senão
  // bastaria acrescentar `verify_info` a um push forjado para escapar da push key.
  return typeof dados.verify_info === "string"
    && raiz.shop_id == null && dados.shop_id == null
    && dados.ordersn == null && dados.order_sn == null;
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
   * Preenchido só quando `valida` é falso E alguma combinação bateria. É o
   * diagnóstico que evita a caça ao tesouro — nunca autoriza nada.
   *
   * ⚠️ INCLUI QUAL CHAVE, e não só qual fórmula, desde 02/09/2026: no primeiro
   * Verify real as quatro fórmulas deram `null` com a push key. A hipótese mais
   * forte é que a Shopee assinou o teste com a `partner_key` do app — a única
   * que ela tem persistida enquanto a push key gerada não foi salva. Sem testar
   * as duas chaves, o diagnóstico não distingue "fórmula errada" de "chave
   * errada", e essas duas causas pedem ações opostas.
   */
  formulaQueBateria: string | null;
  chaveQueBateria: "push" | "app" | "vazia" | null;
}

export interface ChavesDoPush {
  /**
   * `SHOPEE_PUSH_PARTNER_KEY` — a gerada no console. **A única que autoriza
   * push de DADO**, sem exceção.
   */
  push: string | null | undefined;
}

export function verificarAssinaturaDoPush(entrada: {
  url: string;
  corpoBruto: string;
  assinatura: string | null;
  chaves: ChavesDoPush;
  /** `true` só para o corpo do ping de verificação, que não carrega dado. */
  ehPing?: boolean;
}): ResultadoDaAssinatura {
  const { url, corpoBruto, assinatura, chaves } = entrada;
  if (!assinatura) return { valida: false, formulaQueBateria: null, chaveQueBateria: null };

  const [oficial, ...diagnosticas] = FORMULAS;
  const base = oficial.base(url, corpoBruto);

  // ═══ DADO: EXCLUSIVAMENTE A PUSH KEY CONFIGURADA ═══════════════════════════
  //
  // 🔴 O `chaves.push &&` É A LINHA MAIS IMPORTANTE DESTE ARQUIVO. Sem ela, uma
  // push key ausente cairia em chave VAZIA — e chave vazia é conhecida por
  // qualquer pessoa do planeta. Seria porta escancarada: qualquer um assinaria
  // um push forjado e escreveria pedido no canônico.
  if (chaves.push && iguais(assinar(chaves.push, base), assinatura)) {
    return { valida: true, formulaQueBateria: null, chaveQueBateria: "push" };
  }

  // ═══ PING DE VERIFICAÇÃO: a chave VAZIA também vale ════════════════════════
  //
  // Antes do Save, a Shopee assina com a push key ARMAZENADA NELA — que está
  // vazia, porque a chave gerada no formulário ainda não foi persistida. Depois
  // do Save ela passa a assinar com a chave de verdade, e o ramo acima resolve.
  //
  // ⚠️ Aceitar chave vazia aqui é seguro por DOIS motivos SOMADOS, e é a soma
  // que importa: este corpo não carrega loja nem pedido (`ehPingDeVerificacao`
  // exige a ausência dos dois), e a rota não escreve nada ao processá-lo. Quem
  // forjar este ping ganha um 200 vazio.
  if (entrada.ehPing && iguais(assinar("", base), assinatura)) {
    return { valida: true, formulaQueBateria: null, chaveQueBateria: "vazia" };
  }

  // Diagnóstico: nomeia, nunca autoriza.
  for (const candidata of [oficial, ...diagnosticas]) {
    for (const [rotulo, chave] of [["push", chaves.push], ["vazia", ""]] as const) {
      if (chave == null) continue;
      if (iguais(assinar(chave, candidata.base(url, corpoBruto)), assinatura)) {
        return { valida: false, formulaQueBateria: candidata.nome, chaveQueBateria: rotulo };
      }
    }
  }
  return { valida: false, formulaQueBateria: null, chaveQueBateria: null };
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

/**
 * ⚠️ A MATRIZ DE DIAGNÓSTICO FOI REMOVIDA EM 02/09/2026, e o motivo é o certo:
 * **ela respondeu a pergunta que existia para responder.**
 *
 * O primeiro push real chegou às 19:12:02Z e foi aceito pela fórmula oficial —
 * `url|corpo`, HMAC-SHA256 hex no header `Authorization`, com a push key **como
 * string**. Sem hex-decode, sem variante. Confirmado pelo efeito, não pelo log:
 * dois pedidos entraram pelo caminho canônico e `last_push_at` carimbou.
 *
 * 📌 Ela sai porque ferramenta de investigação que sobrevive à investigação vira
 * peso morto — 168 combinações de HMAC por requisição recusada, num endpoint
 * público, é superfície e custo sem pergunta em aberto. É a mesma regra da
 * recusa temporária: o que existe por causa de uma limitação morre com ela.
 *
 * O que FICA é o diagnóstico curto (`formulaQueBateria`/`chaveQueBateria`), que
 * é barato e responde "mudaram a assinatura?" no dia em que o canal emudecer.
 */
