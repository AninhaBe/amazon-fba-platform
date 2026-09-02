import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

// Pedido da Ana, 31/08/2026: *"Todo click no dashboard (para Mercado Livre,
// Amazon, Shopee e TikTok) precisa entrar com o Hoje clicado ao inves de 30
// dias. O carregamento e mais rapido e a necessidade principal e saber o lucro
// de hoje."*

test("o padrao dos QUATRO canais e Hoje, e vem de um lugar so", async () => {
  // Um hook so serve os quatro dashboards. Dois padroes diferentes em dois
  // canais seria a inconsistencia que a regra de replicar existe para impedir.
  const hook = await fonte("src/app/components/DashboardPeriodFilter.tsx");
  // ⚠️ A CONSTANTE MUDOU DE ARQUIVO em 02/09/2026, e a guarda ficou MAIS FORTE:
  // ela agora exige que a fonte seja UMA para tela e SERVIDOR. O contrato dos
  // modulos roda no servidor e nao podia importar um modulo `use client`, entao
  // cada lado tinha o seu default — e eles discordavam (tela "today", servidor
  // "30"). O monitor mostrava 30 dias sob o rotulo "Hoje".
  const constante = await fonte("src/lib/periodoPadrao.ts");
  assert.match(constante, /export const PERIODO_PADRAO: Exclude<OpcaoDePeriodo, "custom"> = "today";/,
    "o padrao da casa continua sendo Hoje — decisao da Ana de 31/08/2026");
  assert.match(hook, /import \{ PERIODO_PADRAO \} from "@\/lib\/periodoPadrao";/,
    "a tela le a constante, nao declara a sua");
  const contrato = await fonte("src/lib/integrations/shopeeModuleContract.ts");
  assert.match(contrato, /import \{ PERIODO_PADRAO \} from "\.\.\/periodoPadrao";/,
    "o servidor le a MESMA constante");
  assert.match(contrato, /params\.get\("days"\) \?\? PERIODO_PADRAO/,
    "e o fallback do servidor sai dela — era aqui que morava o 30");
  // ⚠️ Proibicao olha o fonte SEM COMENTARIOS: o comentario que explica o defeito
  // cita o defeito.
  const semComentario = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/\?\?\s*"30"/.test(semComentario(contrato)),
    "o 30 nao pode voltar como literal no contrato");
  // ⚠️ EM 01/09/2026 O HOOK PASSOU A ACEITAR UM PADRAO POR TELA, para a Curva
  // ABC largar o seletor proprio dela sem mudar o que oferece. A guarda ficou
  // MAIS FORTE, nao mais fraca: alem de exigir que o padrao venha de
  // PERIODO_PADRAO quando ninguem sobrescreve, ela agora proibe os quatro
  // canais de sobrescrever. Antes isso nem era possivel, e nem era vigiado.
  assert.match(hook, /const padrao = opcoes\?\.padrao \?\? PERIODO_PADRAO;/, "o padrao da casa deixou de ser a base");
  assert.match(hook, /useState<DashboardPeriodOption>\(hasCustomPeriod \? "custom" : padrao\)/);
  assert.match(hook, /`days=\$\{padrao\}`/);
  assert.ok(!/"days=30"/.test(hook), "o 30 nao pode sobreviver escondido no estado inicial");

  for (const caminho of [
    "src/app/(app)/amazon/page.tsx",
    "src/app/components/MercadoLivreWorkspace.tsx",
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/TikTokWorkspace.tsx",
  ]) {
    const tela = await fonte(caminho);
    assert.match(tela, /useDashboardPeriod\(/, `${caminho}: precisa usar o hook compartilhado`);
    // Nenhum dos QUATRO pode declarar padrao proprio: o "Hoje" deles e o da
    // casa, e um canal com padrao escrito na tela e a divergencia de volta.
    //
    // ⚠️ ANCORADO NA CHAMADA, e a primeira versao desta linha nao estava — ela
    // procurava /padrao:/ no arquivo inteiro e reprovou o dashboard da Amazon
    // por causa do COMENTARIO "Aquecimento dos periodos padrao:". E a regra do
    // AGENTS.md pegando quem acabou de escreve-la, no mesmo dia.
    for (const chamada of tela.match(/useDashboardPeriod\([\s\S]{0,400}?\);/g) ?? []) {
      assert.ok(!/padrao:/.test(chamada), `${caminho}: canal nao pode ter padrao proprio`);
      assert.ok(!/presets:/.test(chamada), `${caminho}: canal oferece os quatro presets e o intervalo`);
    }
  }
});

