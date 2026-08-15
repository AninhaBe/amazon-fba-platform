import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Paridade com a Amazon (auditoria de 15/08/2026): `null` ≠ `0`.
//
// O ML fazia `Number(metadata.taxRate ?? 0)`. Quem nunca configurou era tratado
// como ISENTO: o painel exibia "Impostos (0%) R$ 0,00" e o lucro parecia líquido
// de tudo. "Não sei" virava fato falso — e, pior, era o canal que servia de
// referência quando eu disse que o ML "já descontava imposto".
//
// Estes testes leem o fonte porque os módulos do ML puxam banco e rede na cadeia
// de imports; não sobrevivem ao strip-only mode.

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

test("a aliquota nao configurada e null, nunca zero", () => {
  const s = fonte("src/lib/integrations/mercadoLivre.ts");
  assert.match(s, /export function mercadoLivreTaxRate\([^)]*\): number \| null/);
  assert.doesNotMatch(s, /Number\(connection\.metadata\.taxRate \?\? 0\)/, "o `?? 0` era o defeito");
});

test("imposto desconhecido nao vira zero nos dois caminhos de leitura", () => {
  for (const modulo of [
    "src/lib/integrations/mercadoLivre.ts",              // caminho legado
    "src/lib/integrations/mercadoLivreOverviewCanonical.ts", // caminho por SQL
  ]) {
    const s = fonte(modulo);
    assert.match(s, /const taxes = taxRate == null \? null :/, `${modulo}: total precisa ser null sem aliquota`);
    assert.match(s, /const lineTax = taxRate == null \? null :/, `${modulo}: linha precisa ser null sem aliquota`);
  }
});

test("o lucro exibido nao muda para quem nunca configurou", () => {
  // Regra deliberada: sem alíquota o lucro sai SEM imposto, como sempre saiu.
  // Zerar o imposto no cálculo e avisar na tela é diferente de recalcular o
  // resultado que ela já conhece — isso seria mudar número sem ela pedir.
  for (const modulo of [
    "src/lib/integrations/mercadoLivre.ts",
    "src/lib/integrations/mercadoLivreOverviewCanonical.ts",
  ]) {
    assert.match(fonte(modulo), /processedRevenue - fees - cogs - \(taxes \?\? 0\) - sellerShipping/, modulo);
  }
});

test("a tela nao afirma isencao quando a aliquota falta", () => {
  const s = fonte("src/app/components/MercadoLivreWorkspace.tsx");
  assert.match(s, /Alíquota não configurada/, "precisa dizer que falta, em vez de exibir 0%");
  // `taxRate.toLocaleString` direto estoura com null e derruba a pagina.
  assert.doesNotMatch(s, /profit\.taxRate\.toLocaleString/, "acesso direto quebra com null");
});

test("a calculadora nao pre-preenche zero nem escreve 'null' no campo", () => {
  const s = fonte("src/app/mercado-livre/calculadora/page.tsx");
  assert.doesNotMatch(s, /useState\("0"\);\s*$/m, "campo com 0 afirma isencao antes de a pessoa informar");
  assert.doesNotMatch(s, /setTaxRate\(String\(data\.taxRate\)\)/, "String(null) escreve 'null' no input");
  assert.match(s, /data\.taxRate == null \? "" : String\(data\.taxRate\)/);
});

test("da para limpar a aliquota e voltar para 'nao sei'", () => {
  const s = fonte("src/app/api/integrations/mercado-livre/settings/route.ts");
  assert.match(s, /bruto === null/, "POST precisa aceitar null para limpar");
  assert.match(s, /delete semAliquota\.taxRate/, "limpar remove a chave, nao grava 0");
});

test("a curva ABC acompanha o mesmo contrato", () => {
  const s = fonte("src/lib/integrations/mercadoLivreAbc.ts");
  assert.match(s, /taxRate: number \| null/);
  assert.match(s, /taxRate == null \? 0 : acc\.revenue \* taxRate \/ 100/);
});
