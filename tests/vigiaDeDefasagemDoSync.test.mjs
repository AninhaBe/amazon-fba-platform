import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "../scripts/ts-resolver.mjs";

// ⚠️ O VIGIA DE DEFASAGEM POR CANAL — e o defeito que ele reprova é a AUSÊNCIA
// de vigia, medida em 02/09/2026.
//
// Naquele dia a suspeita de que o sync da Shopee tinha parado chegou pela
// VENDEDORA, conferindo os nossos números contra outra ferramenta. Era alarme
// falso (fuso convertido na direção errada), mas a investigação achou o buraco
// real: o único vigia do produto era `silencioDoWebhook`, fixo em
// `mercado_livre`. Shopee, Amazon e TikTok podiam parar por horas em silêncio.
//
// 📌 E o limite é POR CANAL porque a cadência é: Shopee a cada 3 min, Amazon a
// cada 10. Limite único seria ruído de um lado e cegueira do outro — é a regra
// da dona do produto sobre não globalizar regra de canal.

const {
  avaliarDefasagem,
  resumirDefasagem,
} = await import("../src/lib/integrations/defasagemDoSync.ts");
const {
  limiteDeSilencioMs,
  intervaloDaRota,
  ROTA_DE_SYNC,
  CICLOS_ATE_ALARMAR,
} = await import("../src/lib/integrations/cadenciaDoSync.ts");

const AGORA = 1_756_000_000_000;
const haMinutos = (min) => new Date(AGORA - min * 60_000).toISOString();
const linha = (provider, connectionId, min) => ({
  provider, connection_id: connectionId,
  last_success_at: min == null ? null : haMinutos(min),
});
const por = (lista, id) => lista.find((c) => c.connectionId === id);

test("o limite de cada canal SAI da cadencia dele, nao de uma lista paralela", () => {
  // A garantia que importa: uma fonte só. Se alguém mudar a cadência da Shopee,
  // o alarme muda junto — foi assim que o imposto ficou na base errada, com duas
  // variáveis que por acaso coincidiam.
  for (const provider of ["shopee", "mercado_livre", "tiktok_shop", "amazon"]) {
    const esperado = intervaloDaRota(ROTA_DE_SYNC[provider]) * CICLOS_ATE_ALARMAR;
    assert.equal(limiteDeSilencioMs(provider), esperado, `${provider}: limite deve derivar da cadencia`);
  }
  // E os canais realmente diferem — senão o teste acima passaria com um limite
  // único e o "por canal" seria decorativo.
  assert.notEqual(limiteDeSilencioMs("shopee"), limiteDeSilencioMs("amazon"),
    "Shopee e Amazon tem cadencias diferentes; os limites tem de diferir");
});

test("ALARMA o canal parado — e SO ele", () => {
  // Shopee: cadência de 3 min, limite 15. 40 minutos é parada real.
  // Amazon: cadência de 10 min, limite 50. Os mesmos 40 minutos são NORMAIS.
  // É exatamente este par que um limite único erraria.
  const avaliadas = avaliarDefasagem([
    linha("shopee", "shopee:275804987", 40),
    linha("amazon", "amazon:A15NQMF7A6J1Y0", 40),
  ], AGORA);
  assert.equal(por(avaliadas, "shopee:275804987").estado, "atrasado");
  assert.equal(por(avaliadas, "amazon:A15NQMF7A6J1Y0").estado, "ok",
    "40 min na Amazon e ciclo normal; alarmar aqui e o ruido que mata o alarme");
});

test("NAO alarma por ciclo perdido — um deploy nao pode acender o vigia", () => {
  // Um ciclo pulado é rotina (a execução anterior ainda rodava). O alarme só
  // acende depois de CICLOS_ATE_ALARMAR seguidos.
  const limiteMin = limiteDeSilencioMs("shopee") / 60_000;
  const dentro = avaliarDefasagem([linha("shopee", "shopee:1", limiteMin - 1)], AGORA);
  assert.equal(dentro[0].estado, "ok");
  const fora = avaliarDefasagem([linha("shopee", "shopee:1", limiteMin + 1)], AGORA);
  assert.equal(fora[0].estado, "atrasado");
});

