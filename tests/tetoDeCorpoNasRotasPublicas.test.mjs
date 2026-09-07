import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "../scripts/ts-resolver.mjs";

const { LIMITE_DE_CORPO } = await import("../src/lib/limiteDeCorpo.ts");
const fonte = (c) => readFile(new URL(`../${c}`, import.meta.url), "utf8");
const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// TETO DE CORPO NAS ROTAS PUBLICAS — auditoria de superficie de 07/09/2026.
//
// ⚠️ A LISTA E FECHADA DE PROPOSITO, e por isso ela diz o que NAO cobre: ela
// enumera as rotas publicas que recebem POST HOJE. Guarda de lista fechada ja
// falhou neste projeto (04/09/2026, os produtores de tarifa), entao: ao criar
// rota publica que aceita corpo, ACRESCENTE aqui. O que a lista nao alcanca sao
// as Server Actions, que o Next limita por conta propria, e rotas com sessao,
// onde quem paga o custo ja se identificou.

// ⚠️ `guarda` e a INSTRUCAO que recusa, nunca o identificador. Casar
// "LIMITE_DE_CORPO" ficava verde com o teto APAGADO, porque a linha do `import`
// contem o nome — e o import fica no topo, entao ate a comparacao de POSICAO
// mentia: ela media a distancia ate o import, nao ate a guarda. Os dois testes
// deste arquivo passaram na quebra por causa disso, e so cairam quando eu troquei
// o alvo. E a familia de "apagar a chamada e deixar o import".
const ROTAS_PUBLICAS_COM_CORPO = [
  { nome: "webhook do Mercado Livre", caminho: "src/app/api/webhooks/mercado-livre/route.ts",
    guarda: "if (bruto.length > LIMITE_DE_CORPO) {" },
  { nome: "webhook da Stripe", caminho: "src/app/api/webhooks/stripe/route.ts",
    guarda: "if (bruto.length > LIMITE_DE_CORPO) {" },
  { nome: "push da Shopee", caminho: "src/app/api/webhooks/shopee/route.ts", guarda: "if (corpoBruto.length > 64 * 1024) {" },
  // ⚠️ O teto do orcamento mora no MODULO, nao na rota — a rota delega. Apontar
  // para route.ts fazia este teste reprovar codigo correto, que e tao ruim
  // quanto passar em codigo errado: teste vermelho por motivo que nao e o
  // produto ensina a ignorar vermelho.
  { nome: "formulario de orcamento", caminho: "src/app/api/contato/orcamento/pedidoDeOrcamento.ts", guarda: "if (corpoBruto.length > LIMITE_DE_CORPO) {" },
];

test("toda rota publica que recebe corpo tem teto", async () => {
  for (const rota of ROTAS_PUBLICAS_COM_CORPO) {
    const codigo = semComentarios(await fonte(rota.caminho));
    assert.ok(codigo.includes(rota.guarda), `${rota.nome} recebe corpo sem teto`);
  }
});

test("o teto vem ANTES do trabalho caro, nao depois", async () => {
  // ⚠️ Comparacao de POSICAO: o teto pode existir e estar depois do parse, e ai
  // ele nao protege de nada. No ML o trabalho caro e o JSON.parse; na Stripe e
  // a verificacao de assinatura.
  const GUARDA = "if (bruto.length > LIMITE_DE_CORPO) {";
  const ml = semComentarios(await fonte("src/app/api/webhooks/mercado-livre/route.ts"));
  assert.ok(ml.includes(GUARDA) && ml.indexOf(GUARDA) < ml.indexOf("JSON.parse("),
    "o ML parseia antes de conferir o tamanho");

  const stripe = semComentarios(await fonte("src/app/api/webhooks/stripe/route.ts"));
  assert.ok(stripe.includes(GUARDA) && stripe.indexOf(GUARDA) < stripe.indexOf("processarWebhookStripe("),
    "a Stripe processa antes de conferir o tamanho");
});

test("o ML nao le o corpo duas vezes", async () => {
  // `req.json()` depois de `req.text()` explode: o corpo ja foi consumido. O
  // defeito seria silencioso em teste e barulhento em producao.
  const codigo = semComentarios(await fonte("src/app/api/webhooks/mercado-livre/route.ts"));
  assert.ok(!codigo.includes("req.json()"), "o ML voltou a chamar req.json() depois de req.text()");
});

test("o teto e generoso para o legitimo e apertado para o abuso", () => {
  // Um lote do ML sao centenas de bytes por notificacao; um evento da Stripe,
  // alguns KB. 64KB nao recusa nada legitimo e nao deixa bufferizar megabytes.
  assert.equal(LIMITE_DE_CORPO, 64 * 1024);
  assert.ok(LIMITE_DE_CORPO >= 16 * 1024, "teto pequeno demais recusaria lote legitimo");
  assert.ok(LIMITE_DE_CORPO <= 256 * 1024, "teto grande demais nao protege de nada");
});
