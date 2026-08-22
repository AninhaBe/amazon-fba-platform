// Narração diária da Visão geral: o "bom dia, o faturamento do ML caiu, vamos ver?".
//
// Princípio inegociável (AGENTS.md): o modelo NÃO consulta nada e NÃO inventa
// número. Ele recebe os valores que a central já calculou e só os transforma em
// uma frase. Todo número que aparecer no texto tem que ter vindo daqui. É por
// isso que o snapshot é montado no servidor a partir do que o cliente envia, e o
// prompt proíbe fabricar valores explicitamente.
//
// Custo: uma geração por workspace por dia (cache diário na rota). O modelo é o
// Gemini (Google AI Studio), pay-as-you-go via GEMINI_API_KEY; sem a chave, a
// rota devolve texto nulo e a tela cai na linha de alerta por regra que já existe.

export interface CanalNoSnapshot {
  nome: string;
  faturamento: number | null;
  lucro: number | null;
  margemPct: number | null;
  variacaoSemanaPct: number | null;
  semLeitura: boolean;
  unidadesSemCusto: number;
}

export interface SnapshotCentral {
  data: string; // YYYY-MM-DD (Brasília)
  moeda: string;
  faturamento30d: number;
  lucro30d: number | null;
  margemPct: number | null;
  variacaoSemanaPct: number | null;
  canais: CanalNoSnapshot[];
}

// Flash é o mais barato/rápido do Gemini — suficiente para uma frase por dia.
// Validado contra a API em 22/08/2026: gemini-2.0-flash foi descontinuado e a
// própria API apontou o gemini-3.6-flash. Configurável por GEMINI_MODEL, para
// trocar sem deploy quando o Google renomear de novo.
const MODELO_PADRAO = "gemini-3.6-flash";

const money = (v: number | null, moeda: string) =>
  v == null ? "desconhecido" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(v);
const pct = (v: number | null) => (v == null ? "sem base" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

/**
 * O texto que descreve os números para o modelo. Puro e determinístico de
 * propósito: é o que os testes conferem e é a única fonte de números do prompt.
 */
export function descreverSnapshot(s: SnapshotCentral): string {
  const linhas = [
    `Data de hoje: ${s.data}.`,
    `Faturamento consolidado (30 dias): ${money(s.faturamento30d, s.moeda)}.`,
    `Lucro consolidado conhecido: ${money(s.lucro30d, s.moeda)}${s.margemPct != null ? ` (margem ${pct(s.margemPct)})` : ""}.`,
    s.variacaoSemanaPct != null
      ? `Variação do faturamento na última semana vs. a anterior: ${s.variacaoSemanaPct >= 0 ? "+" : ""}${pct(s.variacaoSemanaPct)}.`
      : "Ainda não há duas semanas de histórico para comparar tendência.",
    "",
    "Por canal:",
    ...s.canais.map((c) => {
      if (c.semLeitura) return `- ${c.nome}: conectado, mas sem leitura no momento.`;
      const partes = [`faturamento ${money(c.faturamento, s.moeda)}`];
      if (c.lucro != null) partes.push(`lucro ${money(c.lucro, s.moeda)}`);
      if (c.margemPct != null) partes.push(`margem ${pct(c.margemPct)}`);
      if (c.variacaoSemanaPct != null) partes.push(`${c.variacaoSemanaPct >= 0 ? "+" : ""}${pct(c.variacaoSemanaPct)} na semana`);
      if (c.unidadesSemCusto > 0) partes.push(`${c.unidadesSemCusto} unidade(s) sem custo cadastrado (lucro subestimado)`);
      return `- ${c.nome}: ${partes.join(", ")}.`;
    }),
  ];
  return linhas.join("\n");
}

const SISTEMA = [
  "Você é o NEXO, um copiloto financeiro para quem vende em marketplaces (Amazon, Mercado Livre, Shopee, TikTok Shop).",
  "Escreva uma saudação curta — no máximo 3 frases — em português do Brasil, tom de um colega competente e direto, sem exagero e sem emoji.",
  "REGRA ABSOLUTA: use somente os números fornecidos. Nunca invente, arredonde grosseiro ou estime valor que não foi dado. Se um dado for 'desconhecido' ou 'sem leitura', diga isso com naturalidade em vez de chutar.",
  "Comece com uma saudação (bom dia/boa tarde conforme fizer sentido, mas sem depender de hora exata). Aponte a mudança financeira mais relevante entre os canais — uma queda ou alta forte, um canal que parou, ou custo faltando que subestima o lucro. Se estiver tudo estável, diga que está tranquilo.",
  "Termine convidando a pessoa a investigar no briefing, com uma pergunta curta do tipo 'vamos ver o que aconteceu?'.",
  "Não use markdown, listas nem títulos. Só o parágrafo.",
].join(" ");

/**
 * Chama o Gemini para narrar o snapshot. Devolve `null` quando não há chave —
 * degradação limpa: a tela usa o alerta por regra. Erros de API também caem para
 * `null`, nunca quebram a central.
 */
export async function narrarBriefing(snapshot: SnapshotCentral): Promise<string | null> {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) return null;
  const modelo = process.env.GEMINI_MODEL || MODELO_PADRAO;

  try {
    const resposta = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
      {
        method: "POST",
        headers: {
          // Chave no header, não na URL: mantém o segredo fora de log de acesso.
          "x-goog-api-key": chave,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SISTEMA }] },
          contents: [{ role: "user", parts: [{ text: descreverSnapshot(snapshot) }] }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!resposta.ok) {
      console.error("[central-briefing] Gemini respondeu", resposta.status, (await resposta.text()).slice(0, 200));
      return null;
    }
    const dados = await resposta.json();
    const partes = dados?.candidates?.[0]?.content?.parts;
    const texto = Array.isArray(partes)
      ? partes.map((p: { text?: string }) => p.text ?? "").join("").trim()
      : "";
    return texto || null;
  } catch (erro) {
    console.error("[central-briefing] falha ao narrar", erro);
    return null;
  }
}
