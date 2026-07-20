import { AsyncLocalStorage } from "node:async_hooks";

const workspaceStorage = new AsyncLocalStorage<string>();

export function currentWorkspaceId(): string {
  const workspaceId = workspaceStorage.getStore();
  if (!workspaceId) throw new Error("Workspace autenticado ausente.");
  return workspaceId;
}

export function optionalWorkspaceId(): string | undefined {
  return workspaceStorage.getStore();
}

export function runWithWorkspace<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return workspaceStorage.run(workspaceId, fn);
}
