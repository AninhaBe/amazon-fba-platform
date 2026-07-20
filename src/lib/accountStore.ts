import fs from "fs/promises";
import path from "path";
import { dataFile } from "./dataDir";
import { hasDb, dbQuery } from "./db";
import { currentWorkspaceId } from "./workspaceScope";
import { protectSecret, revealSecret } from "./integrations/secrets";

// Contas conectadas via OAuth. Persistidas no Postgres (Supabase) quando
// DATABASE_URL está definido; senão, em <DATA_DIR>/accounts.json (dev local).

const FILE = dataFile("accounts.json");

export interface Account {
  sellerId: string; // selling_partner_id devolvido pela Amazon
  refreshToken: string;
  name?: string; // apelido definido pelo usuário (tem prioridade na exibição)
  marketplace?: string; // nome do marketplace, preenchido automaticamente (ex.: "Amazon.com.br")
  connectedAt: string;
}

// ---------- Postgres ----------

interface AccountRow {
  seller_id: string;
  refresh_token: string;
  name: string | null;
  marketplace: string | null;
  connected_at: Date | string;
}

function rowToAccount(r: AccountRow): Account {
  return {
    sellerId: r.seller_id,
    refreshToken: revealSecret(r.refresh_token) ?? "",
    name: r.name ?? undefined,
    marketplace: r.marketplace ?? undefined,
    connectedAt: new Date(r.connected_at).toISOString(),
  };
}

// ---------- Arquivo JSON (fallback local) ----------

type StoredAccount = Account & { workspaceId?: string };

async function readAll(): Promise<Record<string, StoredAccount>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

async function writeAll(data: Record<string, StoredAccount>): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
}

// ---------- API pública ----------

export async function getAccounts(): Promise<Account[]> {
  const workspaceId = currentWorkspaceId();
  if (hasDb()) {
    const rows = await dbQuery<AccountRow>(
      `SELECT seller_id, refresh_token, name, marketplace, connected_at
         FROM workspace_accounts WHERE workspace_id = $1 ORDER BY connected_at`,
      [workspaceId]
    );
    return rows.map(rowToAccount);
  }
  return Object.values(await readAll()).filter((account) => account.workspaceId === workspaceId);
}

export async function getAccount(sellerId: string): Promise<Account | undefined> {
  const workspaceId = currentWorkspaceId();
  if (hasDb()) {
    const rows = await dbQuery<AccountRow>(
      `SELECT seller_id, refresh_token, name, marketplace, connected_at
         FROM workspace_accounts WHERE workspace_id = $1 AND seller_id = $2`,
      [workspaceId, sellerId]
    );
    return rows[0] ? rowToAccount(rows[0]) : undefined;
  }
  return (await readAll())[`${workspaceId}:${sellerId}`];
}

export async function saveAccount(
  a: Omit<Account, "connectedAt"> & { connectedAt?: string }
): Promise<Account> {
  const workspaceId = currentWorkspaceId();
  if (hasDb()) {
    // Upsert; preserva name/marketplace existentes quando o novo valor é nulo.
    const rows = await dbQuery<AccountRow>(
      `INSERT INTO workspace_accounts (workspace_id, seller_id, refresh_token, name, marketplace, connected_at)
         VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (workspace_id, seller_id) DO UPDATE SET
         refresh_token = EXCLUDED.refresh_token,
         name          = COALESCE(EXCLUDED.name, workspace_accounts.name),
         marketplace   = COALESCE(EXCLUDED.marketplace, workspace_accounts.marketplace),
         connected_at  = now()
       RETURNING seller_id, refresh_token, name, marketplace, connected_at`,
      [workspaceId, a.sellerId, protectSecret(a.refreshToken), a.name ?? null, a.marketplace ?? null]
    );
    return rowToAccount(rows[0]);
  }
  const all = await readAll();
  const key = `${workspaceId}:${a.sellerId}`;
  const merged: StoredAccount = { ...all[key], ...a, workspaceId, connectedAt: new Date().toISOString() };
  all[key] = merged;
  await writeAll(all);
  return merged;
}

/** Define (ou limpa) o apelido de uma conta, sem tocar em token/connectedAt. */
export async function setAccountName(sellerId: string, name: string): Promise<void> {
  const workspaceId = currentWorkspaceId();
  const value = name.trim() || null;
  if (hasDb()) {
    await dbQuery(`UPDATE workspace_accounts SET name = $3 WHERE workspace_id = $1 AND seller_id = $2`, [workspaceId, sellerId, value]);
    return;
  }
  const all = await readAll();
  const key = `${workspaceId}:${sellerId}`;
  if (all[key]) {
    all[key].name = value ?? undefined;
    await writeAll(all);
  }
}

export async function removeAccount(sellerId: string): Promise<void> {
  const workspaceId = currentWorkspaceId();
  if (hasDb()) {
    await dbQuery(`DELETE FROM workspace_accounts WHERE workspace_id = $1 AND seller_id = $2`, [workspaceId, sellerId]);
    return;
  }
  const all = await readAll();
  delete all[`${workspaceId}:${sellerId}`];
  await writeAll(all);
}
