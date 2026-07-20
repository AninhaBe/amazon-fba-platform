import test from "node:test";
import assert from "node:assert/strict";
import { tiktokAuthorizationUrl, tiktokConfigured } from "../src/lib/tiktok.ts";

test("monta a autorização ROW com service_id e state", () => {
  const previous = {
    key: process.env.TIKTOK_APP_KEY,
    secret: process.env.TIKTOK_APP_SECRET,
    serviceId: process.env.TIKTOK_SERVICE_ID,
    authUrl: process.env.TIKTOK_AUTH_URL,
  };
  process.env.TIKTOK_APP_KEY = "app-key";
  process.env.TIKTOK_APP_SECRET = "app-secret";
  process.env.TIKTOK_SERVICE_ID = "service-123";
  delete process.env.TIKTOK_AUTH_URL;

  try {
    const url = new URL(tiktokAuthorizationUrl("state-456"));
    assert.equal(url.origin, "https://services.tiktokshop.com");
    assert.equal(url.pathname, "/open/authorize");
    assert.equal(url.searchParams.get("service_id"), "service-123");
    assert.equal(url.searchParams.get("state"), "state-456");
    assert.equal(tiktokConfigured(), true);
  } finally {
    for (const [name, value] of [
      ["TIKTOK_APP_KEY", previous.key],
      ["TIKTOK_APP_SECRET", previous.secret],
      ["TIKTOK_SERVICE_ID", previous.serviceId],
      ["TIKTOK_AUTH_URL", previous.authUrl],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("recusa autorização sem service_id", () => {
  const previousServiceId = process.env.TIKTOK_SERVICE_ID;
  const previousAuthUrl = process.env.TIKTOK_AUTH_URL;
  delete process.env.TIKTOK_SERVICE_ID;
  delete process.env.TIKTOK_AUTH_URL;
  try {
    assert.throws(() => tiktokAuthorizationUrl("state"), /TIKTOK_SERVICE_ID/);
  } finally {
    if (previousServiceId === undefined) delete process.env.TIKTOK_SERVICE_ID;
    else process.env.TIKTOK_SERVICE_ID = previousServiceId;
    if (previousAuthUrl === undefined) delete process.env.TIKTOK_AUTH_URL;
    else process.env.TIKTOK_AUTH_URL = previousAuthUrl;
  }
});
