import test from "node:test";
import assert from "node:assert/strict";
import { currentWorkspaceId, optionalWorkspaceId, runWithWorkspace } from "../src/lib/workspaceScope.ts";

test("mantém workspaces concorrentes isolados", async () => {
  const [first, second] = await Promise.all([
    runWithWorkspace("user-a", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return currentWorkspaceId();
    }),
    runWithWorkspace("user-b", async () => currentWorkspaceId()),
  ]);

  assert.deepEqual([first, second], ["user-a", "user-b"]);
  assert.equal(optionalWorkspaceId(), undefined);
});

test("recusa acesso a dados fora de um workspace autenticado", () => {
  assert.throws(() => currentWorkspaceId(), /Workspace autenticado ausente/);
});
