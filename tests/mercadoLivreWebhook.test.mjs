import test from "node:test";
import assert from "node:assert/strict";
import {
  MercadoLivreWebhookConfigurationError,
  parseMercadoLivreNotification,
} from "../src/lib/integrations/mercadoLivreNotification.ts";

test("aceita e normaliza notificação legítima do Mercado Livre", () => {
  const previous = process.env.MELI_CLIENT_ID;
  process.env.MELI_CLIENT_ID = "5503910054141466";
  try {
    const parsed = parseMercadoLivreNotification({
      _id: "event-1",
      resource: "/orders/2195160686",
      user_id: 468424240,
      topic: "orders_v2",
      application_id: 5503910054141466,
      attempts: 1,
    });
    assert.equal(parsed.user_id, "468424240");
    assert.equal(parsed.application_id, "5503910054141466");
    assert.equal(parsed.resource, "/orders/2195160686");
  } finally {
    if (previous === undefined) delete process.env.MELI_CLIENT_ID;
    else process.env.MELI_CLIENT_ID = previous;
  }
});

test("recusa notificação destinada a outro aplicativo", () => {
  const previous = process.env.MELI_CLIENT_ID;
  process.env.MELI_CLIENT_ID = "app-correto";
  try {
    assert.throws(() => parseMercadoLivreNotification({
      resource: "/orders/1",
      user_id: 10,
      topic: "orders_v2",
      application_id: "outro-app",
    }), /não reconhecida/i);
  } finally {
    if (previous === undefined) delete process.env.MELI_CLIENT_ID;
    else process.env.MELI_CLIENT_ID = previous;
  }
});

test("recusa payload incompleto sem recurso", () => {
  assert.throws(() => parseMercadoLivreNotification({
    user_id: 10,
    topic: "orders_v2",
    application_id: "app",
  }), /incompleta/i);
});

test("recusa notificações quando a aplicação não está configurada", () => {
  const previous = process.env.MELI_CLIENT_ID;
  delete process.env.MELI_CLIENT_ID;
  try {
    assert.throws(() => parseMercadoLivreNotification({
      resource: "/orders/1",
      user_id: 10,
      topic: "orders_v2",
      application_id: "app",
    }), MercadoLivreWebhookConfigurationError);
  } finally {
    if (previous !== undefined) process.env.MELI_CLIENT_ID = previous;
  }
});

test("descarta metadados de tipos inesperados sem quebrar a chave do evento", () => {
  const previous = process.env.MELI_CLIENT_ID;
  process.env.MELI_CLIENT_ID = "app";
  try {
    const parsed = parseMercadoLivreNotification({
      _id: 123,
      resource: "/items/MLB123",
      user_id: 10,
      topic: "items",
      application_id: "app",
      sent: 456,
    });
    assert.equal(parsed._id, undefined);
    assert.equal(parsed.sent, undefined);
  } finally {
    if (previous === undefined) delete process.env.MELI_CLIENT_ID;
    else process.env.MELI_CLIENT_ID = previous;
  }
});
