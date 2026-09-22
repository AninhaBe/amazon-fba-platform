import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { produtosDoTopAmazon } from "../src/app/(app)/amazon/amazonPainelV3.ts";

// O DEFEITO (print da dona, 21/09/2026): o "Top 8 produtos" da Amazon mostrava
// margem de 60-75% — markup bruto `(preço - custo) / preço` —, ignorando a
// tarifa da Amazon (~40% do preço em FBA) e o imposto. A margem REAL dos mesmos
// produtos é 10-20% (validado nos dados da conta, e bate com os ~14% do Gestor
// Seller). A coluna "Contribuição" ao lado saía SEMPRE "—", o que deixava o
// absurdo sem contraprova na tela.
//
// A causa era falta de CÁLCULO, não de dado: a tarifa (comissão + FBA, com a
// estimativa da ADR-027) e o custo já estavam no banco. O ML já apurava a
// contribuição por produto no período inteiro (13/09, `topProdutosSemTeto`); a
// Amazon nunca ganhou esse tratamento.

test("produtosDoTopAmazon PREENCHE a contribuição quando ela existe (não é mais travessão fixo)", () => {
  const linha = produtosDoTopAmazon(
    [{ sku: "KIT2-TABUACORTE", title: "Kit 2 Tábuas", units: 84, revenue: 3939.6, contribution: 701.3, marginPct: 17.8 }],
    "BRL",
  )[0];
  // A contribuição vira dinheiro — antes era "—" cravado, então esta asserção
  // ficava VERMELHA com o defeito (medido: revertendo a linha do mapper).
  assert.notEqual(linha.contribuicao, "—", "a contribuição existe e não pode virar travessão");
  assert.match(linha.contribuicao, /701,30/, "a contribuição é o valor real formatado em BRL");
  assert.equal(linha.margemPct, 17.8, "a margem passa direto do produtor (contribuição / faturamento)");
});

test("produtosDoTopAmazon mantém travessão quando a contribuição é null (null ≠ 0)", () => {
  const linha = produtosDoTopAmazon(
    [{ sku: "SEM-CONTA", title: "x", units: 1, revenue: 10, contribution: null, marginPct: null }],
    "BRL",
  )[0];
  assert.equal(linha.contribuicao, "—", "contribuição desconhecida é travessão, nunca R$ 0,00");
  assert.equal(linha.margemPct, null);
});

// GUARDA DE FONTE no produtor canônico: a margem do Top NÃO pode voltar a ser o
// markup bruto. Olha o fonte SEM comentários (o comentário que explica a
// remoção CITA a fórmula proibida — regra da casa, 01/09/2026).
test("o canônico calcula a margem do Top por CONTRIBUIÇÃO, nunca por (preço - custo)/preço", () => {
  const fonte = readFileSync(
    new URL("../src/lib/integrations/amazonOverviewCanonical.ts", import.meta.url),
    "utf8",
  );
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  // Proíbe a fórmula do markup (o defeito exato).
  assert.doesNotMatch(codigo, /\(salePrice - cost\) \/ salePrice/,
    "voltou o markup bruto no Top — ele ignora a tarifa da Amazon e infla a margem");
  // Exige que a margem venha da contribuição / faturamento.
  assert.match(codigo, /marginPct = contribution != null && revenue > 0/,
    "a margem do Top tem de sair da contribuição, não do preço");
  // Exige a apuração por produto do PERÍODO (fora do teto de 1000): a tarifa por
  // produto sai da view `_efetivas`, não do laço detalhado.
  assert.match(codigo, /BOOL_AND\(tem_tarifa\) AS completo/,
    "a apuração por produto precisa vir do SQL do período (senão o teto de 1000 mata a margem do Top)");
});
