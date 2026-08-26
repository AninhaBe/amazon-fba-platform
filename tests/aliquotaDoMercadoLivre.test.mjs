import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dicaDoImposto } from "../src/app/mercado-livre/calculadora/dicaDoImposto.ts";

const arquivo = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// TRÊS DEFEITOS DA ALÍQUOTA DO MERCADO LIVRE, TODOS ACHADOS EM 25-26/08/2026.
//
// O sintoma foi um só e demorou horas para ser diagnosticado: o dashboard do
// canal com Lucro e Margem em "—" enquanto o lucro existia e valia R$ 61,89
// (margem 3,0%). A alíquota "tinha sido cadastrada" e nunca aparecia.
//
// A causa raiz não estava no cálculo — o backend calcula normal, com
// `taxes ?? 0`. Estava em a interface ter DOIS campos de alíquota, um que salva
// e outro que finge.
// ---------------------------------------------------------------------------

test("o campo da calculadora nunca afirma que salvou", () => {
  // O texto antigo era "Alíquota configurada" para qualquer número digitado.
  assert.equal(dicaDoImposto("5", null), "Simulação — nada salvo ainda; salve em Produtos");
  assert.match(dicaDoImposto("5", 8), /Simulação — a salva é 8%/);
});

test("so diz 'salva' quando o campo BATE com o que esta na conta", () => {
  assert.equal(dicaDoImposto("5", 5), "Alíquota salva na sua conta");
  // Mesma alíquota escrita de três jeitos continua sendo a mesma.
  assert.equal(dicaDoImposto("5.0", 5), "Alíquota salva na sua conta");
  assert.equal(dicaDoImposto("5,00", 5), "Alíquota salva na sua conta");
});

test("sem nada configurado, a dica diz ONDE resolver", () => {
  // AGENTS.md: dizer o que falta e onde, não um adjetivo que se desculpa.
  const d = dicaDoImposto("", null);
  assert.match(d, /Não configurada/);
  assert.match(d, /salve em Produtos/);
  assert.doesNotMatch(d, /parcial|incompleto/i);
});

test("campo vazio com aliquota salva e simulacao, nao 'nao configurada'", () => {
  assert.match(dicaDoImposto("", 5), /Simulando sem imposto — a salva é 5%/);
});

test("limpar a aliquota grava null em vez de apagar a chave", () => {
  // `saveIntegration` funde com `metadata || EXCLUDED.metadata`. O jsonb `||`
  // só ADICIONA e sobrescreve — nunca REMOVE. O código antigo fazia
  // `delete metadata.taxRate` e a fusão mantinha o valor velho: quem cadastrava
  // 8% e tentava limpar continuava com 8%, e a tela dizia que tinha limpado.
  const rota = arquivo("src/app/api/integrations/mercado-livre/settings/route.ts");
  assert.match(rota, /metadata: \{ \.\.\.connection\.metadata, taxRate: null \}/);
  // `^\s*delete` e não `/delete/`: o comentário da própria correção cita o
  // código antigo, e a busca solta casava com ele em vez de com instrução.
  assert.doesNotMatch(rota, /^\s*delete\s+\w+\.taxRate/m, "apagar a chave não sobrevive à fusão do jsonb");
});

test("a fusao do metadata continua sendo por soma - o motivo do null", () => {
  // Se um dia isto virar substituição, o `taxRate: null` acima pode voltar a
  // ser um `delete`. Enquanto for `||`, não pode.
  const store = arquivo("src/lib/integrations/integrationStore.ts");
  assert.match(store, /metadata\s+= workspace_integrations\.metadata \|\| EXCLUDED\.metadata/);
});

test("null continua significando 'nao configurada' na leitura", () => {
  const ml = arquivo("src/lib/integrations/mercadoLivre.ts");
  assert.match(ml, /if \(bruto == null \|\| bruto === ""\) return null;/);
});

test("o erro de salvar mostra o motivo real, nao o palpite", () => {
  // Qualquer falha exibia "Informe um percentual entre 0 e 100" — culpando o
  // número digitado, que estava certo. Foi isso que escondeu o problema.
  const pagina = arquivo("src/app/mercado-livre/produtos/page.tsx");
  assert.match(pagina, /setTaxError\(reason instanceof Error \? reason\.message/);
  assert.match(pagina, /taxError \?\? "Não foi possível salvar a alíquota\."/);
});

test("a calculadora nao tem como salvar - por isso a dica avisa", () => {
  // Documenta a dependência: se um dia a calculadora ganhar um POST para
  // /settings, a dica pode voltar a dizer "configurada" ao digitar.
  const calc = arquivo("src/app/mercado-livre/calculadora/page.tsx");
  const posts = calc.split('method: "POST"').length - 1;
  assert.ok(posts > 0, "a calculadora faz POST, mas para /calculator");
  const paraSettings = /settings"[^}]*method: "POST"|method: "POST"[^}]*settings"/.test(calc);
  assert.equal(paraSettings, false, "se passar a salvar, revise dicaDoImposto");
});
