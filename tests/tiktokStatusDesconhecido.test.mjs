import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalTiktokStatus,
  formatUnmappedStatuses,
  parseUnmappedStatuses,
  TIKTOK_UNMAPPED_STATUS_CODE,
  tiktokMappedStatuses,
  tiktokStatusIfMapped,
  tiktokUnmappedOrderStatuses,
  TiktokUnmappedStatusError,
} from "../src/lib/integrations/tiktokCanonical.ts";
import { tiktokSyncErrorContent } from "../src/app/components/TikTokWorkspaceModel.ts";

// O MAPA_STATUS veio da documentacao em prosa do Partner Center; o OAS declara
// `status` como string sem enum. Status novo NAO pode virar "pending", e
// tambem nao pode sumir num "falha temporaria" que o cron repete para sempre:
// tem que chegar na tela com nome e contagem.

test("status fora do mapa nao ganha canonico por conta propria", () => {
  assert.equal(tiktokStatusIfMapped("COMPLETED"), "delivered");
  assert.equal(tiktokStatusIfMapped("STATUS_NOVO_DA_API"), null);
  assert.equal(tiktokStatusIfMapped(""), null);
  assert.ok(tiktokMappedStatuses().includes("AWAITING_SHIPMENT"));
});

test("erro de status nao mapeado carrega codigo, status e contagem", () => {
  let erro;
  assert.throws(() => canonicalTiktokStatus("STATUS_NOVO_DA_API"), (thrown) => {
    erro = thrown;
    return thrown instanceof TiktokUnmappedStatusError;
  });
  assert.equal(erro.code, TIKTOK_UNMAPPED_STATUS_CODE);
  assert.deepEqual(erro.observed, [{ status: "STATUS_NOVO_DA_API", orders: 1 }]);
  assert.match(erro.message, /ainda não mapeado/);
  assert.ok(erro.message.startsWith(`${TIKTOK_UNMAPPED_STATUS_CODE}:`));
});

test("lote reporta TODOS os status novos de uma vez, ordenados por volume", () => {
  const observed = tiktokUnmappedOrderStatuses([
    { id: "1", status: "COMPLETED" },
    { id: "2", status: "ON_THE_WAY" },
    { id: "3", status: "ON_THE_WAY" },
    { id: "4", status: "PARTIALLY_DELIVERED" },
    { id: "5", status: "CANCELLED" },
  ]);
  assert.deepEqual(observed, [
    { status: "ON_THE_WAY", orders: 2 },
    { status: "PARTIALLY_DELIVERED", orders: 1 },
  ]);
});

test("mensagem persistida em last_error volta a virar dado estruturado", () => {
  const observed = [{ status: "ON_THE_WAY", orders: 2 }, { status: "", orders: 1 }];
  const erro = new TiktokUnmappedStatusError(observed);
  assert.deepEqual(parseUnmappedStatuses(erro.message), observed);
  assert.equal(formatUnmappedStatuses(observed), "ON_THE_WAY [2], (vazio) [1]");
  assert.deepEqual(parseUnmappedStatuses("qualquer outra falha do banco"), []);
});

test("a tela nomeia o status novo e nao oferece 'tentar novamente'", () => {
  const erro = new TiktokUnmappedStatusError([{ status: "ON_THE_WAY", orders: 3 }]);
  const conteudo = tiktokSyncErrorContent({
    code: TIKTOK_UNMAPPED_STATUS_CODE,
    message: erro.message,
    retryable: false,
    unmappedStatuses: parseUnmappedStatuses(erro.message),
  });
  assert.equal(conteudo.retryable, false);
  assert.match(conteudo.description, /ON_THE_WAY \(3\)/);
  assert.match(conteudo.description, /3 pedido\(s\)/);
  // Proibido se desculpar com adjetivo em vez de dizer o que falta (AGENTS.md).
  assert.doesNotMatch(conteudo.description, /parcial|incompleto/i);
});

test("falha comum mantem o texto generico e nao vaza mensagem de driver", () => {
  const conteudo = tiktokSyncErrorContent({
    code: "SYNC_RETRYABLE",
    message: 'relation "workspace_channel_orders" does not exist',
    retryable: true,
  });
  assert.equal(conteudo.retryable, true);
  assert.doesNotMatch(conteudo.description, /relation|does not exist/);
});
