import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { transporteDeInquilinoLigado, esquecerFlagDeInquilino } from "../src/lib/db.ts";

// ═══ A FLAG DE MEDIÇÃO DA ADR-036 (etapa 1) LIGA E DESLIGA SEM REINÍCIO ══════
//
// QUAL DEFEITO ESTE ARQUIVO REPROVA. A primeira versão da flag lia só
// `process.env`, e no Fly variável entra por `fly secrets set`, que REINICIA a
// máquina — e o app tem UMA máquina só. Medir alternando ligado/desligado dentro
// da mesma janela de tráfego (que é a única comparação honesta, senão a variação
// do dia se mistura ao efeito da flag) custaria um corte na tela da vendedora a
// cada troca. O modo `arquivo` existe para que a alternância custe zero.
//
// ⚠️ E ELE COBRE A CONDIÇÃO MAIS FÁCIL DE PERDER NUM REFACTOR: com a variável e
// o arquivo ausentes, NÃO PODE HAVER ACESSO A DISCO. Se alguém "simplificar"
// removendo o opt-in e passar a consultar o arquivo sempre, o caminho padrão de
// produção ganha um `stat` a cada 5s por processo — pouco, mas o combinado era
// "bit a bit o de hoje", e quase igual não era o combinado.
//
// COMO VER VERMELHO: em `transporteDeInquilinoLigado`, troque
// `if (modo !== "arquivo") return false` por `if (modo === "1") return true` (ou
// seja, deixe o arquivo valer sempre). O caso "sem variável, com arquivo
// presente" passa a devolver `true` e reprova — que é exatamente o opt-in sendo
// perdido. Feito em 01/09/2026.

const DIR = mkdtempSync(path.join(tmpdir(), "nexo-flag-"));
const ARQUIVO = path.join(DIR, "carimbo-de-inquilino.ligado");

function comAmbiente(modo, temArquivo, fn) {
  const antesModo = process.env.DB_CARIMBO_DE_INQUILINO;
  const antesDir = process.env.DATA_DIR;
  if (modo === undefined) delete process.env.DB_CARIMBO_DE_INQUILINO;
  else process.env.DB_CARIMBO_DE_INQUILINO = modo;
  process.env.DATA_DIR = DIR;
  if (temArquivo) writeFileSync(ARQUIVO, "");
  else try { unlinkSync(ARQUIVO); } catch { /* já não existe */ }
  // O cache é por processo e mascararia a alternância dentro do mesmo teste.
  esquecerFlagDeInquilino();
  try {
    return fn();
  } finally {
    if (antesModo === undefined) delete process.env.DB_CARIMBO_DE_INQUILINO;
    else process.env.DB_CARIMBO_DE_INQUILINO = antesModo;
    if (antesDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = antesDir;
    esquecerFlagDeInquilino();
  }
}

test("desligada por padrão: sem variável e sem arquivo, o caminho é o antigo", () => {
  assert.equal(comAmbiente(undefined, false, () => transporteDeInquilinoLigado()), false);
});

test("O OPT-IN É O PONTO: sem variável, o arquivo NÃO liga nada", () => {
  // Se este caso virar `true`, o modo `arquivo` deixou de ser opt-in e o caminho
  // padrão de produção passou a tocar disco. É a asserção que protege a condição
  // "bit a bit o de hoje".
  assert.equal(comAmbiente(undefined, true, () => transporteDeInquilinoLigado()), false);
});

test('modo "arquivo": criar o arquivo LIGA, apagar DESLIGA', () => {
  assert.equal(comAmbiente("arquivo", true, () => transporteDeInquilinoLigado()), true);
  assert.equal(comAmbiente("arquivo", false, () => transporteDeInquilinoLigado()), false);
});

test('"1" liga sempre, mesmo sem arquivo — é o caminho de emergência', () => {
  assert.equal(comAmbiente("1", false, () => transporteDeInquilinoLigado()), true);
});

test("valor desconhecido não liga: modo de falha é o comportamento de hoje", () => {
  assert.equal(comAmbiente("talvez", true, () => transporteDeInquilinoLigado()), false);
});

test("o TTL de 5s é real: dentro dele a alternância ainda não vale", () => {
  // Não é preciosismo — é o número que diz quanto esperar entre alternar e
  // confiar na medição. Se o cache não existisse, cada consulta viraria um
  // acesso a disco; se ele fosse longo demais, a alternância não serviria para
  // medir. Aqui o relógio é injetado para não depender de `sleep`.
  comAmbiente("arquivo", true, () => {
    const t0 = 1_000_000;
    assert.equal(transporteDeInquilinoLigado(t0), true);
    unlinkSync(ARQUIVO);
    assert.equal(transporteDeInquilinoLigado(t0 + 4_999), true, "dentro do TTL, ainda vale o valor em cache");
    assert.equal(transporteDeInquilinoLigado(t0 + 5_001), false, "passado o TTL, a alternância vale");
  });
});

test("volume ausente não LIGA por acidente", () => {
  const antes = process.env.DATA_DIR;
  process.env.DB_CARIMBO_DE_INQUILINO = "arquivo";
  process.env.DATA_DIR = path.join(DIR, "diretorio-que-nao-existe");
  esquecerFlagDeInquilino();
  try {
    assert.equal(transporteDeInquilinoLigado(), false);
  } finally {
    if (antes === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = antes;
    delete process.env.DB_CARIMBO_DE_INQUILINO;
    esquecerFlagDeInquilino();
  }
});

test.after(() => rmSync(DIR, { recursive: true, force: true }));
