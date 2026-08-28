import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Briefing por canal (decisão da Ana, 27/08/2026, revendo a de 23/08): a
// entrada lateral de um canal aponta para /{canal}/briefing — a pessoa não sai
// do contexto do canal — e o briefing global continua na Visão geral. Uma
// implementação só (BriefingView), escopada pelo provider.

test("a lateral de cada canal aponta para o briefing DO CANAL; a Visão geral mantém o global", async () => {
  const nav = await readFile(new URL("../src/app/components/Nav.tsx", import.meta.url), "utf8");
  for (const base of ["/amazon", "/mercado-livre", "/shopee", "/tiktok"]) {
    assert.match(nav, new RegExp(`briefingDoCanal\\("${base}"\\)`), `${base} sem entrada de briefing do canal`);
  }
  assert.match(nav, /BRIEFING_GLOBAL/);
  assert.match(nav, /href: "\/briefing"/);
});

test("as 4 rotas de canal renderizam o BriefingView com o provider certo", async () => {
  const rotas = [
    ["../src/app/amazon/briefing/page.tsx", "amazon"],
    ["../src/app/mercado-livre/briefing/page.tsx", "mercado_livre"],
    ["../src/app/shopee/briefing/page.tsx", "shopee"],
    ["../src/app/tiktok/briefing/page.tsx", "tiktok_shop"],
  ];
  for (const [rota, provider] of rotas) {
    const fonte = await readFile(new URL(rota, import.meta.url), "utf8");
    assert.match(fonte, new RegExp(`provider: "${provider}"`), `${rota} sem o provider ${provider}`);
    assert.match(fonte, /BriefingView/);
    assert.doesNotMatch(fonte, /export \{ default \}/, "a rota de canal não pode voltar a ser alias do briefing global");
  }
});

test("o BriefingView escopa insights, financeiro e narração pelo canal", async () => {
  const view = await readFile(new URL("../src/app/components/BriefingView.tsx", import.meta.url), "utf8");
  assert.match(view, /insight\.provider === provider/);
  assert.match(view, /channels\.filter\(\(c\) => c\.id === provider\)/);
  assert.match(view, /escopo=\$\{escopoNarracao\}/);
  assert.match(view, /escopo: escopoNarracao/);
});

test("canal sem detector mostra o estado honesto, sem fingir análise", async () => {
  const view = await readFile(new URL("../src/app/components/BriefingView.tsx", import.meta.url), "utf8");
  assert.match(view, /Nenhuma prioridade detectada ainda para este canal/);
  // "Tudo sob controle" continua reservado a quem TEM detector rodando.
  assert.match(view, /temDetector \? \(/);
});
