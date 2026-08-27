import crypto from "crypto";

// Convite de autorização do TikTok Shop.
//
// O custom app é distribuído por link privado: o vendedor recebe a URL, autoriza
// na TikTok e volta no callback — **sem ter sessão no NEXO**. O fluxo com
// cookie de CSRF não serve aqui, porque o cookie viveria no navegador de quem
// gerou o link, não no de quem autoriza.
//
// A solução é carregar o destino dentro do próprio `state`, assinado: o link diz
// para qual workspace a loja vai, e a assinatura impede que alguém troque esse
// destino. Sem a chave do servidor não há como forjar um convite, então a
// proteção que o cookie dava (ninguém injeta loja em workspace alheio) continua
// de pé.

const PREFIXO = "inv1";
const VALIDADE_PADRAO_DIAS = 30;

export interface ConviteTiktok {
  workspaceId: string;
  expiraEm: string;
}

function chave(): Buffer {
  const valor = process.env.INTEGRATION_TOKEN_KEY;
  if (!valor) {
    throw new Error("Configure INTEGRATION_TOKEN_KEY para gerar convites do TikTok Shop.");
  }
  // Mesma derivação usada para proteger tokens — uma chave só no ambiente.
  return crypto.createHash("sha256").update(valor).digest();
}

function assinar(corpo: string): string {
  return crypto.createHmac("sha256", chave()).update(corpo).digest("base64url");
}

/** Gera o `state` assinado que leva o workspace dentro do link de convite. */
export function criarConviteTiktok(workspaceId: string, validadeDias = VALIDADE_PADRAO_DIAS): string {
  if (!workspaceId) throw new Error("Convite do TikTok exige um workspace.");
  const expira = Math.floor(Date.now() / 1000) + validadeDias * 86_400;
  const corpo = Buffer.from(JSON.stringify({ w: workspaceId, exp: expira }), "utf8").toString("base64url");
  return `${PREFIXO}.${corpo}.${assinar(corpo)}`;
}

/**
 * Valida o `state` recebido no callback.
 * Devolve `null` para qualquer coisa que não seja um convite íntegro e no prazo —
 * o chamador então trata como fluxo normal (cookie) ou recusa.
 */
export function validarConviteTiktok(state: string | null | undefined): ConviteTiktok | null {
  if (!state) return null;
  const partes = state.split(".");
  if (partes.length !== 3 || partes[0] !== PREFIXO) return null;
  const [, corpo, assinatura] = partes;

  let esperada: string;
  try {
    esperada = assinar(corpo);
  } catch {
    return null; // sem chave configurada não há convite válido
  }
  const recebida = Buffer.from(assinatura);
  const referencia = Buffer.from(esperada);
  if (recebida.length !== referencia.length || !crypto.timingSafeEqual(recebida, referencia)) {
    return null;
  }

  try {
    const dados = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
    if (typeof dados.w !== "string" || typeof dados.exp !== "number") return null;
    if (dados.exp * 1000 <= Date.now()) return null;
    return { workspaceId: dados.w, expiraEm: new Date(dados.exp * 1000).toISOString() };
  } catch {
    return null;
  }
}
