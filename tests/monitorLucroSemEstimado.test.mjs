import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// O DEFEITO (relatado pela dona em 21/09/2026, verbatim): "nao existe estimado,
// se estamos fazendo o calculo certo, é o certo, para de usar essa palavra".
// O Monitor da Amazon rotulava o card de resultado como "Lucro estimado" — e a
// palavra afirmava incerteza que o numero nao tem: quando ele aparece, ja e
// APOS custo e anuncio (o proprio `nota` diz isso), e o `null` cobre o caso em
// que falta gasto de anuncio. A ressalva de "tarifa ainda nao liquidou" mora
// POR LINHA (a marca de procedencia na tabela), nunca no nome do card. Decisao
// registrada na ADR-030.
//
// ⚠️ INTENCAO: ate 21/09/2026 este rotulo era "Lucro estimado". A guarda agora
// exige "Lucro" e PROIBE "estimado" no arquivo do Monitor. A palavra continua
// legitima na Shopee (outro canal, outro calendario — AGENTS.md), entao esta
// guarda le SO o arquivo do Monitor, nunca a arvore inteira.

const ARQUIVO = "src/app/(app)/monitor/page.tsx";
const fonte = readFileSync(new URL(`../${ARQUIVO}`, import.meta.url), "utf8");
// Proibicao TEM de olhar o fonte sem comentarios (AGENTS.md): o comentario que
// explica a remocao cita a palavra removida.
const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("Monitor da Amazon rotula o resultado como 'Lucro', nunca 'Lucro estimado'", () => {
  // EXIGE o rotulo novo, ancorado na ramificacao do card (nao numa frase solta):
  // e o ramo `costsIncomplete ? ... : "Lucro"` que prova que "Lucro" e o rotulo,
  // e nao uma palavra qualquer no meio de outra coisa.
  assert.match(codigo, /"Repasse antes do custo" : "Lucro"\}/,
    "o card de resultado do Monitor tem de rotular 'Lucro' quando o custo esta completo");
  // PROIBE a palavra da estimativa no fonte SEM comentarios.
  assert.doesNotMatch(codigo, /Lucro estimado/,
    "a palavra 'estimado' saiu do Monitor da Amazon (ADR-030)");
});
