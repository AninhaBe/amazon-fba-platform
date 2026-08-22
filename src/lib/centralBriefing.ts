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

/** Um insight já detectado pelo cron (ruptura, queda, margem). Fato, não palpite. */
export interface InsightResumo {
  canal: string;
  tipo: string;
  severidade: number;
  titulo: string;
  recomendacao?: string;
}

export interface SnapshotCentral {
  data: string; // YYYY-MM-DD (Brasília)
  /** Saudação já correta para a hora de Brasília ("Bom dia"/"Boa tarde"/"Boa noite"). */
  saudacao?: string;
  moeda: string;
  // Financeiro pode faltar (ex.: no briefing, cujo foco são os insights). `null`
  // é "não informado aqui", nunca zero.
  faturamento30d: number | null;
  lucro30d: number | null;
  margemPct: number | null;
  variacaoSemanaPct: number | null;
  canais: CanalNoSnapshot[];
  /** Insights detectados (só no modo briefing) — o modelo os narra, não os inventa. */
  insights?: InsightResumo[];
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
  const linhas = [`Data de hoje: ${s.data}.`];
  if (s.saudacao) {
    linhas.push(`A saudação correta para o horário AGORA é exatamente "${s.saudacao}" — use essa, não outra.`);
  }
  // O bloco financeiro só entra quando há faturamento a relatar. No briefing, o
  // foco são os insights, e forçar "faturamento desconhecido" seria ruído.
  if (s.faturamento30d != null) {
    linhas.push(
      `Faturamento consolidado (30 dias): ${money(s.faturamento30d, s.moeda)}.`,
      `Lucro consolidado conhecido: ${money(s.lucro30d, s.moeda)}${s.margemPct != null ? ` (margem ${pct(s.margemPct)})` : ""}.`,
      s.variacaoSemanaPct != null
        ? `Variação do faturamento na última semana vs. a anterior: ${s.variacaoSemanaPct >= 0 ? "+" : ""}${pct(s.variacaoSemanaPct)}.`
        : "Ainda não há duas semanas de histórico para comparar tendência."
    );
  }
  if (s.canais.length) {
    linhas.push("", "Por canal:");
    linhas.push(...s.canais.map((c) => {
      if (c.semLeitura) return `- ${c.nome}: conectado, mas sem leitura no momento.`;
      const partes = [`faturamento ${money(c.faturamento, s.moeda)}`];
      if (c.lucro != null) partes.push(`lucro ${money(c.lucro, s.moeda)}`);
      if (c.margemPct != null) partes.push(`margem ${pct(c.margemPct)}`);
      if (c.variacaoSemanaPct != null) partes.push(`${c.variacaoSemanaPct >= 0 ? "+" : ""}${pct(c.variacaoSemanaPct)} na semana`);
      if (c.unidadesSemCusto > 0) partes.push(`${c.unidadesSemCusto} unidade(s) sem custo cadastrado (lucro subestimado)`);
      return `- ${c.nome}: ${partes.join(", ")}.`;
    }));
  }
  if (s.insights?.length) {
    linhas.push("", "Sinais já detectados na operação (fatos apurados, para você priorizar e explicar):");
    for (const i of s.insights) {
      const sev = i.severidade >= 90 ? "crítico" : i.severidade >= 70 ? "atenção" : "monitorar";
      linhas.push(`- [${sev}] ${i.canal} · ${i.titulo}${i.recomendacao ? ` — sugestão registrada: ${i.recomendacao}` : ""}`);
    }
  }
  return linhas.join("\n");
}

