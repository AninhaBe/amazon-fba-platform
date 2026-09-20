import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// DEFEITO/decisão que esta guarda fixa (20/09/2026): a tela da Amazon exibia
// "N pedidos apurados" / "faltam apurar N de M pedidos" — um subconjunto
// (conciliado) que o card de Lucro/Margem nem usa (a margem sai do faturamento
// inteiro desde 31/08). Ordem dela: "não vai existir X conciliados, tem que
// mostrar todos, pode apagar essa legenda". A legenda foi removida SÓ da Amazon;
// ML/Shopee/TikTok mantêm a peça compartilhada porque lá as bases diferem.
//
// ⚠️ Fonte SEM COMENTÁRIOS: o comentário que explica a remoção cita a coisa
// removida ("apurado/conciliado"), e uma proibição sobre o fonte cru casaria o
// comentário (AGENTS.md). A limpeza é obrigatória aqui.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const codigoAmazon = stripComments(
  readFileSync(new URL("../src/app/(app)/amazon/page.tsx", import.meta.url), "utf8"),
);

test("a tela da Amazon não monta mais a legenda de apuração", () => {
  assert.ok(
    codigoAmazon.includes('resumoApuracao: ""'),
    "resumoApuracao da Amazon tem que ser sempre vazio — sem escopo 'apurado/conciliado' na faixa",
  );
  assert.ok(!codigoAmazon.includes("pedidos apurados"), "voltou a legenda 'N pedidos apurados' na Amazon");
  assert.ok(!codigoAmazon.includes("faltam apurar"), "voltou a legenda 'faltam apurar N de M' na Amazon");
});

test("o ML continua com a legenda de cobertura — a remoção foi só da Amazon", () => {
  const ml = stripComments(
    readFileSync(new URL("../src/app/components/MercadoLivreWorkspace.tsx", import.meta.url), "utf8"),
  );
  assert.ok(ml.includes("resumoApuracao:"), "o ML não pode ter perdido a legenda junto — bases diferentes de verdade");
});
