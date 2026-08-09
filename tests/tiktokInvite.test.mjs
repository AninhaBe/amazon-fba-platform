import test from "node:test";
import assert from "node:assert/strict";
import { criarConviteTiktok, validarConviteTiktok } from "../src/lib/tiktokInvite.ts";

const WORKSPACE = "1803d1fe-2bf3-4b72-bed1-c79d8b0e640e";

function comChave(fn) {
  const anterior = process.env.INTEGRATION_TOKEN_KEY;
  process.env.INTEGRATION_TOKEN_KEY = "chave-de-teste-do-convite";
  try {
    return fn();
  } finally {
    if (anterior === undefined) delete process.env.INTEGRATION_TOKEN_KEY;
    else process.env.INTEGRATION_TOKEN_KEY = anterior;
  }
}

test("convite válido devolve o workspace de destino", () => {
  comChave(() => {
    const convite = criarConviteTiktok(WORKSPACE);
    assert.equal(validarConviteTiktok(convite)?.workspaceId, WORKSPACE);
  });
});

test("apontar o convite para outro workspace invalida a assinatura", () => {
  comChave(() => {
    const [prefixo, , assinatura] = criarConviteTiktok(WORKSPACE).split(".");
    const forjado = Buffer.from(
      JSON.stringify({ w: "workspace-do-atacante", exp: Math.floor(Date.now() / 1000) + 999 }),
      "utf8"
    ).toString("base64url");
    assert.equal(validarConviteTiktok(`${prefixo}.${forjado}.${assinatura}`), null);
  });
});

test("assinatura adulterada é recusada", () => {
  comChave(() => {
    const [prefixo, corpo, assinatura] = criarConviteTiktok(WORKSPACE).split(".");
    assert.equal(validarConviteTiktok(`${prefixo}.${corpo}.${assinatura.slice(0, -2)}xy`), null);
  });
});

test("convite expirado é recusado", () => {
  comChave(() => {
    assert.equal(validarConviteTiktok(criarConviteTiktok(WORKSPACE, -1)), null);
  });
});

test("state do fluxo com cookie não é confundido com convite", () => {
  comChave(() => {
    // O /api/tiktok/login gera um state aleatório em base64url, sem pontos.
    assert.equal(validarConviteTiktok("Zm9vYmFyYmF6cXV4"), null);
    assert.equal(validarConviteTiktok(null), null);
    assert.equal(validarConviteTiktok(""), null);
  });
});

test("cada workspace recebe uma assinatura própria", () => {
  comChave(() => {
    const a = criarConviteTiktok(WORKSPACE).split(".")[2];
    const b = criarConviteTiktok("outro-workspace").split(".")[2];
    assert.notEqual(a, b);
  });
});

test("sem INTEGRATION_TOKEN_KEY não se cria nem se valida convite", () => {
  const anterior = process.env.INTEGRATION_TOKEN_KEY;
  const convite = comChave(() => criarConviteTiktok(WORKSPACE));
  delete process.env.INTEGRATION_TOKEN_KEY;
  try {
    assert.throws(() => criarConviteTiktok(WORKSPACE));
    assert.equal(validarConviteTiktok(convite), null);
  } finally {
    if (anterior !== undefined) process.env.INTEGRATION_TOKEN_KEY = anterior;
  }
});
