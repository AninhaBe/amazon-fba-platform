import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { chaveDeAssinatura } from "../src/lib/integrations/amazonSqs.ts";

// Prova o SigV4 do consumidor SQS contra o VETOR CONHECIDO da AWS (o exemplo
// worked da doc "Signature Version 4 signing process"). Sem isto, um assinador
// errado passa despercebido — o SQS só devolve 403, calado, em produção, e o
// consumo nunca acontece. Chave secreta e assinatura esperada são as da AWS.
const SECRET = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
const stringToSign = [
  "AWS4-HMAC-SHA256",
  "20150830T123600Z",
  "20150830/us-east-1/iam/aws4_request",
  "f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59",
].join("\n");
const ASSINATURA_ESPERADA = "5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7";

test("SigV4: a cadeia de chave + assinatura bate com o vetor oficial da AWS", () => {
  const chave = chaveDeAssinatura(SECRET, "20150830", "us-east-1", "iam");
  const assinatura = createHmac("sha256", chave).update(stringToSign, "utf8").digest("hex");
  assert.equal(assinatura, ASSINATURA_ESPERADA,
    "o SigV4 divergiu do vetor da AWS — o SQS vai recusar com 403 e o consumo do webhook nunca roda");
});