test("CONEXAO DE DEMONSTRACAO fica de fora — alarme sempre vermelho e alarme nenhum", () => {
  // Medido em 02/09: as conexões demo estavam 8.629 minutos sem sincronizar, e
  // ficarão para sempre — não têm token. Deixá-las entrar acenderia o vigia todo
  // dia e ensinaria a ignorá-lo.
  const avaliadas = avaliarDefasagem([
    linha("shopee", "shopee:demo", 8629),
    linha("amazon", "amazon:demo", 8629),
    linha("mercado_livre", "mercado_livre:demo", 8629),
    linha("shopee", "shopee:275804987", 2),
  ], AGORA);
  assert.equal(avaliadas.length, 1, "so a conexao real e avaliada");
  assert.equal(avaliadas[0].connectionId, "shopee:275804987");
  assert.equal(resumirDefasagem(avaliadas).estado, "ok");
});

test("NUNCA SINCRONIZOU nao e 'atrasado' — e outra coisa, e leva outro nome", () => {
  // `null` != valor grande. Chamar de atraso mandaria procurar no lugar errado:
  // a conexão pode ser nova ou nunca ter sido autorizada.
  const avaliadas = avaliarDefasagem([linha("shopee", "shopee:9", null)], AGORA);
  assert.equal(avaliadas[0].estado, "sem-historico");
  assert.equal(avaliadas[0].minutosDesdeUltimoSucesso, null,
    "ausencia de sucesso e null, nunca 0 — zero diria 'sincronizou agora'");
});

test("a mensagem diz QUANTO e QUAL ERA O ESPERADO, com numero", () => {
  const resumo = resumirDefasagem(avaliarDefasagem([linha("shopee", "shopee:275804987", 40)], AGORA));
  const [c] = resumo.canais;
  assert.match(c.mensagem, /40 min/, "tem de dizer ha quanto tempo");
  assert.match(c.mensagem, /a cada 3 min/, "e qual era a cadencia esperada");
  assert.match(c.mensagem, /^shopee: /, "e QUAL canal");
  // ⚠️ E NUNCA o connection_id: ele carrega o id de loja do vendedor, e
  // /api/health e publico. Identificar defeito nao pode custar vazar cliente.
  assert.doesNotMatch(c.mensagem, /shopee:275804987/,
    "connection_id nao pode sair num endereco aberto");
  // Nada de adjetivo que se desculpa — a regra da casa proibe "parcial" e
  // parentes: a frase aponta, com numero.
  assert.doesNotMatch(c.mensagem, /parcial|incompleto|talvez/i);
});

test("o resumo separa o que precisa de acao do que nao precisa", () => {
  const resumo = resumirDefasagem(avaliarDefasagem([
    linha("shopee", "shopee:1", 40),
    linha("amazon", "amazon:2", 3),
  ], AGORA));
  assert.equal(resumo.estado, "atrasado");
  assert.equal(resumo.mensagens.length, 1, "so o canal atrasado gera mensagem");
  assert.match(resumo.mensagens[0], /^shopee: /);
  assert.equal(resumo.canais.length, 2, "os dois canais aparecem no resumo");
});

