import { decidirReembolso, type DecisaoDeReembolso } from "./garantiaDeSeteDias";

/**
 * O lado da Stripe da garantia de 7 dias. A DECISÃO mora em
 * `garantiaDeSeteDias.ts`, que é pura e testada; aqui só entra o que precisa
 * falar com a API.
 */
export interface ResultadoDoReembolso extends DecisaoDeReembolso {
  /** Id do reembolso criado, quando houve. */
  reembolsoId: string | null;
  /** Preenchido quando tentamos e não deu — vai para o log e para o ledger. */
  falha: string | null;
}

interface Fatura {
  id: string;
  charge: string | null;
  payment_intent: string | null;
  status_transitions?: { paid_at?: number | null };
  created: number;
  amount_paid: number;
}

async function stripe(caminho: string, opcoes?: { corpo?: URLSearchParams; chaveIdempotente?: string }) {
  const chave = process.env.STRIPE_SECRET_KEY;
  if (!chave) throw new Error("STRIPE_SECRET_KEY ausente");
  const cabecalhos: Record<string, string> = { Authorization: `Bearer ${chave}` };
  if (opcoes?.corpo) cabecalhos["Content-Type"] = "application/x-www-form-urlencoded";
  if (opcoes?.chaveIdempotente) cabecalhos["Idempotency-Key"] = opcoes.chaveIdempotente;

  const resposta = await fetch(`https://api.stripe.com/v1/${caminho}`, {
    method: opcoes?.corpo ? "POST" : "GET",
    headers: cabecalhos,
    body: opcoes?.corpo,
  });
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    throw new Error(`Stripe ${caminho} respondeu ${resposta.status}: ${dados?.error?.message ?? "sem detalhe"}`);
  }
  return dados;
}

/**
 * A PRIMEIRA fatura paga da assinatura — nunca a última.
 *
 * ⚠️ A Stripe devolve as faturas da mais nova para a mais velha. Pegar
 * `data[0]` daria a fatura RECORRENTE, e a garantia reabriria a cada renovação:
 * no 13º mês, cancelar no dia seguinte à cobrança devolveria o dinheiro. Por
 * isso a ordenação é explícita e ascendente.
 */
export async function primeiraCobrancaDaAssinatura(assinaturaId: string): Promise<{
  pagoEm: Date | null;
  cobrancaId: string | null;
  jaReembolsado: boolean;
}> {
  const lista = await stripe(`invoices?subscription=${encodeURIComponent(assinaturaId)}&status=paid&limit=100`);
  const faturas: Fatura[] = Array.isArray(lista?.data) ? lista.data : [];
  const pagas = faturas
    .filter((f) => (f.amount_paid ?? 0) > 0)
    .sort((a, b) => (a.status_transitions?.paid_at ?? a.created) - (b.status_transitions?.paid_at ?? b.created));

  const primeira = pagas[0];
  if (!primeira) return { pagoEm: null, cobrancaId: null, jaReembolsado: false };

  const segundos = primeira.status_transitions?.paid_at ?? primeira.created;
  const cobrancaId = primeira.charge ?? null;

  // ⚠️ A IDEMPOTÊNCIA DE VERDADE VEM DA STRIPE, não da nossa memória. O
  // `Idempotency-Key` só vale 24h; o ledger de eventos protege contra a mesma
  // entrega, não contra um segundo evento de cancelamento. Perguntar à cobrança
  // se ela já foi devolvida é a única fonte que não expira.
  let jaReembolsado = false;
  if (cobrancaId) {
    const cobranca = await stripe(`charges/${encodeURIComponent(cobrancaId)}`);
    jaReembolsado = Boolean(cobranca?.refunded) || (cobranca?.amount_refunded ?? 0) > 0;
  }

  return { pagoEm: new Date(segundos * 1000), cobrancaId, jaReembolsado };
}

/** Decide e, se for o caso, devolve o dinheiro. Nunca lança: o corte não pode falhar por causa disto. */
export async function reembolsarSeDentroDaGarantia(
  assinaturaId: string | null,
  agora: Date
): Promise<ResultadoDoReembolso> {
  const semAssinatura: ResultadoDoReembolso = {
    reembolsar: false,
    motivo: "sem-cobranca-conhecida",
    diasDesdeACobranca: null,
    reembolsoId: null,
    falha: null,
  };
  if (!assinaturaId || !process.env.STRIPE_SECRET_KEY) return semAssinatura;

  try {
    const cobranca = await primeiraCobrancaDaAssinatura(assinaturaId);
    const decisao = decidirReembolso({
      primeiraCobrancaEm: cobranca.pagoEm,
      jaReembolsado: cobranca.jaReembolsado,
      agora,
    });
    if (!decisao.reembolsar || !cobranca.cobrancaId) {
      return { ...decisao, reembolsoId: null, falha: null };
    }

    const criado = await stripe("refunds", {
      corpo: new URLSearchParams({ charge: cobranca.cobrancaId, reason: "requested_by_customer" }),
      // Chave derivada da assinatura: duas entregas do mesmo cancelamento, ou
      // duas instâncias processando ao mesmo tempo, criam UM reembolso só.
      chaveIdempotente: `nexo-garantia-${assinaturaId}`,
    });
    return { ...decisao, reembolsoId: criado?.id ?? null, falha: null };
  } catch (motivo) {
    // ⚠️ NÃO PROPAGA. Se o reembolso derrubasse o processamento, a Stripe
    // reentregaria o cancelamento e a conta ficaria oscilando — e o corte, que é
    // a parte que protege o produto, não aconteceria. A falha vira registro.
    return { ...semAssinatura, falha: motivo instanceof Error ? motivo.message : String(motivo) };
  }
}
