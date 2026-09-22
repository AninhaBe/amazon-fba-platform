import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// PAGINAS LEGAIS SAO PUBLICAS — o defeito que este arquivo reprova, com a data
// que ele teve no mundo real: a AbacatePay REPROVOU o cadastro em 22/09/2026
// porque o auditor SEM CONTA nao alcancava os Termos — GET /termos devolvia
// 307 para o login. Documento legal atras de autenticacao e documento que nao
// existe para quem precisa audita-lo.
//
// A ancora e o BLOCO publicPaths do proxy (a definicao, nao uma frase solta):
// e ele quem decide o que abre sem sessao. Visto VERMELHO em 22/09/2026 antes
// de valer (sem a entrada /termos) e verde com ela, como manda a regra da casa.

test("os Termos e a Privacidade estao em publicPaths — auditor sem conta alcanca os dois", () => {
  const fonte = readFileSync(new URL("../src/lib/supabase/proxy.ts", import.meta.url), "utf8");
  const bloco = fonte.match(/const publicPaths = \[[\s\S]*?\];/)?.[0];
  assert.ok(bloco, "o bloco publicPaths sumiu do proxy — quem decide rota publica agora?");
  assert.match(bloco, /"\/termos",/, 'a entrada "/termos" saiu de publicPaths — e a reprovacao da AbacatePay de 22/09/2026 volta');
  assert.match(bloco, /"\/privacidade",/, 'a entrada "/privacidade" saiu de publicPaths — mesma familia da reprovacao de 22/09/2026');
});