test("o vigia le last_success_at, NAO a escrita de pedido", async () => {
  // ⚠️ A distincao que faz o vigia funcionar de madrugada: medir por pedido
  // gravado confunde "nao sincronizou" com "nao vendeu". Um canal sem venda
  // nenhuma das 3h as 6h apareceria como "parado ha 3 horas" estando perfeito —
  // e seria o alarme falso que ensina a ignorar alarme.
  const fonte = await readFile(new URL("../src/lib/integrations/defasagemDoSync.ts", import.meta.url), "utf8");
  assert.ok(fonte.includes("MAX(s.last_success_at) AS last_success_at"),
    "a fonte tem de ser o sucesso do sync");
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // ⚠️ ESTA ASSERCAO FOI REFINADA EM 03/09/2026, e a distincao e o ponto.
  //
  // Ela proibia QUALQUER mencao a workspace_channel_orders. A proibicao larga
  // estava certa para a DEFASAGEM — medir atraso por pedido gravado confunde
  // "nao sincronizou" com "nao vendeu". Mas o vigia do PUSH precisa
  // exatamente disso: push so existe quando algo acontece, entao silencio de
  // push e ausencia de venda dao o mesmo sintoma. O discriminador e o pedido
  // gravado DEPOIS do ultimo push — prova de que o evento existiu e nao chegou.
  //
  // Entao a regra fica: a IDADE sai de last_success_at; o pedido entra SO como
  // prova de atividade para o push.
  const idade = codigo.slice(codigo.indexOf("MAX(s.last_success_at)"), codigo.indexOf("houve_pedido_apos_push"));
  assert.ok(!/workspace_channel_orders/.test(idade),
    "a idade da varredura nao pode sair de pedido gravado");
  assert.match(codigo, /EXISTS \(SELECT 1 FROM workspace_channel_orders o[\s\S]{0,300}o\.synced_at > COALESCE\(s\.last_push_at/,
    "o pedido entra SO como prova de que houve evento para o push empurrar");
});

test("o vigia entra no /api/health AO LADO do webhook, sem derrubar a saude", async () => {
  const saude = await readFile(new URL("../src/app/api/health/route.ts", import.meta.url), "utf8");
  assert.ok(saude.includes("    const defasagem = await lerDefasagemDoSync().catch(() => null);"),
    "medidor que estoura nao pode derrubar o /api/health");
  assert.ok(saude.includes("      ...(defasagem ? { sync: defasagem } : {}),"),
    "o resumo tem de sair na resposta");
  // E o vigia do webhook do ML continua: sao perguntas diferentes (o marketplace
  // parou de avisar x nos paramos de buscar).
  assert.ok(saude.includes("      ...(webhook ? { webhook } : {}),"),
    "o vigia novo entra ao lado do antigo, nao no lugar dele");
});

test("NENHUM identificador de inquilino sai do resumo — /api/health e publico", () => {
  // 🔴 DEFEITO PEGO PELO PORTAO DE ISOLAMENTO, 02/09/2026: a primeira versao
  // deste vigia devolvia `connectionId` por conexao. O `/api/health` nao tem
  // sessao — publicar `shopee:275804987` ali seria expor o id de loja de todo
  // cliente num endereco aberto, para diagnosticar um defeito nosso.
  //
  // O portao `workspaceIdNaoDependeDeLembranca` reprovou a consulta sem escopo e
  // me obrigou a escrever o motivo; escrever o motivo foi o que expos que a
  // saida vazava id. A leitura entre inquilinos e legitima; a SAIDA nao podia
  // ser identificavel.
  const resumo = resumirDefasagem(avaliarDefasagem([
    linha("shopee", "shopee:275804987", 40),
    linha("amazon", "amazon:A15NQMF7A6J1Y0", 2),
  ], AGORA));
  const serializado = JSON.stringify(resumo);
  for (const id of ["275804987", "A15NQMF7A6J1Y0", "connectionId"]) {
    assert.ok(!serializado.includes(id), `o resumo publico nao pode conter "${id}"`);
  }
});

test("o LIMITE sai como serie do Prometheus — o alerta nao tem numero digitado", async () => {
  // ⚠️ Sem isto a regra no Grafana seria `nexo_sync_idade_segundos > 900`, e
  // esse 900 vira SEGUNDA fonte da verdade num lugar que nenhum teste alcanca.
  // Mudar a cadencia da Shopee de 3 para 10 min deixaria o alerta gritando com o
  // numero velho — ate alguem desligar, que e como alarme morre.
  const fonte = await readFile(new URL("../src/lib/metricas.ts", import.meta.url), "utf8");
  assert.ok(fonte.includes('familia(saida, "nexo_sync_limite_segundos"'),
    "o limite precisa sair como serie ao lado da idade");
  // E ele tem de VIR da mesma funcao do vigia, nao de um numero repetido aqui.
  assert.ok(fonte.includes("Math.round(limiteDeSilencioMs(s.provider) / 1000)"),
    "o limite da metrica sai de limiteDeSilencioMs, nao de constante local");
  assert.ok(fonte.includes('import { LIMITE_PUSH_MUDO_MS, limiteDeSilencioMs } from "./integrations/cadenciaDoSync";'),
    "os dois limiares saem do mesmo modulo — nenhum literal na camada de metrica");
  // ⚠️ E o do PUSH tambem vira serie, pela mesma razao: alerta com numero
  // digitado no painel e uma segunda fonte da verdade que nenhum teste alcanca.
  assert.ok(fonte.includes('familia(saida, "nexo_push_limite_segundos"'));
  assert.ok(fonte.includes("Math.round(LIMITE_PUSH_MUDO_MS / 1000)"),
    "o limite do push sai da constante, nao de um numero repetido aqui");
});

test("PUSH MUDO: so alarma quando houve evento para empurrar", () => {
  // 🔴 A armadilha que este caso reprova: push so existe quando algo acontece.
  // Alarmar por silencio puro gritaria toda madrugada — medido em 03/09/2026,
  // a Shopee tem 25-30 pushes/hora entre 4h e 6h BRT, contra ~290 no pico. Um
  // vigia que acusa o vale e desligado numa semana, e ai o alarme de verdade
  // morre junto.
  const haMin = (m) => new Date(AGORA - m * 60_000).toISOString();
  const base = { provider: "shopee", connection_id: "shopee:1", last_success_at: haMin(2) };

  // Silencio LONGO e a varredura trazendo pedido = o canal parou de avisar.
  const [mudo] = avaliarDefasagem([{ ...base, last_push_at: haMin(120), houve_pedido_apos_push: true }], AGORA);
  assert.equal(mudo.push, "mudo");

  // MESMO silencio, sem pedido nenhum = nao havia o que empurrar. Nao e defeito.
  const [quieto] = avaliarDefasagem([{ ...base, last_push_at: haMin(120), houve_pedido_apos_push: false }], AGORA);
  assert.equal(quieto.push, "sem-evento", "madrugada sem venda nao pode acender o alarme");

  // Dentro do limite, e ok mesmo com pedido chegando.
  const [ok] = avaliarDefasagem([{ ...base, last_push_at: haMin(5), houve_pedido_apos_push: true }], AGORA);
  assert.equal(ok.push, "ok");
});

test("canal SEM push nao pode aparecer como mudo", () => {
  // A Amazon nao entrega push (SQS/EventBridge, fora do nosso escopo) e o TikTok
  // tampouco. Marcar os dois como "mudo" seria alarme permanente por desenho.
  const [amazon] = avaliarDefasagem([{
    provider: "amazon", connection_id: "amazon:1",
    last_success_at: new Date(AGORA - 2 * 60_000).toISOString(),
    last_push_at: null, houve_pedido_apos_push: true,
  }], AGORA);
  assert.equal(amazon.push, "sem-push");
});

test("o limite do push SAI da medicao, e e generoso de proposito", async () => {
  const { LIMITE_PUSH_MUDO_MS } = await import("../src/lib/integrations/cadenciaDoSync.ts");
  // 60 min ~ 3x o maior silencio observado (21,3 min em 3.104 intervalos, 22,7h).
  assert.equal(LIMITE_PUSH_MUDO_MS, 60 * 60_000);
  // ⚠️ E ele tem de ser MUITO maior que o da varredura: sao fenomenos
  // diferentes. A varredura falha por si; o push falha por silencio, e silencio
  // tem causa legitima.
  const { limiteDeSilencioMs } = await import("../src/lib/integrations/cadenciaDoSync.ts");
  assert.ok(LIMITE_PUSH_MUDO_MS > limiteDeSilencioMs("shopee") * 3,
    "limite de push apertado como o da varredura viraria ruido");
});