test("nenhum canal reintroduz 30 dias pela porta do fallback", async () => {
  // As telas de modulo da Shopee e do TikTok montavam o periodo a partir da URL
  // e caiam em "30" quando ela vinha vazia — o padrao voltaria por ali.
  for (const caminho of ["src/app/components/ShopeeModulePage.tsx", "src/app/components/TikTokModulePage.tsx"]) {
    const tela = await fonte(caminho);
    assert.ok(!/get\("days"\)\s*\?\?\s*"30"/.test(tela), `${caminho}: fallback ainda diz 30 dias`);
    assert.match(tela, /get\("days"\)\s*\?\?\s*"today"/, `${caminho}: o fallback acompanha o padrao novo`);
  }
});

test("quem ESCOLHEU continua com a escolha — o padrao so vale para quem nao escolheu", async () => {
  // A escolha vive na URL. O efeito que le `days` da URL nao pode ser tocado
  // pelo padrao: sem isto, quem esta em 30 dias voltaria para Hoje ao recarregar
  // ou ao voltar pelo historico do navegador.
  const hook = await fonte("src/app/components/DashboardPeriodFilter.tsx");
  assert.match(hook, /if \(days === "today" \|\| days === "7" \|\| days === "15" \|\| days === "30"\)/);
  assert.match(hook, /hasCustomPeriod \? "custom"/, "periodo personalizado na URL tambem manda");
});

test("a central usa O MESMO seletor dos canais, e nao um parecido", async () => {
  // Pedido da Ana (31/08/2026): *"no dash de todos os dados integrados, alem de
  // deixar o hoje como default, coloque um filtro para data personalizada"*.
  //
  // ⚠️ O pedido revelou um buraco: a central NAO usava o hook — ela buscava os
  // quatro canais com `days=30` escrito no codigo. Por isso a troca do padrao
  // para Hoje nao tinha alcancado esta tela.
  const central = await fonte("src/app/(app)/page.tsx");
  // A ancora e o modulo; a profundidade do caminho mudou quando a central
  // entrou no route group `(app)` e nao e o que este teste garante.
  assert.match(central, /import \{ DashboardPeriodFilter, useDashboardPeriod \} from "[.\/]*components\/DashboardPeriodFilter"/);
  // ⚠️ `[^>]*` de proposito: o que esta guarda garante e que a central usa a
  // PECA COMPARTILHADA com o espalhamento de `period.filterProps`, nao que a
  // tag seja identica para sempre. Em 31/08/2026 ela ganhou `onIntent` e
  // `intencaoPor="foco"`, e casar a tag fechada reprovava um acrescimo que nao
  // viola nada — teste vermelho por motivo que nao e o produto.
  assert.match(central, /<DashboardPeriodFilter \{\.\.\.period\.filterProps\}[^>]*\/>/, "o Personalizado vem da peca compartilhada");
  assert.match(central, /useDashboardPeriod\(\)/);

  const coletor = await fonte("src/app/centralChannels.ts");
  assert.ok(!/days=30&connection_id|\/api\/sales\?days=30|\/api\/profit\?days=30/.test(coletor),
    "nenhuma chamada da central pode ter periodo fixo no codigo");
});

test("trocar o periodo REBUSCA, e o cache nao mistura recortes", async () => {
  // Cache sem periodo na chave pintaria o numero de 30 dias sob o rotulo "Hoje"
  // no primeiro quadro: numero certo, recorte errado.
  const central = await fonte("src/app/(app)/page.tsx");
  assert.match(central, /centralCache = new Map</, "o cache e por periodo");
  assert.match(central, /centralCache\.get\(period\.query\)/);
  assert.match(central, /\}, \[period\.query\]\);/, "o efeito depende do periodo");
});

