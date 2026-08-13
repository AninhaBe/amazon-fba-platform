import type { IntegrationConnection, PublicIntegrationConnection } from "./types";

/** Demo is an explicit seed marker; truthy strings/numbers are never trusted. */
export function isShopeeDemoConnection(
  connection: Pick<IntegrationConnection, "provider" | "metadata">
): boolean {
  return connection.provider === "shopee" && connection.metadata.demo === true;
}

/** Public demo shape contains no shop identity, timestamps, scopes or seed metadata. */
export function publicShopeeDemoConnection(
  connection: Pick<IntegrationConnection, "provider" | "metadata">
): PublicIntegrationConnection | undefined {
  if (!isShopeeDemoConnection(connection)) return undefined;
  return {
    id: "shopee:demo",
    provider: "shopee",
    externalAccountId: "demo",
    displayName: "Demonstração",
    mode: "local",
    region: "BR",
    scopes: [],
    metadata: { demo: true },
    status: "connected",
    connectedAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
}
