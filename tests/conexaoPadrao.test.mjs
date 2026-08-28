import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { escolherConexaoPadrao } from "../src/lib/integrations/conexaoPadrao.ts";

// Piloto de primeira pintura (28/08/2026): o servidor passou a resolver a loja
// padrão quando a requisição não traz `connection_id`, para eliminar um RTT da
// abertura. A condição do cérebro para aprovar foi esta: servidor e seletor
// escolhem a MESMA loja para a mesma conta com N lojas. Se divergirem, a pessoa
// lê o número de uma loja sob o nome de outra.

const TRES_LOJAS = [
  { id: "shopee:1", status: "connected" },
  { id: "shopee:2", status: "connected" },
  { id: "shopee:3", status: "connected" },
];

test("sem pedido explícito, a padrão é a primeira CONECTADA na ordem recebida", () => {
  assert.equal(escolherConexaoPadrao(TRES_LOJAS)?.id, "shopee:1");
  // Desconectada não pode ser a padrão só por vir antes na lista.
  const comQuebrada = [{ id: "shopee:0", status: "error" }, ...TRES_LOJAS];
  assert.equal(escolherConexaoPadrao(comQuebrada)?.id, "shopee:1");
});

test("pedido explícito ganha — e pedido inválido NÃO cai na primeira", () => {
  assert.equal(escolherConexaoPadrao(TRES_LOJAS, "shopee:3")?.id, "shopee:3");
  // Cair em outra loja aqui seria pior que não responder: a pessoa pediu a loja
  // A e leria a loja B sem nenhum sinal.
  assert.equal(escolherConexaoPadrao(TRES_LOJAS, "shopee:9"), null);
  assert.equal(escolherConexaoPadrao([{ id: "shopee:1", status: "error" }], "shopee:1"), null);
});

test("sem nenhuma conectada, não há padrão — e ausência não vira a primeira da lista", () => {
  assert.equal(escolherConexaoPadrao([]), null);
  assert.equal(escolherConexaoPadrao([{ id: "shopee:1", status: "revoked" }]), null);
});

test("servidor e seletor chamam A MESMA função — a regra não pode ter duas cópias", async () => {
  const servidor = await readFile(new URL("../src/lib/integrations/shopeeModules.ts", import.meta.url), "utf8");
  const tela = await readFile(new URL("../src/app/components/ShopeeWorkspace.tsx", import.meta.url), "utf8");

  assert.match(servidor, /escolherConexaoPadrao\(/, "o servidor resolve pela função única");
  assert.match(tela, /import \{ escolherConexaoPadrao \}/, "o seletor importa a mesma função");
  assert.match(tela, /escolherConexaoPadrao\(status\.connections, requested\)/);

  // Nenhum dos dois pode voltar a reimplementar a regra na mão. Eram
  // equivalentes por acaso (mesma ORDER BY por baixo), não por construção.
  assert.doesNotMatch(tela, /connections\.filter\([^)]*"connected"[^)]*\)\[0\]/);
  assert.doesNotMatch(servidor, /connections\.find\(\([^)]*\) => [^)]*=== requested\)/);
});

test("a resposta do overview diz QUAL conexão resolveu, e a tela usa isso como verdade", async () => {
  const rota = await readFile(
    new URL("../src/app/api/integrations/shopee/overview/route.ts", import.meta.url), "utf8");
  assert.match(rota, /selectedConnectionId/, "sem isso o cliente não tem como saber qual loja o servidor escolheu");

  const tela = await readFile(new URL("../src/app/components/ShopeeWorkspace.tsx", import.meta.url), "utf8");
  // A chave de cache sai do id RESOLVIDO, nunca do palpite local.
  assert.match(tela, /const idExibido = data\.selectedConnectionId \?\? selected\?\.id \?\? null/);
  assert.match(tela, /const chaveFinal = idExibido \? chaveDoPeriodo\(idExibido/);
  // E a primeira busca sai sem `connection_id` quando ainda não se sabe qual é —
  // é isso que corta o RTT do `/api/integrations`.
  assert.match(tela, /if \(selected\) query\.set\("connection_id", selected\.id\)/);
});
