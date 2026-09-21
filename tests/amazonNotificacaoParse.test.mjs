import test from "node:test";
import assert from "node:assert/strict";
import { interpretarNotificacao } from "../src/lib/integrations/amazonNotificacoes.ts";

// Prova a leitura do corpo da notificação ORDER_CHANGE (ADR-023). O SellerId mora
// DENTRO de Payload.OrderChangeNotification e o id em NotificationMetadata — ler do
// nível errado deixaria todo evento sem conta/sem chave e a caixa vazia, que é o
// modo de falha silencioso que este teste reprova.
const ORDER_CHANGE = JSON.stringify({
  NotificationVersion: "2020-09-04",
  NotificationType: "ORDER_CHANGE",
  PayloadVersion: "1.0",
  EventTime: "2026-09-21T16:00:00.000Z",
  Payload: { OrderChangeNotification: {
    SellerId: "A15NQMF7A6J1Y0",
    AmazonOrderId: "702-1234567-1234567",
    OrderChangeType: "OrderStatusChange",
    Summary: { OrderStatus: "Shipped", MarketplaceId: "A2Q3Y263D00KWC" },
  } },
  NotificationMetadata: {
    ApplicationId: "amzn1.app", SubscriptionId: "95023e60-e75b-4a7e-8096-e98ba5ba269c",
    PublishTime: "2026-09-21T16:00:01.000Z", NotificationId: "d0e1f2-abc-notif-1",
  },
});

test("interpreta ORDER_CHANGE: seller, pedido, id e tipo do lugar certo", () => {
  const n = interpretarNotificacao(ORDER_CHANGE);
  assert.deepEqual(n, {
    notificationId: "d0e1f2-abc-notif-1",
    notificationType: "ORDER_CHANGE",
    sellerId: "A15NQMF7A6J1Y0",
    amazonOrderId: "702-1234567-1234567",
  });
});

test("corpo ilegível vira null (o consumidor apaga sem gravar)", () => {
  assert.equal(interpretarNotificacao("not json {"), null);
  assert.equal(interpretarNotificacao("{}"), null);
});

test("notificação sem SellerId (confirmação de assinatura) vira null", () => {
  const semSeller = JSON.stringify({ NotificationType: "ORDER_CHANGE", Payload: { OrderChangeNotification: {} }, NotificationMetadata: { NotificationId: "x" } });
  assert.equal(interpretarNotificacao(semSeller), null);
});
