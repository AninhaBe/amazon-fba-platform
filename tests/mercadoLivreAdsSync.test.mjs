import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { conferirContraCampanha, deduplicarAnuncios } from "../src/lib/integrations/mercadoLivreAdsSync.ts";

// Coleta de Product Ads do ML (28/08/2026). A armadilha central foi medida pelo
// Delta na conta real: o MESMO item_id volta com `status` diferentes e métricas
// IDÊNTICAS, e somar cru infla o gasto em 23%.

/** Os dados exatos que o Delta mediu na sonda (pads6-resultado.txt). */
const MEDIDO_NA_CONTA_REAL = [
  { item_id: "MLB6976501556", campaign_id: 357954639, status: "hold", metrics: { clicks: 23, prints: 9600, cost: 6.36, acos: 6.98, units_quantity: 2 } },
  { item_id: "MLB6976501556", campaign_id: 357954639, status: "deleted", metrics: { clicks: 23, prints: 9600, cost: 6.36, acos: 6.98, units_quantity: 2 } },
  { item_id: "MLB6926133280", campaign_id: 357954639, status: "hold", metrics: { clicks: 26, prints: 17379, cost: 9.68, acos: 23.93, units_quantity: 1 } },
  { item_id: "MLB6926133272", campaign_id: 358430627, status: "deleted", metrics: { clicks: 1, prints: 876, cost: 0.52, acos: 0, units_quantity: 0 } },
  { item_id: "MLB6926133272", campaign_id: 358430627, status: "hold", metrics: { clicks: 1, prints: 876, cost: 0.52, acos: 0, units_quantity: 0 } },
  { item_id: "MLB5026420547", campaign_id: 357954639, status: "hold", metrics: { clicks: 42, prints: 18738, cost: 13.06, acos: 12.19, units_quantity: 3 } },
];

test("deduplica por (campanha, item) — o mesmo anúncio com status diferente não conta duas vezes", () => {
  const unicos = deduplicarAnuncios(MEDIDO_NA_CONTA_REAL);
  assert.equal(unicos.length, 4, "6 linhas cruas viram 4 anúncios reais");
  // Os dois pares duplicados sumiram; nenhum anúncio verdadeiro foi perdido.
  assert.deepEqual(
    unicos.map((a) => a.item_id).sort(),
    ["MLB5026420547", "MLB6926133272", "MLB6926133280", "MLB6976501556"],
  );
  // Anúncio sem item_id não entra (não há chave para deduplicar nem para gravar).
  assert.equal(deduplicarAnuncios([{ campaign_id: 1, metrics: { clicks: 5 } }]).length, 0);
});

test("somar cru inflaria o gasto — a diferença medida na conta real era de 23%", () => {
  const cru = MEDIDO_NA_CONTA_REAL.reduce((s, a) => s + a.metrics.cost, 0);
  const limpo = deduplicarAnuncios(MEDIDO_NA_CONTA_REAL).reduce((s, a) => s + a.metrics.cost, 0);
  assert.equal(+cru.toFixed(2), 36.5, "soma crua dos 6 registros");
  assert.equal(+limpo.toFixed(2), 29.62, "soma dos 4 anúncios reais — bate com o nível campanha");
  // 6,88 de diferença: exatamente os dois pares duplicados.
  assert.equal(+(cru - limpo).toFixed(2), 6.88);
});

test("a verificação de sanidade da própria fonte: anúncios têm que bater com campanhas", () => {
  const unicos = deduplicarAnuncios(MEDIDO_NA_CONTA_REAL);
  // O total de campanha medido pelo Delta.
  const ok = conferirContraCampanha(unicos, { clicks: 92, cost: 29.62 });
  assert.equal(ok.confere, true);
  assert.equal(ok.cliquesDiferenca, 0);
  assert.equal(ok.gastoDiferenca, 0);
  assert.equal(ok.houveDivergencia, false, "bateu exato: nada a registrar");
  // Sem deduplicar, a conferência DENUNCIA — que é o ponto dela.
  const torto = conferirContraCampanha(MEDIDO_NA_CONTA_REAL, { clicks: 92, cost: 29.62 });
  assert.equal(torto.confere, false);
  assert.equal(torto.cliquesDiferenca, 24);
  assert.equal(torto.gastoDiferenca, 6.88);
  assert.equal(torto.gastoDiferencaPct, 23.228, "23% — quatrocentas vezes acima da tolerância");
});

