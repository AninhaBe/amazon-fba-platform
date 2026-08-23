import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Medido em 22/08/2026: uma venda das 17:32 apareceu no Seller Central e NÃO na
// tela do NEXO. Causa: o swr entrega o cache VENCIDO e revalida em segundo
// plano — a tela recebeu o número das 17:00, de antes da venda.
//
// Para o faturamento do dia, que existe para bater com o Seller Central, servir
// dado velho é o mesmo que mentir. Estes testes travam a correção, porque a
// falha é silenciosa: nada quebra, o número só fica velho.

const swr = readFileSync(new URL("../src/lib/swr.ts", import.meta.url), "utf8");
const sales = readFileSync(new URL("../src/lib/sales.ts", import.meta.url), "utf8");

test("swr aceita esperar a revalidação em vez de servir dado velho", () => {
  assert.match(swr, /awaitIfStaleMs/, "a opção precisa existir");
  // Tem que correr contra um teto — origem lenta não pode travar a tela (ADR-017).
  assert.match(swr, /Promise\.race/);
});

test("o teto de espera cai no cache velho, não em erro", () => {
  // Se a revalidação falhar ou estourar o teto, devolve o stale — nunca rejeita.
  assert.match(swr, /p\.catch\(\(\) => cache\.value\)/);
  assert.match(swr, /setTimeout\(\(\) => resolve\(cache\.value\)/);
});

test("faturamento que alcança HOJE usa cache curto e espera o dado novo", () => {
  assert.match(sales, /alcancaHoje/);
  // 60s para o dia corrente; 10 min só para período fechado no passado.
  assert.match(sales, /alcancaHoje \? 60_000 : 10 \* 60_000/);
  assert.match(sales, /awaitIfStaleMs: alcancaHoje \? \d+ : 0/);
});

test("período fechado no passado mantém cache longo (não paga latência à toa)", () => {
  assert.match(sales, /Período fechado no passado não muda/);
});
