import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A PRIMEIRA TELA NÃO PODE ESPERAR A ROTA MAIS LENTA.
//
// Medido em 24/08/2026: 8 a 10 segundos de esqueleto na Visão geral. A causa
// não era a rede — era a central esperar os quatro canais e, dentro da Amazon,
// esperar `/api/profit`, que pagina `/finances/2024-06-19/transactions` AO VIVO,
// em série, por 30 dias, sem cache.
//
// Ela cortou a discussão sobre cache: "essa tela não pode demorar, é a primeira
// tela que o seller entra e vai travar já? não dá".

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

test("faturamento e lucro da Amazon sao tarefas separadas", () => {
  const s = fonte("src/app/centralChannels.ts");
  // Juntas num allSettled, o faturamento — que vem do canônico e é instantâneo —
  // ficava refém da rota de lucro, que é a mais lenta do produto.
  assert.doesNotMatch(
    s,
    /Promise\.allSettled\(\[\s*json<\{ summary: AmazonProfit \}>/,
    "sales e profit voltaram a ser esperados juntos"
  );
  assert.match(s, /tasks\.push\(json<AmazonSales/, "o faturamento precisa ser tarefa própria");
  assert.match(s, /tasks\.push\(json<\{ summary: AmazonProfit \}>/, "o lucro precisa ser tarefa própria");
});

test("o coletor emite resultado parcial a cada canal", () => {
  const s = fonte("src/app/centralChannels.ts");
  assert.match(s, /aoAvancar\?:/, "faltou o callback de progresso");
  // Emitir ANTES da primeira chamada de rede é o que faz os quatro cards
  // aparecerem com nome e estado de conexão em vez de esqueleto cego.
  assert.match(s, /emitir\(\);/, "faltou a emissão inicial");
  assert.match(
    s,
    /Promise\.all\(tasks\.map\(\(tarefa\) => tarefa\.then\(emitir\)\)\)/,
    "as tarefas voltaram a ser esperadas em bloco"
  );
});

test("a tela consome o parcial e sai do estado de carregando", () => {
  const s = fonte("src/app/page.tsx");
  assert.match(s, /gatherCentralChannels\(\s*\(\{ channels: parciais/, "a página não passa o callback");
  // Sem cópia rasa o React não redesenha: o coletor muta os mesmos objetos.
  assert.match(s, /parciais\.map\(\(canal\) => \(\{ \.\.\.canal \}\)\)/);
});

test("lucro que falhou nao vira lucro zero", () => {
  const s = fonte("src/app/centralChannels.ts");
  // Separar as tarefas cria um estado novo: faturamento presente e lucro
  // ausente. Isso é `null`, e a nota tem que dizer o que houve — nunca deixar
  // parecer que a conta não deu lucro.
  assert.match(s, /lucroIndisponivel/);
  assert.match(s, /lucro exige uma conta Amazon conectada/);
});

test("a central nao se desculpa com adjetivo", () => {
  const s = fonte("src/app/centralChannels.ts");
  assert.doesNotMatch(s, /Lucro parcial/, "voltou a dizer 'parcial' em vez do que falta");
  assert.match(s, /unidade\(s\) sem custo cadastrado/);
});

test("a voz do NEXO tem estado de carregando na central, como no briefing", () => {
  // Ela viu em 24/08/2026: na Visão geral a faixa do NEXO não existia até o
  // texto chegar — um buraco silencioso onde depois aparece um bloco. Ficou mais
  // visível quando os cards passaram a pintar rápido.
  const central = fonte("src/app/page.tsx");
  const briefing = fonte("src/app/briefing/page.tsx");
  for (const [tela, s] of [["central", central], ["briefing", briefing]]) {
    assert.match(s, /<NexoMensagem carregando \/>/, `${tela} não mostra que está analisando`);
  }
  // O alerta por regra continua como rede de segurança: não depende de modelo e
  // sempre tem o que dizer.
  assert.match(central, /narracaoCarregando \? \(/);
  assert.match(central, /\) : alerta \? \(/);
});
