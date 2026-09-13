// ⚠️ LOGICA PURA EM `.ts`, NAO DENTRO DO `.tsx` — mesmo motivo de
// `composicaoFinanceira.ts`: o runner de `npm test`
// (`node --experimental-strip-types`) nao carrega `.tsx`, e esta escolha precisa
// ser testada pelo COMPORTAMENTO (chamar e conferir a saida) e nao por
// casamento no fonte, que e a familia de teste decorativo que o AGENTS.md
// proibe. Dentro do componente, so daria para olhar o texto do arquivo.

/** A query do filtro "7 dias" e a do "Hoje" — as mesmas strings que a URL usa. */
export const JANELA_DE_SETE_DIAS = "days=7";

/**
 * De onde o bloco "Ritmo dos últimos 7 dias" tira as colunas: SEMPRE da janela
 * de sete dias que termina hoje, qualquer que seja o filtro de data.
 *
 * ⚠️ ESTA REGRA JÁ FOI O CONTRÁRIO, e a inversão é decisão da dona
 * (09/09/2026): *"sobre o ritmo dos últimos 7 dias, vai ser a única coisa que
 * não vai mudar com base no filtro de data, vai ficar últimos 7 dias sempre"*.
 *
 * O que valia antes, para quem abrir o histórico: só o filtro "Hoje" trocava de
 * fonte (correção de 03/09/2026, quando um único ponto virava uma coluna
 * gigante sob um título que prometia sete). Nos demais filtros o bloco cortava
 * `serieDoPeriodo.slice(-7)`.
 *
 * ⚠️ POR QUE AQUILO ERA DEFEITO E NÃO SÓ "OUTRA ESCOLHA": o título
 * do bloco é fixo — "Ritmo dos últimos 7 dias". Com 15 ou 30 dias o corte
 * coincidia com os últimos sete de verdade e ninguém via nada. Com
 * **Personalizado** (ex.: 1 a 20 de agosto) o bloco mostrava os últimos sete
 * dias DAQUELA janela sob um título dizendo "últimos 7 dias". É a mesma família
 * do `from`/`to` da Shopee que o AGENTS.md registra: controle marcado exibindo
 * outro período. Agora título e dado nascem da mesma regra.
 *
 * ⚠️ E ENQUANTO A JANELA NÃO CHEGOU, a resposta é vazia: o bloco não
 * se desenha por um instante, o que é melhor do que aparecer com as colunas do
 * período sob um título que promete sete.
 */
export function serieDoBlocoDeLucro<T>({
  janelaDeSeteDias,
}: {
  /** `null` enquanto a janela ainda não chegou. */
  janelaDeSeteDias: T[] | null;
}): T[] {
  return janelaDeSeteDias == null ? [] : janelaDeSeteDias.slice(-7);
}

/**
 * O QUE A TELA RECEBE DO CACHE DA JANELA — lido A CADA RENDER, nunca
 * memorizado.
 *
 * ⚠️ ISTO É O CONSERTO DE UM DEFEITO MEDIDO EM PRODUÇÃO
 * (13/09/2026, conta com volume real): o cartão "Ritmo dos últimos 7 dias"
 * aparecia VAZIO — zero colunas no DOM, só a legenda e a nota — enquanto o
 * payload da mesma rota trazia os 8 dias com lucro. Medido com observador de
 * segundo em segundo: 94 segundos com o Top 8 já preenchido e o ritmo ainda em
 * zero. Não era demora, e não era falta de dado.
 *
 * A CAUSA: o hook devolvia `useMemo(() => cache.get(chave)…, [chave, contador])`
 * sobre um `Map` que vive FORA do React. Quando a pessoa abre a página já no
 * filtro de 7 dias, quem preenche a chave `dashboard:days=7` é a busca da
 * PRÓPRIA PÁGINA — e aí o efeito do hook encontra `cache.has(chave)` verdadeiro,
 * volta cedo, e o contador (que era a única notificação de escrita no Map) nunca
 * sobe. O memo devolve para sempre o `null` calculado no primeiro render.
 *
 * ⚠️ E O SINTOMA DEPENDIA DO FILTRO EM QUE A PÁGINA ABRIA, que é o
 * que fez isso sobreviver: abrindo em Hoje, 15 ou 30 dias, a chave do hook é
 * diferente da chave da página, o hook busca, o contador sobe e o bloco
 * desenha. Só a aterrissagem direta no filtro de 7 dias caía no buraco.
 *
 * A troca é ler o `Map` no render. É uma consulta de dicionário — o custo de
 * memorizar isso nunca se pagou, e a memorização era exatamente o que segurava
 * o valor velho.
 *
 * ⚠️ O CONTADOR CONTINUA EXISTINDO, e não é redundância: ele é o que
 * faz o React RENDERIZAR de novo quando é a busca do próprio hook que preenche a
 * chave. Sem ele, o valor novo estaria no Map e ninguém pediria um render para
 * lê-lo. O que mudou é o papel: ele agenda o render, não decide o valor.
 */
export function serieDaJanelaDeSeteDias<T>(
  cache: { get(chave: string): { overview: { dailySales: T[] } } | undefined },
  chave: string,
): T[] | null {
  return cache.get(chave)?.overview.dailySales ?? null;
}

/**
 * Se o hook precisa BUSCAR a janela — a outra metade da decisão.
 *
 * Sem conexão não há o que buscar (a página inteira está em branco), e com a
 * chave já no cache a busca seria uma segunda janela de sete dias que poderia
 * discordar da primeira.
 */
export function precisaBuscarAJanela({
  temNoCache,
  connectionId,
}: {
  temNoCache: boolean;
  connectionId: string | null;
}): boolean {
  if (temNoCache) return false;
  return Boolean(connectionId);
}
