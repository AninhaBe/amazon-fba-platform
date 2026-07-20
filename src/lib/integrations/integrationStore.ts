import fs from "fs/promises";
import path from "path";
import { dataFile } from "../dataDir";
import { dbQuery, hasDb } from "../db";
import { protectSecret, revealSecret } from "./secrets";
import type { IntegrationConnection, IntegrationProvider, PublicIntegrationConnection } from "./types";

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

async function readFile(): Promise<Record<string, IntegrationConnection>> {
  try {
    const stored = JSON.parse(await fs.readFile(FILE, "utf8")) as Record<string, IntegrationConnection>;
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

async function writeFile(items: Record<string, IntegrationConnection>): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const protectedItems = Object.fromEntries(Object.entries(items).map(([id, item]) => [id, {
    ...item,
    accessToken: protectSecret(item.accessToken),
    refreshToken: protectSecret(item.refreshToken),
  }]));
  await fs.writeFile(FILE, JSON.stringify(protectedItems, null, 2), "utf8");
}

export async function getIntegrations(provider?: IntegrationProvider): Promise<IntegrationConnection[]> {
  if (hasDb()) {
    const rows = await dbQuery<IntegrationRow>(
      `SELECT id, provider, external_account_id, display_name, mode, region, access_token,
              refresh_token, access_expires_at, refresh_expires_at, scopes, metadata, status,
              connected_at, updated_at
         FROM integrations
        WHERE ($1::text IS NULL OR provider = $1)
        ORDER BY connected_at`,
      [provider ?? null]
    );
    return rows.map(rowToConnection);
  }
  const items = Object.values(await readFile());
  return provider ? items.filter((item) => item.provider === provider) : items;
}

export async function getIntegration(id: string): Promise<IntegrationConnection | undefined> {
  if (hasDb()) {
    const rows = await dbQuery<IntegrationRow>(
      `SELECT id, provider, external_account_id, display_name, mode, region, access_token,
              refresh_token, access_expires_at, refresh_expires_at, scopes, metadata, status,
              connected_at, updated_at FROM integrations WHERE id = $1`,
      [id]
    );
    return rows[0] ? rowToConnection(rows[0]) : undefined;
  }
  return (await readFile())[id];
}

export async function saveIntegration(
  item: Omit<IntegrationConnection, "connectedAt" | "updatedAt"> & Partial<Pick<IntegrationConnection, "connectedAt" | "updatedAt">>
): Promise<IntegrationConnection> {
  const now = new Date().toISOString();
  if (hasDb()) {
    const rows = await dbQuery<IntegrationRow>(
      `INSERT INTO integrations
         (id, provider, external_account_id, display_name, mode, region, access_token,
          refresh_token, access_expires_at, refresh_expires_at, scopes, metadata, status,
          connected_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now())
       ON CONFLICT (id) DO UPDATE SET
         display_name       = COALESCE(EXCLUDED.display_name, integrations.display_name),
         mode               = EXCLUDED.mode,
         region             = COALESCE(EXCLUDED.region, integrations.region),
         access_token       = COALESCE(EXCLUDED.access_token, integrations.access_token),
         refresh_token      = COALESCE(EXCLUDED.refresh_token, integrations.refresh_token),
         access_expires_at  = COALESCE(EXCLUDED.access_expires_at, integrations.access_expires_at),
         refresh_expires_at = COALESCE(EXCLUDED.refresh_expires_at, integrations.refresh_expires_at),
         scopes             = EXCLUDED.scopes,
         metadata           = integrations.metadata || EXCLUDED.metadata,
         status             = EXCLUDED.status,
         updated_at         = now()
       RETURNING id, provider, external_account_id, display_name, mode, region, access_token,
                 refresh_token, access_expires_at, refresh_expires_at, scopes, metadata, status,
                 connected_at, updated_at`,
      [item.id, item.provider, item.externalAccountId, item.displayName ?? null, item.mode,
       item.region ?? null, protectSecret(item.accessToken) ?? null, protectSecret(item.refreshToken) ?? null,
       item.accessExpiresAt ?? null, item.refreshExpiresAt ?? null, item.scopes, item.metadata,
       item.status]
    );
    return rowToConnection(rows[0]);
  }

  const all = await readFile();
  const saved: IntegrationConnection = {
    ...all[item.id],
    ...item,
    metadata: { ...(all[item.id]?.metadata ?? {}), ...item.metadata },
    connectedAt: all[item.id]?.connectedAt ?? item.connectedAt ?? now,
    updatedAt: now,
  };
  all[item.id] = saved;
  await writeFile(all);
  return saved;
}

export async function removeIntegration(id: string): Promise<void> {
  if (hasDb()) {
    await dbQuery(`DELETE FROM integrations WHERE id = $1`, [id]);
    return;
  }
  const all = await readFile();
  delete all[id];
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
