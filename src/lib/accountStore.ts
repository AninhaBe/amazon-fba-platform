import fs from "fs/promises";
import path from "path";
import { dataFile } from "./dataDir";
import { hasDb, dbQuery } from "./db";

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
    refreshToken: r.refresh_token,
    name: r.name ?? undefined,
    marketplace: r.marketplace ?? undefined,
    connectedAt: new Date(r.connected_at).toISOString(),
  };
}

// ---------- Arquivo JSON (fallback local) ----------

async function readAll(): Promise<Record<string, Account>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

async function writeAll(data: Record<string, Account>): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
}

// ---------- API pública ----------

export async function getAccounts(): Promise<Account[]> {
  if (hasDb()) {
    const rows = await dbQuery<AccountRow>(
      `SELECT seller_id, refresh_token, name, marketplace, connected_at
         FROM accounts ORDER BY connected_at`
    );
    return rows.map(rowToAccount);
  }
  return Object.values(await readAll());
}

export async function getAccount(sellerId: string): Promise<Account | undefined> {
  if (hasDb()) {
    const rows = await dbQuery<AccountRow>(
      `SELECT seller_id, refresh_token, name, marketplace, connected_at
         FROM accounts WHERE seller_id = $1`,
      [sellerId]
    );
    return rows[0] ? rowToAccount(rows[0]) : undefined;
  }
  return (await readAll())[sellerId];
}

export async function saveAccount(
  a: Omit<Account, "connectedAt"> & { connectedAt?: string }
): Promise<Account> {
  if (hasDb()) {
    // Upsert; preserva name/marketplace existentes quando o novo valor é nulo.
    const rows = await dbQuery<AccountRow>(
      `INSERT INTO accounts (seller_id, refresh_token, name, marketplace, connected_at)
         VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (seller_id) DO UPDATE SET
         refresh_token = EXCLUDED.refresh_token,
         name          = COALESCE(EXCLUDED.name, accounts.name),
         marketplace   = COALESCE(EXCLUDED.marketplace, accounts.marketplace),
         connected_at  = now()
       RETURNING seller_id, refresh_token, name, marketplace, connected_at`,
      [a.sellerId, a.refreshToken, a.name ?? null, a.marketplace ?? null]
    );
    return rowToAccount(rows[0]);
  }
  const all = await readAll();
  const merged: Account = { ...all[a.sellerId], ...a, connectedAt: new Date().toISOString() };
  all[a.sellerId] = merged;
  await writeAll(all);
  return merged;
}

/** Define (ou limpa) o apelido de uma conta, sem tocar em token/connectedAt. */
export async function setAccountName(sellerId: string, name: string): Promise<void> {
  const value = name.trim() || null;
  if (hasDb()) {
    await dbQuery(`UPDATE accounts SET name = $2 WHERE seller_id = $1`, [sellerId, value]);
    return;
  }
  const all = await readAll();
  if (all[sellerId]) {
    all[sellerId].name = value ?? undefined;
    await writeAll(all);
  }
}

export async function removeAccount(sellerId: string): Promise<void> {
  if (hasDb()) {
    await dbQuery(`DELETE FROM accounts WHERE seller_id = $1`, [sellerId]);
    return;
  }
  const all = await readAll();
  delete all[sellerId];
  await writeAll(all);
}
