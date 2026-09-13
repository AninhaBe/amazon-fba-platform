import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) =>
  codigo.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * DEFEITO QUE ESTES TESTES REPROVAM: em 13/09/2026 o dashboard da Amazon já
 * usava o esqueleto do ML, mas as três superfícies seguintes ainda pertenciam
 * à linguagem antiga. O Monitor tinha uma terceira aba, o Radar tinha tabela e
 * faixa próprias, e Anúncios não continha o catálogo/custos que Produtos tinha.
 * A troca precisa retirar a montagem anterior; somar a nova deixaria duas
 * leituras do mesmo dado, o defeito que já ocorreu na v288.
 */
test("o Monitor Amazon usa as duas abas v3 do ML e abre em Rentabilidade", async () => {
  const codigo = semComentarios(await fonte("src/app/(app)/monitor/page.tsx"));
  assert.ok(codigo.includes('type MonitorSection = "transactions" | "profitability";'));
  assert.ok(codigo.includes('return pedida === "transactions" ? "transactions" : "profitability";'));
  assert.ok(codigo.includes('className="v3-abas"'));
  assert.ok(
    codigo.indexOf("Rentabilidade por venda") < codigo.indexOf("Transações"),
    "Rentabilidade precisa ser a primeira aba, como no ML"
  );
  assert.match(codigo, /<OrderProfitabilityTableV3\s+canal=\{CANAL_AMAZON\}/);
  assert.ok(!codigo.includes('className="monitor-section-tabs"'));
  assert.ok(!codigo.includes('section === "composition"'));
});

test("a reconciliação própria da Amazon continua dentro de Transações", async () => {
  const codigo = semComentarios(await fonte("src/app/(app)/monitor/page.tsx"));
  const transacoes = codigo.indexOf('section === "transactions"');
  const rentabilidade = codigo.indexOf('section === "profitability"');
  assert.ok(transacoes >= 0 && rentabilidade > transacoes);
  const ramo = codigo.slice(transacoes, rentabilidade);
  assert.ok(ramo.includes("aguardandoConfirmacao"), "sumiu o valor que a Amazon ainda não publicou");
  assert.ok(ramo.includes("feeBreakdown.map"), "sumiu a decomposição da tarifa por tipo");
  assert.ok(ramo.includes("nomeDaTarifa(fee.type)"), "a tarifa perdeu o vocabulário vindo da fonte Amazon");
});

test("o Radar Amazon usa faixa, filtros e grade v3, mantendo zero como fato", async () => {
  const codigo = semComentarios(await fonte("src/app/(app)/estoque/page.tsx"));
  assert.ok(codigo.includes('className="v3 inventory-family-body"'));
  assert.ok(codigo.includes('className="v3-card v3-faixa"'));
  assert.ok(codigo.includes('className="v3-filtros"'));
  assert.ok(codigo.includes('className="v3-tabela v3-tabela-estoque'));
  assert.ok(codigo.includes('r.daysRemaining === 0'));
  assert.ok(codigo.includes('? "esgotado"'));
  assert.ok(codigo.includes("r.inbound.toLocaleString"), "zero a caminho não pode virar travessão");
  assert.ok(codigo.includes("r.unitsSold.toLocaleString"), "zero vendido não pode virar travessão");
  assert.ok(!codigo.includes('label: "Ok"'), "o mesmo estado precisa se chamar Saudável nos dois canais");
});

test("Anúncios Amazon absorve Produtos com as peças do catálogo do ML", async () => {
  const codigo = semComentarios(await fonte("src/app/(app)/amazon/anuncios/page.tsx"));
  for (const trecho of [
    'className="v3 meli-listings-page',
    'fetch("/api/products"',
    'fetch("/api/integrations/amazon/settings"',
    "<SortButton",
    "product.imageUrl",
    "v3-custo-campo",
    "Custo unitário",
    "Alíquota da sua empresa",
  ]) assert.ok(codigo.includes(trecho), `faltou no catálogo Amazon: ${trecho}`);

  const produtos = semComentarios(await fonte("src/app/(app)/produtos/page.tsx"));
  assert.match(produtos, /redirect\("\/amazon\/anuncios"\)/);
});

test("zero de custo é conhecido e vazio continua desconhecido no catálogo Amazon", async () => {
  const codigo = semComentarios(await fonte("src/app/(app)/amazon/anuncios/page.tsx"));
  assert.ok(codigo.includes("product.cost != null"));
  assert.ok(codigo.includes('placeholder="—"'));
  assert.ok(!codigo.includes("product.cost > 0"));
  assert.ok(!codigo.includes("p.cost ?? 0"));
});

test("a conta Amazon aparece como selo no topo e sai do select cru da sidebar", async () => {
  const telas = [
    "src/app/(app)/amazon/page.tsx",
    "src/app/(app)/monitor/page.tsx",
    "src/app/(app)/estoque/page.tsx",
    "src/app/(app)/amazon/anuncios/page.tsx",
  ];
  for (const tela of telas) {
    const codigo = semComentarios(await fonte(tela));
    assert.ok(codigo.includes('<AccountSwitcher appearance="chip" />'), `${tela} ficou sem selo da conta`);
  }
  const sidebar = semComentarios(await fonte("src/app/components/SidebarNexo.tsx"));
  assert.ok(!sidebar.includes("<AccountSwitcher compact"), "o select cru continua no rodapé da sidebar");
  const switcher = semComentarios(await fonte("src/app/components/AccountSwitcher.tsx"));
  assert.ok(switcher.includes('appearance === "chip"'));
  assert.ok(switcher.includes('className="meli-account-chip amazon-account-chip"'));
});
