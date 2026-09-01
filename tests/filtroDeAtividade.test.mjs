import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  condicaoDeAtividade,
  filtroDeAtividadeRequest,
  ocultadosPeloFiltro,
  STATUS_ATIVO,
} from "../src/lib/integrations/filtroDeAtividade.ts";

// Pedido da dona em 28/08/2026: "dou de cara com mais de 300 anúncios inativos
// que não tenho menor interesse de cadastrar custo pra eles". Medido na conta
// real: Shopee 265 inativos para 107 ativos; Mercado Livre 367 para 26.

test("o padrão é ATIVOS — é o ponto do pedido dela", () => {
  assert.equal(filtroDeAtividadeRequest(new URLSearchParams()), "ativos");
});

test("os três recortes são aceitos, e lixo na URL cai no padrão sem derrubar a tela", () => {
  for (const valor of ["ativos", "inativos", "todos"]) {
    assert.equal(filtroDeAtividadeRequest(new URLSearchParams(`atividade=${valor}`)), valor);
  }
  // Filtro de conveniência não pode custar a página inteira por um parâmetro torto.
  assert.equal(filtroDeAtividadeRequest(new URLSearchParams("atividade=banana")), "ativos");
  assert.equal(filtroDeAtividadeRequest(new URLSearchParams("atividade=")), "ativos");
});

test("'todos' não gera cláusula nem consome parâmetro", () => {
  assert.equal(condicaoDeAtividade("status", 7, "todos"), "");
  assert.equal(condicaoDeAtividade("status", 7, "ativos"), " AND status = $7");
  assert.equal(condicaoDeAtividade("status", 7, "inativos"), " AND status <> $7");
});

test("o que foi ocultado nunca é negativo — e zero significa nada escondido", () => {
  assert.equal(ocultadosPeloFiltro(372, 107), 265);
  assert.equal(ocultadosPeloFiltro(107, 107), 0);
  // Total menor que o exibido só aconteceria por corrida entre duas consultas;
  // virar número negativo na tela seria pior que arredondar para zero.
  assert.equal(ocultadosPeloFiltro(5, 9), 0);
});

test("ativo é 'active' — os outros status do canônico contam como inativos", () => {
  assert.equal(STATUS_ATIVO, "active");
});

test("o filtro é do SERVIDOR nos quatro canais — filtrar no cliente mentiria na paginação", async () => {
  const shopee = await readFile(new URL("../src/lib/integrations/shopeeModules.ts", import.meta.url), "utf8");
  assert.match(shopee, /filtroDeAtividadeRequest\(params\)/);
  // A coluna leva o alias da tabela desde que a consulta ganhou o LATERAL de
  // volume de vendas — o que importa é que a condição continue no SERVIDOR.
  assert.match(shopee, /condicaoDeAtividade\("p?\.?status", 7, atividade\)/);
  assert.match(shopee, /ocultados: ocultadosPeloFiltro\(totalNoCanal, total\)/);

  const tiktok = await readFile(new URL("../src/lib/integrations/tiktokModules.ts", import.meta.url), "utf8");
  assert.match(tiktok, /filtroDeAtividadeRequest\(params\)/);
  // Status explícito continua mandando: o padrão novo não pode atropelar quem escolheu.
  assert.match(tiktok, /explicitos\.length\?explicitos/);

  const ml = await readFile(new URL("../src/app/api/integrations/mercado-livre/products/route.ts", import.meta.url), "utf8");
  assert.match(ml, /filtroDeAtividadeRequest\(new URL\(req\.url\)\.searchParams\)/);
  assert.match(ml, /ocultados: ocultadosPeloFiltro\(vivos\.length, products\.length\)/);
});

test("a tela DIZ quantos ficou de fora e leva a eles — esconder calado seria remover informação", async () => {
  const aviso = await readFile(new URL("../src/app/components/FiltroDeAtividade.tsx", import.meta.url), "utf8");
  // Zero oculto não vira frase.
  assert.match(aviso, /if \(!ocultados \|\| ocultados <= 0 \|\| atividade === "todos"\) return null/);
  assert.match(aviso, /Ver todos/);
  assert.match(aviso, /anúncios inativos/);
  // O seletor não remove nenhuma opção anterior.
  assert.match(aviso, /value="todos"/);
  assert.match(aviso, /value="inativos"/);
});

test("a página de custo de cada canal usa o seletor e o aviso", async () => {
  for (const caminho of [
    "../src/app/components/ShopeeModulePage.tsx",
    "../src/app/components/TikTokModulePage.tsx",
    "../src/app/(app)/mercado-livre/produtos/page.tsx",
  ]) {
    const fonte = await readFile(new URL(caminho, import.meta.url), "utf8");
    assert.match(fonte, /FiltroDeAtividade/, `${caminho} sem o seletor`);
    assert.match(fonte, /AvisoDeOcultos/, `${caminho} sem o aviso`);
  }
});