test("a tolerância aceita a fonte se movendo, mas NÃO em silêncio", () => {
  // O caso REAL do primeiro ciclo em produção: +2 cliques e +R$0,52 sobre
  // 1.364 cliques e R$814,87 — a fonte viva mexendo entre as duas chamadas.
  const anuncios = [{ item_id: "A", campaign_id: 1, metrics: { clicks: 1364, cost: 814.87 } }];
  const c = conferirContraCampanha(anuncios, { clicks: 1362, cost: 814.35 });
  assert.equal(c.confere, true, "0,06% cabe na faixa: alarme que grita todo ciclo vira ruído ignorado");
  // ⚠️ Mas a divergência É registrada — tolerância silenciosa esconde tendência.
  assert.equal(c.houveDivergencia, true);
  assert.equal(c.gastoDiferencaPct, 0.064, "o percentual é o número que revela piora ao longo do tempo");
});

test("a faixa é proporcional: 1% do total ou 3 cliques, o que for maior", () => {
  // Conta pequena: o piso de 3 cliques protege quem tem pouco volume.
  const pequena = conferirContraCampanha(
    [{ item_id: "A", campaign_id: 1, metrics: { clicks: 13, cost: 10.05 } }],
    { clicks: 10, cost: 10 },
  );
  assert.equal(pequena.confere, true, "3 cliques de diferença em conta pequena ainda cabe");
  const pequenaDemais = conferirContraCampanha(
    [{ item_id: "A", campaign_id: 1, metrics: { clicks: 14, cost: 10 } }],
    { clicks: 10, cost: 10 },
  );
  assert.equal(pequenaDemais.confere, false, "4 cliques já estoura o piso");
  // Conta grande: 1% manda, e a duplicata de 23% continua sendo pega.
  const duplicataGrande = conferirContraCampanha(
    [{ item_id: "A", campaign_id: 1, metrics: { clicks: 1230, cost: 1230 } }],
    { clicks: 1000, cost: 1000 },
  );
  assert.equal(duplicataGrande.confere, false);
});

test("divergência é LOGADA, nunca corrigida em silêncio — dinheiro que não fecha precisa de gente", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/mercadoLivreAdsSync.ts", import.meta.url), "utf8");
  assert.match(fonte, /if \(!sanidade\.confere\) \{[\s\S]{0,200}console\.error/);
  assert.match(fonte, /Log, não conserto/);
  // E grava linha a linha (é o que faz a PK da 0016 proteger por construção).
  //
  // ⚠️ A regex aceita o laço em bloco desde 31/08/2026: a chamada ganhou o
  // argumento de procedência (`janelaEmDias`/`consolidando`) e não cabia mais em
  // uma linha. A EXIGÊNCIA não mudou — uma escrita por anúncio, sem agregar
  // antes —, e quem guarda isso de verdade é o `doesNotMatch` do `reduce`
  // abaixo. Casar a formatação em vez do comportamento deixa o teste vermelho
  // por motivo que não é o produto, e teste assim ensina a ignorar vermelho.
  assert.match(fonte, /for \(const anuncio of unicos\)[\s\S]{0,40}gravarAnuncio\(/);
  assert.doesNotMatch(fonte, /reduce[\s\S]{0,80}gravarAnuncio/, "nada de somar antes de gravar");
});

test("os caminhos e cabeçalhos do PADS estão exatos — os 404 já foram pagos uma vez", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/mercadoLivreAdsSync.ts", import.meta.url), "utf8");
  assert.match(fonte, /\/advertising\/advertisers\?product_id=PADS/);
  assert.match(fonte, /"Api-Version": "1"/, "grafia com maiúsculas na rota de advertisers");
  assert.match(fonte, /\/marketplace\/advertising\/\$\{advertiser\.site_id\}\/advertisers\/\$\{advertiser\.advertiser_id\}\/product_ads/,
    "o prefixo /marketplace/ é obrigatório");
  assert.match(fonte, /\/ads\/search\?/, "o /search no fim é obrigatório");
  assert.match(fonte, /"api-version": "2"/, "grafia minúscula nas rotas de product_ads");
});

test("o que é só do ML vai para extra_metrics — a coluna sales guarda a receita DIRETA", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/mercadoLivreAdsSync.ts", import.meta.url), "utf8");
  // cvr, sov, indireta e orgânica não têm coluna própria: a 0016 previu isso.
  assert.match(fonte, /cvr: m\.cvr \?\? null/);
  assert.match(fonte, /sov: m\.sov \?\? null/);
  assert.match(fonte, /indirect_amount: m\.indirect_amount \?\? null/);
  assert.match(fonte, /organic_units_quantity: m\.organic_units_quantity \?\? null/);
  // A coluna `sales` recebe só a direta — somar tudo mudaria o significado.
  assert.match(fonte, /m\.direct_amount \?\? 0/);
  // E o acos=0 da fonte é gravado como veio: quem distingue é a leitura.
  assert.match(fonte, /m\.acos \?\? null/);
  assert.match(fonte, /Gravamos como a fonte manda/);
});
