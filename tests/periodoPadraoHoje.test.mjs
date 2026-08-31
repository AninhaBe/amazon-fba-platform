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
