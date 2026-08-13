import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { removeLocalShopeeConnection } from "../src/lib/integrations/shopeeRemoval.ts";
import {
  withShopeeIntegrationWriteFence,
  withShopeeSyncWriteFence,
} from "../src/lib/integrations/shopeeWriteFence.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function mutex() {
  let tail = Promise.resolve();
  return async () => {
    const previous = tail;
    let release;
    tail = new Promise((done) => { release = done; });
    await previous;
    return release;
  };
}

function fakeDatabase({ pauseRemovalAfterIntegrationLock } = {}) {
  const acquireIntegration = mutex();
  const acquireSync = mutex();
  const removalHasIntegration = deferred();
  const state = { integration: true, sync: true, syncData: false, integrationData: false };

  const transaction = async (work) => {
    const releases = [];
    let integrationHeld = false;
    let syncHeld = false;
    const query = async (sql) => {
      if (/SELECT id FROM workspace_integrations/.test(sql)) {
        if (!integrationHeld) {
          releases.push(await acquireIntegration());
          integrationHeld = true;
        }
        if (pauseRemovalAfterIntegrationLock && /provider=\$3\s*\n?\s*FOR UPDATE/.test(sql)) {
          removalHasIntegration.resolve();
          await pauseRemovalAfterIntegrationLock;
        }
        return state.integration ? [{ id: "shopee:1" }] : [];
      }
      if (/SELECT connection_id FROM workspace_marketplace_syncs/.test(sql)) {
        if (!syncHeld) {
          releases.push(await acquireSync());
          syncHeld = true;
        }
        return state.sync ? [{ connection_id: "shopee:1" }] : [];
      }
      if (/DELETE FROM workspace_integrations/.test(sql)) {
        state.integration = false;
        return [{ id: "shopee:1" }];
      }
      if (/DELETE FROM workspace_marketplace_syncs/.test(sql)) {
        state.sync = false;
        return [];
      }
      if (/DELETE FROM workspace_channel_orders/.test(sql)) state.syncData = false;
      if (/DELETE FROM workspace_product_costs|DELETE FROM workspace_settings/.test(sql)) state.integrationData = false;
      if (sql === "WRITE_SYNC_DATA") state.syncData = true;
      if (sql === "WRITE_INTEGRATION_DATA") state.integrationData = true;
      return [];
    };
    try {
      return await work(query);
    } finally {
      for (const release of releases.reverse()) release();
    }
  };
  return { transaction, state, removalHasIntegration };
}

test("remoção espera writer de sync em voo e apaga o dado antes de concluir", async () => {
  const database = fakeDatabase();
  const writerHasSync = deferred();
  const allowWriter = deferred();
  const writer = withShopeeSyncWriteFence(
    database.transaction,
    "workspace",
    "shopee:1",
    "lease",
    async (query) => {
      writerHasSync.resolve();
      await allowWriter.promise;
      await query("WRITE_SYNC_DATA");
    },
  );
  await writerHasSync.promise;

  const removal = removeLocalShopeeConnection(database.transaction, "workspace", "shopee:1");
  allowWriter.resolve();
  const [written, removed] = await Promise.all([writer, removal]);

  assert.equal(written.owned, true);
  assert.equal(removed, true);
  assert.equal(database.state.integration, false);
  assert.equal(database.state.syncData, false);
});

test("writer de custo/configuração atrasado vê conexão removida e não recria órfão", async () => {
  const allowRemoval = deferred();
  const database = fakeDatabase({ pauseRemovalAfterIntegrationLock: allowRemoval.promise });
  const removal = removeLocalShopeeConnection(database.transaction, "workspace", "shopee:1");
  await database.removalHasIntegration.promise;

  let workCalled = false;
  const writer = withShopeeIntegrationWriteFence(
    database.transaction,
    "workspace",
    "shopee:1",
    async (query) => {
      workCalled = true;
      await query("WRITE_INTEGRATION_DATA");
    },
  );
  allowRemoval.resolve();
  const [removed, written] = await Promise.all([removal, writer]);

  assert.equal(removed, true);
  assert.deepEqual(written, { owned: false });
  assert.equal(workCalled, false);
  assert.equal(database.state.integrationData, false);
});

test("todos os writers Shopee mutáveis usam o fence correspondente", () => {
  const sync = fs.readFileSync(new URL("../src/lib/integrations/shopeeSync.ts", import.meta.url), "utf8");
  const modules = fs.readFileSync(new URL("../src/lib/integrations/shopeeModules.ts", import.meta.url), "utf8");
  const settings = fs.readFileSync(new URL("../src/app/api/integrations/shopee/settings/route.ts", import.meta.url), "utf8");
  assert.ok((sync.match(/withShopeeSyncWriteFence\(/g) ?? []).length >= 2);
  assert.match(modules, /withShopeeIntegrationWriteFence\([\s\S]+setCost\(entry, query\)/);
  assert.match(settings, /withShopeeIntegrationWriteFence\([\s\S]+setShopeeTaxRateSetting\(query/);
});
