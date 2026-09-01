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
  assert.match(hook, /const PERIODO_PADRAO: Exclude<DashboardPeriodOption, "custom"> = "today";/);
  assert.match(hook, /useState<DashboardPeriodOption>\(hasCustomPeriod \? "custom" : PERIODO_PADRAO\)/);
  assert.match(hook, /`days=\$\{PERIODO_PADRAO\}`/);
  assert.ok(!/"days=30"/.test(hook), "o 30 nao pode sobreviver escondido no estado inicial");

  for (const caminho of [
    "src/app/amazon/page.tsx",
    "src/app/components/MercadoLivreWorkspace.tsx",
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/TikTokWorkspace.tsx",
  ]) {
    const tela = await fonte(caminho);
    assert.match(tela, /useDashboardPeriod\(/, `${caminho}: precisa usar o hook compartilhado`);
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
  const central = await fonte("src/app/page.tsx");
  assert.match(central, /import \{ DashboardPeriodFilter, useDashboardPeriod \} from ".\/components\/DashboardPeriodFilter"/);
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
  const central = await fonte("src/app/page.tsx");
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
