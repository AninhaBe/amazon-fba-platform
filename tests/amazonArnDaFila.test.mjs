import test from "node:test";
import assert from "node:assert/strict";
import { arnDaFila } from "../src/lib/integrations/amazonNotificacaoSetup.ts";

// Deriva o ARN da fila do SQS_QUEUE_URL. Um ARN errado faz o createDestination
// recusar calado, e nenhum vendedor é assinado — por isso o teste do formato.
test("arnDaFila: url da fila -> ARN", () => {
  assert.equal(
    arnDaFila("https://sqs.us-east-1.amazonaws.com/073856425324/nexo-amazon-notifications"),
    "arn:aws:sqs:us-east-1:073856425324:nexo-amazon-notifications",
  );
});
test("arnDaFila: url fora do formato -> null (não inventa ARN)", () => {
  assert.equal(arnDaFila("https://exemplo.com/fila"), null);
  assert.equal(arnDaFila(""), null);
});
