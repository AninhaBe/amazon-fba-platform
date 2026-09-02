import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ⚠️ INCIDENTE DE PRODUCAO DE 02/09/2026 — E A GUARDA QUE O REPROVA.
//
// O QUE ACONTECEU, medido, nao deduzido: a migration 0029 adicionou `posted_at`
// em `workspace_channel_order_fees`. O leitor do estorno le a VIEW
// `workspace_channel_order_fees_efetivas`, criada pela 0022 — e view NAO HERDA
// COLUNA DE TABELA: ela congela a lista de colunas do dia em que foi criada.
//
// Resultado em producao, em TODAS as conexoes e TODOS os periodos, inclusive a
// conta da vendedora e a de demonstracao:
//
//   42703  column f.posted_at does not exist
//
// O dashboard da Amazon ficou FORA DO AR desde a v238. Nada ficou vermelho antes:
// a tabela tinha a coluna, o teste de schema passava, a migration estava certa —
// so a consulta que atravessava a view morria.
//
// 📌 A LICAO, ja no AGENTS.md: a pergunta obrigatoria antes do apply de uma
// migration — "quem le isso agora?" — precisa incluir as VIEWS no meio do
// caminho. Foi respondida para a tabela e nunca para a view.
//
// ⚠️ E ISTO NAO E UMA RECUSA TEMPORARIA DISFARCADA. Ler a tabela continua
// CORRETO depois da 0030 — o numero e identico, porque estorno nunca e
// estimativa. A guarda nao espera nada para morrer; ela fixa a fonte certa.
// O que a 0030 devolve e a coerencia do SCHEMA, e o terceiro caso cobra isso
// separado, sem virar tripwire que fica vermelho por motivo que nao e o produto.

const ler = (caminho) => readFile(new URL(caminho, import.meta.url), "utf8");

/** A consulta inteira em que o trecho aparece — delimitada pelas crases do SQL. */
function consultaComTrecho(bruto, trecho) {
  // ⚠️ SEM COMENTARIOS, SEMPRE. O comentario que explica por que algo e proibido
  // CITA a coisa proibida — e aqui isso nao e hipotese: a primeira versao deste
  // teste apontou para a frase "column f.posted_at does not exist" dentro do
  // proprio comentario do produtor, e reprovou codigo correto (AGENTS.md).
  const fonte = bruto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const pos = fonte.indexOf(trecho);
  assert.notEqual(pos, -1, `trecho nao encontrado no fonte: ${trecho}`);
  const ini = fonte.lastIndexOf("`", pos);
  const fim = fonte.indexOf("`", pos);
  assert.ok(ini !== -1 && fim !== -1 && ini < pos && fim > pos, "delimitacao da consulta falhou");
  return fonte.slice(ini + 1, fim);
}

test("a consulta que le posted_at NAO pode sair da view — a view nao tem a coluna", async () => {
  const fonte = await ler("../src/lib/integrations/amazonOverviewCanonical.ts");
  const consulta = consultaComTrecho(fonte, "f.posted_at");
  assert.ok(consulta.includes("FROM workspace_channel_order_fees f"),
    "quem le posted_at tem de ler a TABELA; a view congelou a lista de colunas da 0022");
  assert.ok(!consulta.includes("workspace_channel_order_fees_efetivas"),
    "ler posted_at da view derruba o dashboard inteiro com 42703");
});

test("e ler a tabela aqui NAO muda numero — estorno nunca e estimativa", async () => {
  // 📌 O motivo pelo qual a troca e correta, e nao um desvio para destravar:
  // este recorte filtra `fee_type = 'refund'`. A view existe para substituir
  // ESTIMATIVA por tarifa oficial, e o CHECK da 0022 RECUSA 'refund' como
  // fee_type de estimativa — procedencia nao pode ocupar o lugar da natureza.
  // Sobre a linha de estorno a view nao tem nada a fazer.
  const fonte = await ler("../src/lib/integrations/amazonOverviewCanonical.ts");
  const consulta = consultaComTrecho(fonte, "f.posted_at");
  assert.ok(consulta.includes("AND f.fee_type = 'refund'"),
    "a equivalencia so vale porque a consulta e SO de estorno");
  // E a migration que criou a tabela de estimativa continua recusando 'refund'.
  // A recusa nao e uma proibicao escrita: e uma ALLOWLIST que simplesmente nao
  // tem 'refund'. Asserta-la assim e mais forte do que procurar a palavra —
  // procurar 'refund' acharia o COMENTARIO que explica a exclusao (a armadilha
  // de sempre) e ficaria verde com a lista errada.
  for (const nome of [
    "0022_previsto_e_real_convivendo.sql",
    "0026_estimativa_sem_natureza_deixa_de_ser_aceita.sql",
  ]) {
    const sql = (await ler(`../migrations/${nome}`)).replace(/--.*$/gm, "");
    const lista = sql.match(/CHECK\s*\(\s*fee_type IN \(([^)]*)\)/);
    if (!lista) continue;
    assert.ok(!lista[1].includes("refund"),
      `${nome}: 'refund' entrou no vocabulario de ESTIMATIVA — a equivalencia com a view cai`);
  }
});

test("a 0030 existe e e o estado final certo do schema — este conserto nao a dispensa", async () => {
  // ⚠️ ESTE CASO DELIBERADAMENTE NAO E UM TRIPWIRE. A primeira versao exigia que
  // NENHUMA migration desse `posted_at` a view, para se auto-invalidar quando a
  // correcao chegasse. So que a 0030 ja estava ESCRITA na arvore e ainda nao
  // APLICADA — o teste ficava vermelho por um motivo que nao e o produto, que e
  // como se ensina a ignorar teste vermelho (AGENTS.md).
  //
  // Ler a tabela continua correto DEPOIS da 0030 (o numero e o mesmo), entao nao
  // ha nada para inverter automaticamente. O que este caso garante e que o
  // conserto de codigo nao vire desculpa para a view ficar quebrada: a 0030 e o
  // estado final certo do schema e tem de existir.
  const { readdir } = await import("node:fs/promises");
  const dir = new URL("../migrations/", import.meta.url);
  const arquivos = (await readdir(dir)).filter((nome) => nome.endsWith(".sql"));
  const conserta = [];
  for (const nome of arquivos) {
    const sql = (await readFile(new URL(nome, dir), "utf8")).replace(/--.*$/gm, "");
    if (/VIEW\s+workspace_channel_order_fees_efetivas/i.test(sql) && /posted_at/.test(sql)) conserta.push(nome);
  }
  assert.ok(conserta.length >= 1,
    "nenhuma migration devolve posted_at a view: o schema fica incoerente com a 0029");
});
