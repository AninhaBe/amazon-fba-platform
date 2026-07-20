import fs from "fs/promises";
import path from "path";
import { dataFile } from "../dataDir";
import { dbQuery, hasDb } from "../db";
import { protectSecret, revealSecret } from "./secrets";
import type { IntegrationConnection, IntegrationProvider, PublicIntegrationConnection } from "./types";
import { currentWorkspaceId } from "../workspaceScope";

const FILE = dataFile("integrations.json");

interface IntegrationRow {
  id: string;
  provider: IntegrationProvider;
  external_account_id: string;
  display_name: string | null;
  mode: IntegrationConnection["mode"];
  region: string | null;
  access_token: string | null;
  refresh_token: string | null;
  access_expires_at: Date | string | null;
  refresh_expires_at: Date | string | null;
  scopes: string[] | null;
  metadata: Record<string, unknown> | null;
  status: IntegrationConnection["status"];
  connected_at: Date | string;
  updated_at: Date | string;
}

function rowToConnection(row: IntegrationRow): IntegrationConnection {
  return {
    id: row.id,
    provider: row.provider,
    externalAccountId: row.external_account_id,
    displayName: row.display_name ?? undefined,
    mode: row.mode,
    region: row.region ?? undefined,
    accessToken: revealSecret(row.access_token),
    refreshToken: revealSecret(row.refresh_token),
    accessExpiresAt: row.access_expires_at ? new Date(row.access_expires_at).toISOString() : undefined,
    refreshExpiresAt: row.refresh_expires_at ? new Date(row.refresh_expires_at).toISOString() : undefined,
    scopes: row.scopes ?? [],
    metadata: row.metadata ?? {},
    status: row.status,
    connectedAt: new Date(row.connected_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

type StoredConnection = IntegrationConnection & { workspaceId?: string };

async function readFile(): Promise<Record<string, StoredConnection>> {
  try {
    const stored = JSON.parse(await fs.readFile(FILE, "utf8")) as Record<string, StoredConnection>;
    return Object.fromEntries(Object.entries(stored).map(([id, item]) => [id, {
      ...item,
      accessToken: revealSecret(item.accessToken),
      refreshToken: revealSecret(item.refreshToken),
    }]));
  } catch (error) {
    if (error instanceof Error && error.message.includes("INTEGRATION_TOKEN_KEY")) throw error;
    return {};
  }
}

async function writeFile(items: Record<string, StoredConnection>): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const protectedItems = Object.fromEntries(Object.entries(items).map(([id, item]) => [id, {
    ...item,
    accessToken: protectSecret(item.accessToken),
    refreshToken: protectSecret(item.refreshToken),
  }]));
  await fs.writeFile(FILE, JSON.stringify(protectedItems, null, 2), "utf8");
}

export async function getIntegrations(provider?: IntegrationProvider): Promise<IntegrationConnection[]> {
  const workspaceId = currentWorkspaceId();
  if (hasDb()) {
    const rows = await dbQuery<IntegrationRow>(
      `SELECT id, provider, external_account_id, display_name, mode, region, access_token,
              refresh_token, access_expires_at, refresh_expires_at, scopes, metadata, status,
              connected_at, updated_at
         FROM workspace_integrations
        WHERE workspace_id = $1 AND ($2::text IS NULL OR provider = $2)
        ORDER BY connected_at`,
      [workspaceId, provider ?? null]
    );
    return rows.map(rowToConnection);
  }
  const items = Object.values(await readFile()).filter((item) => item.workspaceId === workspaceId);
  return provider ? items.filter((item) => item.provider === provider) : items;
}

export async function getIntegration(id: string): Promise<IntegrationConnection | undefined> {
  const workspaceId = currentWorkspaceId();
  if (hasDb()) {
    const rows = await dbQuery<IntegrationRow>(
      `SELECT id, provider, external_account_id, display_name, mode, region, access_token,
              refresh_token, access_expires_at, refresh_expires_at, scopes, metadata, status,
              connected_at, updated_at FROM workspace_integrations WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, id]
    );
    return rows[0] ? rowToConnection(rows[0]) : undefined;
  }
  return (await readFile())[`${workspaceId}:${id}`];
}

export async function saveIntegration(
  item: Omit<IntegrationConnection, "connectedAt" | "updatedAt"> & Partial<Pick<IntegrationConnection, "connectedAt" | "updatedAt">>
): Promise<IntegrationConnection> {
  const now = new Date().toISOString();
  const workspaceId = currentWorkspaceId();
  if (hasDb()) {
    const rows = await dbQuery<IntegrationRow>(
      `INSERT INTO workspace_integrations
         (workspace_id, id, provider, external_account_id, display_name, mode, region, access_token,
          refresh_token, access_expires_at, refresh_expires_at, scopes, metadata, status,
          connected_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,now(),now())
       ON CONFLICT (workspace_id, id) DO UPDATE SET
         display_name       = COALESCE(EXCLUDED.display_name, workspace_integrations.display_name),
         mode               = EXCLUDED.mode,
         region             = COALESCE(EXCLUDED.region, workspace_integrations.region),
         access_token       = COALESCE(EXCLUDED.access_token, workspace_integrations.access_token),
         refresh_token      = COALESCE(EXCLUDED.refresh_token, workspace_integrations.refresh_token),
         access_expires_at  = COALESCE(EXCLUDED.access_expires_at, workspace_integrations.access_expires_at),
         refresh_expires_at = COALESCE(EXCLUDED.refresh_expires_at, workspace_integrations.refresh_expires_at),
         scopes             = EXCLUDED.scopes,
         metadata           = workspace_integrations.metadata || EXCLUDED.metadata,
         status             = EXCLUDED.status,
         updated_at         = now()
       RETURNING id, provider, external_account_id, display_name, mode, region, access_token,
                 refresh_token, access_expires_at, refresh_expires_at, scopes, metadata, status,
                 connected_at, updated_at`,
      [workspaceId, item.id, item.provider, item.externalAccountId, item.displayName ?? null, item.mode,
       item.region ?? null, protectSecret(item.accessToken) ?? null, protectSecret(item.refreshToken) ?? null,
       item.accessExpiresAt ?? null, item.refreshExpiresAt ?? null,
       JSON.stringify(item.scopes), JSON.stringify(item.metadata),
       item.status]
    );
    return rowToConnection(rows[0]);
  }

  const all = await readFile();
  const key = `${workspaceId}:${item.id}`;
  const saved: IntegrationConnection = {
    ...all[key],
    ...item,
    metadata: { ...(all[key]?.metadata ?? {}), ...item.metadata },
    connectedAt: all[key]?.connectedAt ?? item.connectedAt ?? now,
    updatedAt: now,
  };
  all[key] = { ...saved, workspaceId };
  await writeFile(all);
  return saved;
}

export async function removeIntegration(id: string): Promise<void> {
  const workspaceId = currentWorkspaceId();
  if (hasDb()) {
    await dbQuery(`DELETE FROM workspace_integrations WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
    return;
  }
  const all = await readFile();
  delete all[`${workspaceId}:${id}`];
  await writeFile(all);
}

export function publicConnection(item: IntegrationConnection): PublicIntegrationConnection {
  const safeMetadata = Object.fromEntries(
    Object.entries(item.metadata).filter(([, value]) =>
      value === null || ["string", "number", "boolean"].includes(typeof value)
    )
  ) as Record<string, string | number | boolean | null>;
  const { accessToken: _accessToken, refreshToken: _refreshToken, ...connection } = item;
  void _accessToken;
  void _refreshToken;
  return { ...connection, metadata: safeMetadata };
}
