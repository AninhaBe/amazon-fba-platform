import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

// ── O 500 do monitor, que NAO era da demo ──────────────────────────────────

test("o monitor agrega itens por LATERAL, nunca por GROUP BY", () => {
  const modulos = fonte("src/lib/integrations/tiktokModules.ts");
  const monitor = modulos.slice(modulos.indexOf("export async function readMonitor"), modulos.indexOf("export async function readCatalog"));
  // `SELECT s.*` com GROUP BY de lista escrita a mao quebrava a cada coluna
  // nova: `ordered_gross` e `ordered_gross_source` (0010 e 0011) ficaram de
  // fora e o Postgres recusava a consulta inteira com 42803, devolvendo 500 em
  // QUALQUER conta com TikTok conectado.
  assert.doesNotMatch(monitor, /GROUP BY/, "GROUP BY volta a quebrar na proxima coluna");
  assert.match(monitor, /LEFT JOIN LATERAL \(SELECT json_agg/);
  assert.match(monitor, /SELECT s\.\*/, "a projecao segue completa, agora sem risco");
});