// O "job description" do NEXO. Define QUEM ele é, o que olhar e como falar — a
// voz e o rigor. O formato (resumo curto vs. briefing cheio) vem por modo, na
// mensagem do usuário, para não duplicar a identidade.
const SISTEMA = [
  "Você é o NEXO — o copiloto financeiro de quem vende em vários marketplaces ao mesmo tempo (Amazon, Mercado Livre, Shopee, TikTok Shop). Você não é um chatbot genérico: você acompanha a operação inteira do vendedor, dia após dia, e enxerga vendas, margem, tarifas e estoque dos quatro canais como um negócio só.",

  "SEU TRABALHO: a pessoa não deveria precisar abrir quatro painéis e montar planilha para saber o que mudou no próprio negócio. Você faz isso por ela. Diz, em uma olhada, o que aconteceu, por que importa e onde ela deve olhar. Você conecta os pontos que um número isolado esconde — mais faturamento nem sempre é mais lucro, um produto campeão pode estar corroendo a margem, um canal pode ter parado sem ninguém perceber.",

  "REGRA INEGOCIÁVEL — nunca invente número. Use SOMENTE os valores que eu te der nesta mensagem. Não estime, não projete, não 'arredonde para um número redondo'. Se um dado vier como 'desconhecido', 'sem leitura' ou faltando, diga isso com naturalidade — 'ainda não sei', 'o canal não reportou' — em vez de chutar. Zero e desconhecido são coisas diferentes: nunca troque um pelo outro. É melhor dizer menos e certo do que mais e errado; o vendedor toma decisão de dinheiro com o que você fala.",

  "PRIORIDADE, sempre nesta ordem: primeiro o que exige AÇÃO (um canal que parou de vender, ruptura de estoque chegando, custo faltando que subestima o lucro, uma queda forte de faturamento); depois a OPORTUNIDADE (um canal ou produto puxando o resultado); por último, se estiver tudo estável, diga que está tranquilo — sem inventar drama. Não liste tudo: escolha o que mais muda a vida dela hoje.",

  "VOZ: você fala em primeira pessoa, como um sócio de confiança que passou o olho na operação antes da pessoa chegar. É natural usar 'dei uma olhada', 'reparei que', 'na minha leitura', 'acho que vale' — isso deixa claro que é VOCÊ, o NEXO, falando, e não um relatório automático. Mas é uma pessoa competente, não um robô simpático: frases curtas, direto ao ponto, português do Brasil coloquial de escritório. Zero jargão de tecnologia, zero 'como uma IA' ou 'como seu assistente', zero emoji, zero bajulação, zero frase de preenchimento. NUNCA se apresente formalmente ('Olá, sou o NEXO, seu copiloto financeiro') — isso é cara de robô, e a pessoa já sabe quem você é. Também não repita o número cru sem dizer o que ele significa: em vez de 'seu faturamento foi R$ X', diga o que mudou e por que importa. Fale de dinheiro em reais, com o valor exato que recebeu.",

  "COMECE pela saudação correta do horário (eu te digo qual é) e vá DIRETO para a observação mais importante — sem parágrafo de introdução, sem 'aqui está o resumo'.",
].join("\n\n");

export type ModoNarracao = "resumo" | "briefing";

// A instrução de formato por modo. O sistema define a voz; isto define o tamanho
// e a forma da saída.
const FORMATO: Record<ModoNarracao, string> = {
  // Overview: a manchete que puxa pro briefing.
  resumo:
    "FORMATO: escreva no máximo 2 frases, em um parágrafo só, sem markdown. Comece com uma saudação curta (bom dia/boa tarde, sem depender de hora exata). Aponte a ÚNICA coisa mais importante entre os canais hoje. Termine com um convite curto para ver o briefing ('vamos ver?'). Nada de listas.",
  // Briefing: a matéria cheia.
  briefing:
    "FORMATO: escreva o briefing do dia. Uma saudação curta de uma linha, e depois de 2 a 4 pontos priorizados. Cada ponto: o que aconteceu (com o número exato) e o que fazer ou onde olhar. Seja específico e acionável. Pode usar hífens simples para separar os pontos, mas nada de títulos, negrito ou tabelas. Se estiver tudo estável, diga em duas linhas que o dia está tranquilo e o que continuar observando.",
};

/**
 * Chama o Gemini para narrar o snapshot. Devolve `null` quando não há chave —
 * degradação limpa: a tela usa o alerta por regra. Erros de API também caem para
 * `null`, nunca quebram a central.
 */
export async function narrarBriefing(
  snapshot: SnapshotCentral,
  modo: ModoNarracao = "resumo"
): Promise<string | null> {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) return null;
  const modelo = process.env.GEMINI_MODEL || MODELO_PADRAO;
  const conteudo = `${FORMATO[modo]}\n\n---\n\n${descreverSnapshot(snapshot)}`;

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
          contents: [{ role: "user", parts: [{ text: conteudo }] }],
          // O gemini-3.x "pensa" ~600-900 tokens antes de escrever, e isso conta
          // no teto. Sem folga, o texto sai truncado (medido em 22/08/2026: 629
          // de 713 tokens foram pensamento). Teto alto deixa espaço para a
          // resposta; o custo por chamada continua fração de centavo, e é uma
          // por dia por workspace.
          generationConfig: { maxOutputTokens: modo === "briefing" ? 2500 : 1200, temperature: 0.6 },
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
