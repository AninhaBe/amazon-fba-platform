import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dicaDoImposto } from "../src/lib/aliquota.ts";

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
  assert.equal(dicaDoImposto("5", null), "Simulação — nada salvo ainda; salve na Visão geral");
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
  assert.match(d, /salve na Visão geral/);
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
  const pagina = arquivo("src/app/(app)/mercado-livre/produtos/page.tsx");
  assert.match(pagina, /setTaxError\(reason instanceof Error \? reason\.message/);
  assert.match(pagina, /taxError \?\? "Não foi possível salvar a alíquota\."/);
});

test("a calculadora nao tem como salvar - por isso a dica avisa", () => {
  // Documenta a dependência: se um dia a calculadora ganhar um POST para
  // /settings, a dica pode voltar a dizer "configurada" ao digitar.
  const calc = arquivo("src/app/(app)/mercado-livre/calculadora/page.tsx");
  const posts = calc.split('method: "POST"').length - 1;
  assert.ok(posts > 0, "a calculadora faz POST, mas para /calculator");
  const paraSettings = /settings"[^}]*method: "POST"|method: "POST"[^}]*settings"/.test(calc);
  assert.equal(paraSettings, false, "se passar a salvar, revise dicaDoImposto");
});

// ---------------------------------------------------------------------------
// O PAINEL ÚNICO DA VISÃO GERAL (26/08/2026).
//
// Pedido dela: *"cada integração pode ter sua própria alíquota, não assuma que
// o que será cadastrado no ML poderá refletir também para amazon e assim vai"*.
// O risco de um painel único é exatamente esse — virar um campo global.
// ---------------------------------------------------------------------------

const painel = () => arquivo("src/app/components/AliquotasPorCanal.tsx");

test("os quatro canais aparecem no painel", () => {
  const p = painel();
  for (const rota of ["amazon", "mercado-livre", "shopee", "tiktok"]) {
    assert.match(p, new RegExp(`rota: "${rota}"`), `${rota} precisa estar na lista`);
  }
});

test("cada canal salva na PROPRIA rota", () => {
  // Uma alíquota por canal: o POST vai para /api/integrations/<canal>/settings,
  // com o `rota` da linha — nunca um endpoint único que escreveria nos quatro.
  const p = painel();
  assert.match(p, /fetch\(`\/api\/integrations\/\$\{canal\.rota\}\/settings`, \{\s*method: "POST"/);
});

test("salvar um canal nao escreve no estado de outro", () => {
  // `atualizar(id, ...)` altera SÓ a chave daquele canal. Se algum dia isto
  // virar um setState que espalha o valor, o painel passa a assumir alíquota
  // única — exatamente o que ela proibiu.
  const p = painel();
  assert.match(p, /\{ \.\.\.atual, \[id\]: \{ \.\.\.atual\[id\], \.\.\.mudanca \} \}/);
});

test("canal nao conectado e estado, nao erro", () => {
  // 404 do canal desconectado não pode virar mensagem vermelha de falha.
  const p = painel();
  assert.match(p, /resposta\.status === 404/);
  assert.match(p, /estado: "desconectado"/);
});

test("campo vazio limpa (null), e 0% continua sendo isencao declarada", () => {
  // `null ≠ 0` também aqui: vazio é "não sei", zero é "não pago".
  const p = painel();
  assert.match(p, /const valor = cru === "" \? null : Number\(cru\);/);
  assert.match(p, /0% é isenção declarada/);
});

test("o painel esta montado na Visao geral", () => {
  const central = arquivo("src/app/(app)/page.tsx");
  assert.match(central, /import \{ AliquotasPorCanal \}/);
  assert.match(central, /<AliquotasPorCanal \/>/);
});

test("o erro mostrado e o do servidor, nao um palpite", () => {
  const p = painel();
  assert.match(p, /erro: motivo instanceof Error \? motivo\.message/);
});

test("a aliquota virou passo do onboarding", () => {
  // Pedido dela em 26/08/2026: *"tem uma parte de onboarding pra primeiros
  // acessos, coloque isso como mais um passo pra não passar despercebido"*.
  // É o campo que mais passa batido — e sem ele o lucro do canal sai otimista.
  const tour = arquivo("src/app/components/NexoOnboarding.tsx");
  assert.match(tour, /data-onboarding='tax-rates'/);
  // O passo é o ÚLTIMO: quem chega vê primeiro o que a operação já mostra, e só
  // então o que precisa configurar.
  const passos = tour.slice(tour.indexOf("const STEPS = ["), tour.indexOf("] as const;"));
  const linhas = passos.split("{ selector:").slice(1);
  assert.equal(linhas.length, 4, "o tour tem quatro passos");
  assert.match(linhas.at(-1), /tax-rates/);
  // A descrição precisa dizer que é UMA POR CANAL, senão o passo ensina errado.
  assert.match(tour, /a da Amazon não vale para o Mercado Livre/);
});

test("o painel esta marcado para o tour achar", () => {
  assert.match(painel(), /data-onboarding="tax-rates"/);
});

test("a versao do tour NAO foi bumpada", () => {
  // Bumpar `nexo:onboarding:v1` re-exibiria o tour inteiro para quem já
  // terminou. O pedido foi cobrir PRIMEIROS acessos; quem já usa reabre o tour
  // pelo menu quando quiser. Se um dia a decisão mudar, é aqui que se vê.
  const tour = arquivo("src/lib/productTour.ts");
  assert.match(tour, /NEXO_ONBOARDING_VERSION = "nexo:onboarding:v1"/);
});
