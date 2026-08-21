import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ADR-022, Frente 1.1: nenhum upsert de caminho quente pode reescrever linha que
// não mudou. Medido em 21/08/2026, antes da correção: 2.225.919 updates para
// 84.158 inserções em workspace_channel_orders, e 1.137.516 para 38.009 em
// workspace_marketplace_orders — esta com 0,0% de HOT, ou seja, cada update
// reescrevendo todas as entradas de índice da linha.
//
// Este teste existe porque a falha desta mudança é SILENCIOSA nos dois sentidos:
// esquecer o guard num upsert novo devolve o desperdício sem qualquer sinal, e
// errar a comparação faz o sync ignorar atualização legítima — que não aparece
// como erro, aparece como dado velho na tela.

const ARQUIVOS = [
  "src/lib/integrations/canonicalStore.ts",
  "src/lib/integrations/mercadoLivreSync.ts",
  "src/lib/integrations/mercadoLivreWebhook.ts",
];

// Upserts deliberadamente sem guard. Manter a lista curta e justificada: entrada
// nova aqui é decisão, não descuido.
const SEM_GUARD_PROPOSITAL = [
  // Tabela de ESTADO do sync: cursor, janela coberta e last_success_at mudam de
  // verdade a cada execução. 401 mil updates em 11 linhas, 100% HOT — barato e
  // correto. Guardar aqui não economizaria nada.
  { marcador: "sync.cursor_token", motivo: "estado do sync muda a cada execução" },
  // Reentrega de webhook faz `status = 'pending'` DE PROPÓSITO, para reprocessar.
  // Guardar mudaria semântica de processamento, não só desperdício — precisa de
  // decisão própria, não pode entrar de carona nesta.
  { marcador: "status = 'pending'", motivo: "reenfileira na reentrega, por desenho" },
];

/** Trecho após cada `DO UPDATE SET`, onde o guard tem de aparecer. */
function blocosDeUpsert(sql) {
  const blocos = [];
  const alvo = "DO UPDATE SET";
  let i = sql.indexOf(alvo);
  while (i !== -1) {
    blocos.push(sql.slice(i, i + 1400));
    i = sql.indexOf(alvo, i + alvo.length);
  }
  return blocos;
}

test("todo upsert de caminho quente pula linha que não mudou", () => {
  const semGuard = [];
  for (const arquivo of ARQUIVOS) {
    const fonte = readFileSync(new URL(`../${arquivo}`, import.meta.url), "utf8");
    for (const bloco of blocosDeUpsert(fonte)) {
      if (bloco.includes("IS DISTINCT FROM")) continue;
      if (SEM_GUARD_PROPOSITAL.some(({ marcador }) => bloco.includes(marcador))) continue;
      semGuard.push(`${arquivo}: ${bloco.slice(0, 90).replace(/\s+/g, " ")}…`);
    }
  }
  assert.deepEqual(semGuard, [], `upsert sem guard de "linha não mudou":\n${semGuard.join("\n")}`);
});

// Ponto cego descoberto em 21/08, depois do deploy: a varredura acima só olha
// `DO UPDATE SET` (upsert). Os `UPDATE ... SET` diretos passavam batido — e eram
// eles que respondiam por 1.066 dos updates medidos em 7 minutos, quando as
// outras quatro tabelas já tinham chegado a zero.
const UPDATE_DIRETO_PERMITIDO = [
  // Registro de tentativa: grava clock_timestamp() de propósito, muda sempre.
  // Que o log de tentativa more na linha do PEDIDO é questionável, mas mudar
  // isso é decisão de desenho, não desperdício — fica fora desta frente.
  "statementLastAttemptAt",
  // Marca de evidência financeira: grava conteúdo novo vindo do extrato.
  "financialEvidence",
];

test("UPDATE direto em tabela canônica não regrava linha igual", () => {
  const semGuard = [];
  for (const arquivo of [...ARQUIVOS, "src/lib/integrations/tiktokSync.ts", "src/lib/integrations/shopeeSync.ts"]) {
    const fonte = readFileSync(new URL(`../${arquivo}`, import.meta.url), "utf8");
    let i = fonte.indexOf("UPDATE workspace_channel_orders");
    while (i !== -1) {
      const bloco = fonte.slice(i, i + 1200);
      const guardado = bloco.includes("IS DISTINCT FROM") || /AND\s+raw#>>[^\n]*IS NULL/.test(bloco)
        || UPDATE_DIRETO_PERMITIDO.some((marcador) => bloco.includes(marcador));
      if (!guardado) semGuard.push(`${arquivo}: ${bloco.slice(0, 100).replace(/\s+/g, " ")}…`);
      i = fonte.indexOf("UPDATE workspace_channel_orders", i + 30);
    }
  }
  assert.deepEqual(semGuard, [], `UPDATE direto sem guard:\n${semGuard.join("\n")}`);
});

test("a expressão de merge do raw é uma só, usada no SET e na comparação", () => {
  const fonte = readFileSync(new URL("../src/lib/integrations/canonicalStore.ts", import.meta.url), "utf8");
  // Se alguém reescrever a CASE do raw direto no SQL em vez de usar a constante,
  // os dois lados param de casar e o sync passa a ignorar mudança de raw.
  assert.equal(fonte.split("${RAW_MERGE}").length - 1, 4, "RAW_MERGE deve aparecer 2× por upsert de pedido (SET + WHERE), em 2 upserts");
  assert.equal(fonte.split("${RAW_MERGE_PRODUTOS}").length - 1, 2, "RAW_MERGE_PRODUTOS deve aparecer no SET e no WHERE");
  assert.ok(!/raw = CASE\s/.test(fonte), "CASE do raw escrita à mão no SQL — usar rawMerge(tabela)");
});

test("o guard cobre as colunas que o SET escreve, sem sobrar nem faltar", () => {
  const fonte = readFileSync(new URL("../src/lib/integrations/canonicalStore.ts", import.meta.url), "utf8");
  // O upsert de pedidos escreve 10 colunas além de synced_at; a tupla comparada
  // precisa ter exatamente as mesmas 10 dos dois lados.
  for (const bloco of blocosDeUpsert(fonte)) {
    if (!bloco.includes("workspace_channel_orders.status")) continue;
    const tuplas = bloco.match(/\(([^()]*workspace_channel_orders\.status[^()]*)\)/);
    assert.ok(tuplas, "tupla de comparação do pedido não encontrada");
    const colunas = tuplas[1].split(",").length;
    assert.equal(colunas, 10, `esperado 10 colunas na comparação, encontrado ${colunas}`);
  }
});
