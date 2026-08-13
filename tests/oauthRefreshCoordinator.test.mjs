import test from "node:test";
import assert from "node:assert/strict";
import "../scripts/ts-resolver.mjs";

const { coordinateOAuthRefresh } = await import("../src/lib/integrations/oauthRefreshLease.ts");

const secret = "deterministic-test-secret-at-least-32-bytes";

function harness() {
  const state = { lease: null, calls: [], fresh: null, duringHttp: false, transactionDuringHttp: false };
  const query = async (sql, params = []) => {
    state.calls.push(sql);
    if (sql.includes("oauth_refresh_try_claim")) {
      const owner = params[3];
      if (!state.lease) state.lease = { owner, status: "claimed" };
      if (state.lease.status === "claimed_expired") state.lease = { owner, status: "claimed" };
      return [{ acquired: state.lease.owner === owner && state.lease.status === "claimed",
        lease_state: state.lease.status, lease_remaining_ms: 25 }];
    }
    if (sql.includes("oauth_refresh_mark_in_flight")) {
      const ok = state.lease?.owner === params[3] && state.lease.status === "claimed";
      if (ok) state.lease.status = "in_flight";
      return [{ oauth_refresh_mark_in_flight: ok }];
    }
    if (sql.includes("oauth_refresh_mark_indeterminate")) {
      const ok = state.lease?.owner === params[3];
      if (ok) state.lease.status = "indeterminate";
      return [{ oauth_refresh_mark_indeterminate: ok }];
    }
    if (sql.includes("oauth_refresh_release_owned")) {
      const ok = state.lease?.owner === params[3];
      if (ok) state.lease = null;
      return [{ oauth_refresh_release_owned: ok }];
    }
    if (sql.includes("oauth_refresh_grant_xact_lock")) return [{}];
    if (sql.includes("FROM workspace_oauth_refresh_leases")) {
      return state.lease ? [{ owner_token: state.lease.owner, state: state.lease.status }] : [];
    }
    return [];
  };
  const transaction = async (body) => {
    if (state.duringHttp) state.transactionDuringHttp = true;
    return body(query);
  };
  return { state, query, transaction };
}

function options(h, overrides = {}) {
  return {
    workspaceId: "ws", provider: "tiktok_shop", refreshToken: "grant", leaseMs: 1_000,
    fingerprintSecret: secret, ownerToken: "owner-a", query: h.query, transaction: h.transaction,
    clock: { random: () => 0, sleep: async () => {} },
    readFresh: async () => h.state.fresh,
    refresh: async () => ({ access: "remote" }),
    finalize: async () => ({ access: "persisted" }),
    isInvalidGrant: (error) => error?.code === "REAUTH_REQUIRED",
    isSafeToRelease: () => false,
    ...overrides,
  };
}

test("coordenador real faz claim e in_flight antes do HTTP, sem transação/pool reservado", async () => {
  const h = harness();
  const result = await coordinateOAuthRefresh(options(h, {
    refresh: async () => {
      h.state.duringHttp = true;
      assert.equal(h.state.lease.status, "in_flight");
      await new Promise((resolve) => setImmediate(resolve));
      h.state.duringHttp = false;
      return { access: "remote" };
    },
  }));
  assert.deepEqual(result, { access: "persisted" });
  assert.equal(h.state.transactionDuringHttp, false);
  assert.ok(h.state.calls.findIndex((sql) => sql.includes("try_claim")) < h.state.calls.findIndex((sql) => sql.includes("mark_in_flight")));
});

test("owner perdido antes de in_flight não inicia request", async () => {
  const h = harness();
  let requested = false;
  const baseQuery = h.query;
  h.query = async (sql, params) => {
    const rows = await baseQuery(sql, params);
    if (sql.includes("try_claim")) h.state.lease.owner = "other";
    return rows;
  };
  await assert.rejects(coordinateOAuthRefresh(options(h, { query: h.query, refresh: async () => { requested = true; return {}; } })), /perdido/);
  assert.equal(requested, false);
});

test("crash antes de in_flight permite takeover do claimed expirado", async () => {
  const h = harness();
  h.state.lease = { owner: "crashed", status: "claimed_expired" };
  assert.deepEqual(await coordinateOAuthRefresh(options(h)), { access: "persisted" });
});

test("in_flight expirado promovido pelo banco a indeterminate nunca faz takeover", async () => {
  const h = harness();
  h.state.lease = { owner: "crashed", status: "indeterminate" };
  let requested = false;
  await assert.rejects(coordinateOAuthRefresh(options(h, { refresh: async () => { requested = true; return {}; } })), /indeterminado/);
  assert.equal(requested, false);
});

for (const label of ["5xx", "timeout", "json inválido"]) {
  test(`${label} após in_flight fica indeterminado e não libera`, async () => {
    const h = harness();
    await assert.rejects(coordinateOAuthRefresh(options(h, { refresh: async () => { throw new Error(label); } })), new RegExp(label));
    assert.equal(h.state.lease.status, "indeterminate");
    assert.equal(h.state.calls.some((sql) => sql.includes("release_owned")), false);
  });
}

test("waiter usa lease_remaining_ms do claim e retorna credencial do vencedor", async () => {
  const h = harness();
  h.state.lease = { owner: "winner", status: "claimed" };
  const sleeps = [];
  const result = await coordinateOAuthRefresh(options(h, {
    clock: { random: () => 0, sleep: async (ms) => { sleeps.push(ms); h.state.fresh = { access: "winner" }; } },
  }));
  assert.deepEqual(result, { access: "winner" });
  assert.deepEqual(sleeps, [25]);
});

test("invalid_grant que perde para callback retorna credencial nova", async () => {
  const h = harness();
  const invalid = Object.assign(new Error("invalid_grant"), { code: "REAUTH_REQUIRED" });
  const result = await coordinateOAuthRefresh(options(h, {
    refresh: async () => { throw invalid; },
    finalizeInvalidGrant: async () => { h.state.fresh = { access: "callback" }; return h.state.fresh; },
  }));
  assert.deepEqual(result, { access: "callback" });
});

test("callback durante HTTP faz o resultado remoto perder o CAS e retorna a reautorização", async () => {
  const h = harness();
  const result = await coordinateOAuthRefresh(options(h, {
    refresh: async () => {
      h.state.fresh = { access: "callback" };
      return { access: "stale-remote" };
    },
    finalize: async () => null,
  }));
  assert.deepEqual(result, { access: "callback" });
});

test("grants distintos usam fingerprints e leases independentes", async () => {
  const a = harness();
  const b = harness();
  const results = await Promise.all([
    coordinateOAuthRefresh(options(a, { refreshToken: "grant-a" })),
    coordinateOAuthRefresh(options(b, { refreshToken: "grant-b", ownerToken: "owner-b" })),
  ]);
  assert.equal(results.length, 2);
});