test("a Shopee entra no periodo personalizado como os outros tres canais", async () => {
  // ⚠️ ESTE TESTE MUDOU DE INTENCAO, e a anterior fica registrada.
  //
  // ATE 31/08/2026 ele exigia o CONTRARIO: que a central RECUSASSE o intervalo
  // personalizado da Shopee, deixando o canal sem numero e dizendo por que. A
  // recusa estava certa enquanto a rota lia so `days` — mandar from/to faria a
  // resposta cair em 30 dias com rotulo de outro periodo.
  //
  // A rota passou a ler from/to no mesmo dia (4c1cc18) e a recusa ficou para
  // tras. Deixou de proteger e passou a MENTIR: a tela afirmava "a Shopee ainda
  // nao aceita periodo personalizado" sobre uma rota que aceita.
  //
  // A licao que este teste passa a guardar: recusa temporaria morre junto com a
  // limitacao que a justificou. Enquanto ela sobrevive, o teste que a guardava
  // defende o defeito — foi exatamente o que aconteceu aqui.
  const coletor = await fonte("src/app/centralChannels.ts");
  assert.doesNotMatch(
    coletor,
    /a Shopee ainda não aceita período personalizado/,
    "a recusa voltou, e a rota aceita from/to desde 4c1cc18",
  );
  assert.doesNotMatch(coletor, /intervaloPersonalizado/, "a bifurcacao da recusa nao pode voltar");
  // Ramificacao, nao identificador: a Shopee tem de ser buscada pelo MESMO `q`
  // que os outros canais, que carrega from/to quando existem.
  assert.match(coletor, /\/api\/integrations\/shopee\/overview\?\$\{q\}/);
});

test("a rota da Shopee USA from/to — nao apenas os le", async () => {
  // ⚠️ O TESTE ANTIGO DESTE DEFEITO CASAVA `searchParams.get("from")` E FICAVA
  // VERDE DEPOIS DE ALGUEM APAGAR O BLOCO QUE USAVA O VALOR (AGENTS.md). Aqui a
  // assercao e sobre a RAMIFICACAO: existe um caminho que so roda quando ha
  // from/to, e ele devolve o intervalo pedido — nao o preset.
  const rota = await fonte("src/app/api/integrations/shopee/overview/route.ts");
  assert.match(rota, /if \(fromValue \|\| toValue\) \{/, "sem a bifurcacao, o personalizado cai no preset");
  const ramo = rota.slice(rota.indexOf("if (fromValue || toValue) {"), rota.indexOf('if (daysParam === "today")'));
  assert.match(ramo, /return \{[\s\S]*from,[\s\S]*to: ate/, "o ramo tem de devolver as datas pedidas");
  assert.match(ramo, /RangeError/, "uma data so e pedido malformado, nao meio periodo");
});

test("a Curva ABC usa a peca compartilhada, e nao um segundo seletor", async () => {
  // Ate 01/09/2026 esta tela tinha o SEGUNDO seletor do produto: useState
  // proprio, botoes proprios e a lista 7/15/30 escrita nela. Nao havia mentira
  // na tela — ela nao oferecia intervalo e a rota le `days` —, mas era a forma
  // exata de divergencia que ja custou caro no default do servidor.
  const abc = await fonte("src/app/components/AbcView.tsx");
  assert.match(abc, /<DashboardPeriodFilter \{\.\.\.period\.filterProps\}[^>]*\/>/, "voltou o seletor proprio");
  assert.match(abc, /useDashboardPeriod\("", undefined, \{ padrao: "30", presets: PRESETS_DO_ABC \}\)/);

  // ⚠️ E o que a tela OFERECE nao pode ter mudado junto. Trocar a peca era para
  // matar a divergencia, nao para redesenhar a tela: 7/15/30, abrindo em 30.
  assert.match(abc, /const PRESETS_DO_ABC = \["7", "15", "30"\] as const;/);
  assert.ok(!/useState\(30\)/.test(abc), "sobrou o estado do seletor antigo");
  assert.ok(!/abc-period-tabs/.test(abc), "sobrou a marcacao do seletor antigo");
});

test("tela com presets proprios NAO oferece intervalo personalizado", async () => {
  // As rotas de ABC leem so `days`. Se o filtro mostrasse "Personalizado" ali,
  // a pessoa escolheria um intervalo, o botao ficaria marcado e a tela exibiria
  // OUTRO periodo — o defeito do from/to da Shopee, de novo.
  const filtro = await fonte("src/app/components/DashboardPeriodFilter.tsx");
  assert.match(filtro, /const ofereceIntervalo = !presets;/);
  assert.match(filtro, /\{ofereceIntervalo && <button type="button" aria-pressed=\{selected === "custom"\}/);
  assert.match(filtro, /\{ofereceIntervalo && selected === "custom" && <div className="dashboard-custom-period">/);
});
