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
  // ⚠️ O CAMINHO GANHOU UM DEGRAU em 31/08/2026: a coleta passou a sair por
  // `coletarCentral`, que a envolve no controle de voo para o aquecimento por
  // foco nao duplicar os quatro canais. O que esta guarda garante continua o
  // mesmo — a tela recebe o PARCIAL e sai do carregando —, entao ela cobre os
  // dois degraus em vez de casar a chamada antiga.
  assert.match(s, /gatherCentralChannels\(\s*\(parcial\) => aoParcial\?\.\(parcial\)/, "coletarCentral não repassa o parcial");
  assert.match(s, /await coletarCentral\(\s*period\.query,\s*\(\{ channels: parciais/, "a página não passa o callback");
  // Sem cópia rasa o React não redesenha: o coletor muta os mesmos objetos.
  assert.match(s, /parciais\.map\(\(canal\) => \(\{ \.\.\.canal \}\)\)/);
  assert.match(s, /setLoading\(false\);/);
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

test("a leitura do NEXO vive nos dashboards de CANAL, nao na Visao geral", () => {
  // Mudou em 24/08/2026. A faixa ficava na Visão geral e no Briefing, e ela
  // pediu o contrário: "não precisa aparecer no visão geral, não acho
  // necessário" — a central é passagem, o trabalho é no canal.
  //
  // E antes disso ela matou a ideia do shimmer: gerar leva ~18s, e "como ela vai
  // saber que algo vai aparecer? ela vai ficar navegando em outras telas". Por
  // isso o componente de canal só LÊ o texto pronto; nunca fica esperando.
  const canais = [
    ["src/app/amazon/page.tsx", "Amazon"],
    ["src/app/components/MercadoLivreWorkspace.tsx", "Mercado Livre"],
    ["src/app/components/ShopeeWorkspace.tsx", "Shopee"],
    ["src/app/components/TikTokWorkspace.tsx", "TikTok Shop"],
  ];
  for (const [caminho, canal] of canais) {
    assert.match(fonte(caminho), /<NexoDoDia \/>/, `${canal} não mostra a leitura do NEXO`);
  }
  const central = fonte("src/app/page.tsx");
  assert.doesNotMatch(central, /<NexoMensagem/, "a faixa voltou para a Visão geral");
});

test("o componente de canal nao gera narracao nem fica esperando", () => {
  const s = fonte("src/app/components/NexoDoDia.tsx");
  // GET é o caminho rápido: devolve o que já foi escrito hoje. POST geraria — e
  // gerar numa tela de canal traria de volta os 18 segundos de espera.
  assert.match(s, /fetch\("\/api\/central\/briefing\?modo=resumo"/);
  assert.doesNotMatch(s, /method:\s*"POST"/, "o canal não pode disparar geração");
  // Procura o USO da prop, não a palavra: o comentário do arquivo explica
  // justamente por que ele não carrega, e a busca crua reprovava o próprio texto.
  assert.doesNotMatch(s, /<NexoMensagem\s+carregando/, "o canal não pode ficar em estado de carregando");
  assert.match(s, /if \(!texto\) return null;/, "sem texto pronto, o bloco não existe");
});

test("a Visao geral continua DISPARANDO a geracao", () => {
  // Ela saiu da tela, não do fluxo: se a central parar de gerar, os quatro
  // canais ficam sem texto para exibir.
  assert.match(fonte("src/app/page.tsx"), /method: "POST"[\s\S]{0,120}central\/briefing|central\/briefing[\s\S]{0,120}method: "POST"/);
});
