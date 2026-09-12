import test from "node:test";
import assert from "node:assert/strict";
import { classifyTiktokApiError, tiktokAuthorizationUrl, tiktokConfigured } from "../src/lib/tiktok.ts";

// ⚠️ ESTE TESTE MUDOU DE INTENCAO EM 11/09/2026, e o que ele afirmava antes
// virou o DEFEITO que ele agora reprova.
//
// Ate esta data ele montava a URL sem dizer qual app (caindo no custom) e
// afirmava que as variaveis do CUSTOM deixavam o canal "configurado". Decisao da
// dona do produto no mesmo dia: o app PUBLICO e o unico daqui para frente. Entao
// `tiktokConfigured()` responde pelo publico — e e ela que decide se o cartao do
// TikTok aparece habilitado em /integracoes.
test("monta a autorização ROW com service_id e state, pelo app PUBLICO", () => {
  const previous = {
    key: process.env.TIKTOK_PUBLIC_APP_KEY,
    secret: process.env.TIKTOK_PUBLIC_APP_SECRET,
    serviceId: process.env.TIKTOK_PUBLIC_SERVICE_ID,
    authUrl: process.env.TIKTOK_AUTH_URL,
  };
  process.env.TIKTOK_PUBLIC_APP_KEY = "app-key";
  process.env.TIKTOK_PUBLIC_APP_SECRET = "app-secret";
  process.env.TIKTOK_PUBLIC_SERVICE_ID = "service-123";
  delete process.env.TIKTOK_AUTH_URL;

  try {
    const url = new URL(tiktokAuthorizationUrl("state-456", "publico"));
    assert.equal(url.origin, "https://services.tiktokshop.com");
    assert.equal(url.pathname, "/open/authorize");
    assert.equal(url.searchParams.get("service_id"), "service-123");
    assert.equal(url.searchParams.get("state"), "state-456");
    assert.equal(tiktokConfigured(), true);
  } finally {
    for (const [name, value] of [
      ["TIKTOK_PUBLIC_APP_KEY", previous.key],
      ["TIKTOK_PUBLIC_APP_SECRET", previous.secret],
      ["TIKTOK_PUBLIC_SERVICE_ID", previous.serviceId],
      ["TIKTOK_AUTH_URL", previous.authUrl],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("🔴 as variaveis do CUSTOM nao deixam mais o canal conectavel", () => {
  // O defeito que isto reprova: o cartao aparecer habilitado por causa do
  // app-sonda e levar o vendedor a um fluxo que depende de OUTRA credencial —
  // ele clicaria por uma variavel e quebraria por falta de outra.
  const antes = {
    ck: process.env.TIKTOK_APP_KEY, cs: process.env.TIKTOK_APP_SECRET,
    cid: process.env.TIKTOK_SERVICE_ID,
    pk: process.env.TIKTOK_PUBLIC_APP_KEY, ps: process.env.TIKTOK_PUBLIC_APP_SECRET,
    pid: process.env.TIKTOK_PUBLIC_SERVICE_ID,
  };
  process.env.TIKTOK_APP_KEY = "custom-key";
  process.env.TIKTOK_APP_SECRET = "custom-secret";
  process.env.TIKTOK_SERVICE_ID = "custom-service";
  delete process.env.TIKTOK_PUBLIC_APP_KEY;
  delete process.env.TIKTOK_PUBLIC_APP_SECRET;
  delete process.env.TIKTOK_PUBLIC_SERVICE_ID;
  try {
    assert.equal(tiktokConfigured(), false,
      "com o publico ausente o canal NAO pode se dizer conectavel, mesmo com o custom inteiro no ambiente");
  } finally {
    for (const [nome, valor] of [
      ["TIKTOK_APP_KEY", antes.ck], ["TIKTOK_APP_SECRET", antes.cs],
      ["TIKTOK_SERVICE_ID", antes.cid], ["TIKTOK_PUBLIC_APP_KEY", antes.pk],
      ["TIKTOK_PUBLIC_APP_SECRET", antes.ps], ["TIKTOK_PUBLIC_SERVICE_ID", antes.pid],
    ]) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  }
});

test("recusa autorização sem service_id", () => {
  const previousServiceId = process.env.TIKTOK_PUBLIC_SERVICE_ID;
  const previousAuthUrl = process.env.TIKTOK_AUTH_URL;
  delete process.env.TIKTOK_PUBLIC_SERVICE_ID;
  delete process.env.TIKTOK_AUTH_URL;
  try {
    assert.throws(() => tiktokAuthorizationUrl("state", "publico"), /TIKTOK_SERVICE_ID/);
  } finally {
    if (previousServiceId === undefined) delete process.env.TIKTOK_PUBLIC_SERVICE_ID;
    else process.env.TIKTOK_PUBLIC_SERVICE_ID = previousServiceId;
    if (previousAuthUrl === undefined) delete process.env.TIKTOK_AUTH_URL;
    else process.env.TIKTOK_AUTH_URL = previousAuthUrl;
  }
});

test("classifica token expirado sem propagar mensagem do provedor", () => {
  const error = classifyTiktokApiError({
    httpStatus: 401,
    code: 123,
    message: "access token has expired: conteúdo interno",
  });
  assert.equal(error.code, "REAUTH_REQUIRED");
  assert.equal(error.message.includes("conteúdo interno"), false);
});

test("erro comum é sanitizado e continua retryable", () => {
  const error = classifyTiktokApiError({ code: "50001<script>", message: "detalhe privado" });
  assert.equal(error.code, undefined);
  assert.match(error.message, /50001script/);
  assert.equal(error.message.includes("detalhe privado"), false);
});
