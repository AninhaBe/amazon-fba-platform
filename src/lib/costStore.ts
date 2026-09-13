import fs from "fs/promises";
import path from "path";
import { dataFile } from "./dataDir";
import { hasDb, dbQuery, type DbQuery } from "./db";
import { currentWorkspaceId } from "./workspaceScope";

// Cadastro de custos por produto. Persistido no Postgres (Supabase) quando
// DATABASE_URL está definido; senão, em <DATA_DIR>/costs.json (dev local).
// Chave = SellerSKU quando existe (bate com os pedidos), senão o ASIN.

const FILE = dataFile("costs.json");

/** Um custo e a data a partir da qual ele passou a valer. */
export interface CostChange {
  cost: number;
  from: string; // ISO — quando esse custo passou a vigorar
}

export interface CostEntry {
  id: string; // chave (SKU ou ASIN)
  sku?: string;
  asin?: string;
  title?: string;
  imageUrl?: string;
  cost: number; // custo atual (= último item do histórico); mantido por compatibilidade
  updatedAt: string;
  history: CostChange[]; // vigências, do mais antigo para o mais novo
}

/** Garante que uma entrada (inclusive as antigas, sem `history`) tenha histórico. */
function normalize(e: CostEntry): CostEntry {
  if (Array.isArray(e.history) && e.history.length > 0) return e;
  return { ...e, history: [{ cost: e.cost, from: e.updatedAt }] };
}

/** Custo vigente numa data (ex.: para calcular lucro histórico de uma venda). */
export function costAt(entry: CostEntry, dateISO: string): number {
  const h = normalize(entry).history;
  let result = h[0]?.cost ?? entry.cost;
  for (const change of h) {
    if (change.from <= dateISO) result = change.cost;
    else break;
  }
  return result;
}

/**
 * Custo vigente preservando a fronteira do cadastro: entrada ausente é `null`;
 * custo cadastrado como zero é um fato e continua sendo `0`.
 */
export function custoNaDataOuNull(entry: CostEntry | null | undefined, dateISO: string): number | null {
  return entry == null ? null : costAt(entry, dateISO);
}

// ---------- Postgres ----------

interface CostRow {
  id: string;
  sku: string | null;
  asin: string | null;
  title: string | null;
  image_url: string | null;
  cost: string | number;
  updated_at: Date | string;
  history: CostChange[];
}

function rowToCost(r: CostRow): CostEntry {
  return normalize({
    id: r.id,
    sku: r.sku ?? undefined,
    asin: r.asin ?? undefined,
    title: r.title ?? undefined,
    imageUrl: r.image_url ?? undefined,
    cost: Number(r.cost) || 0,
    updatedAt: new Date(r.updated_at).toISOString(),
    history: Array.isArray(r.history) ? r.history : [],
  });
}

// ---------- Arquivo JSON (fallback local) ----------

type StoredCost = CostEntry & { workspaceId?: string };

async function readAll(): Promise<Record<string, StoredCost>> {
  try {
    const txt = await fs.readFile(FILE, "utf8");
    const raw = JSON.parse(txt) as Record<string, StoredCost>;
    const out: Record<string, StoredCost> = {};
    for (const [k, v] of Object.entries(raw)) out[k] = normalize(v);
    return out;
  } catch {
    return {};
  }
}

async function writeAll(data: Record<string, StoredCost>): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
}

// ---------- API pública ----------

export async function getCosts(): Promise<Record<string, CostEntry>> {
  const workspaceId = currentWorkspaceId();
  if (hasDb()) {
    const rows = await dbQuery<CostRow>(
      `SELECT id, sku, asin, title, image_url, cost, updated_at, history
         FROM workspace_product_costs WHERE workspace_id = $1`,
      [workspaceId]
    );
    const out: Record<string, CostEntry> = {};
    for (const r of rows) out[r.id] = rowToCost(r);
    return out;
  }
  const all = await readAll();
  return Object.fromEntries(
    Object.values(all)
      .filter((entry) => entry.workspaceId === workspaceId)
      .map((entry) => [entry.id, entry])
  );
}

export async function setCost(
  entry: Omit<CostEntry, "updatedAt" | "history"> & { updatedAt?: string },
  query: DbQuery = dbQuery,
): Promise<CostEntry> {
  const now = new Date().toISOString();
  const cost = Number(entry.cost) || 0;
  const workspaceId = currentWorkspaceId();

  if (hasDb()) {
    const existing = await query<{ history: CostChange[] }>(
      `SELECT history FROM workspace_product_costs WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, entry.id]
    );
    const history = existing[0] && Array.isArray(existing[0].history) ? [...existing[0].history] : [];
    const currentCost = history.length ? history[history.length - 1].cost : undefined;
    if (currentCost === undefined || currentCost !== cost) history.push({ cost, from: now });

    const rows = await query<CostRow>(
      `INSERT INTO workspace_product_costs (workspace_id, id, sku, asin, title, image_url, cost, updated_at, history)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8::jsonb)
       ON CONFLICT (workspace_id, id) DO UPDATE SET
         sku       = COALESCE(EXCLUDED.sku, workspace_product_costs.sku),
         asin      = COALESCE(EXCLUDED.asin, workspace_product_costs.asin),
         title     = COALESCE(EXCLUDED.title, workspace_product_costs.title),
         image_url = COALESCE(EXCLUDED.image_url, workspace_product_costs.image_url),
         cost      = EXCLUDED.cost,
         updated_at = now(),
         history   = EXCLUDED.history
       RETURNING id, sku, asin, title, image_url, cost, updated_at, history`,
      [
        workspaceId,
        entry.id,
        entry.sku ?? null,
        entry.asin ?? null,
        entry.title ?? null,
        entry.imageUrl ?? null,
        cost,
        JSON.stringify(history),
      ]
    );
    return rowToCost(rows[0]);
  }

  const all = await readAll();
  const key = `${workspaceId}:${entry.id}`;
  const existing = all[key];
  const history = existing ? [...existing.history] : [];
  const currentCost = history.length ? history[history.length - 1].cost : undefined;
  if (currentCost === undefined || currentCost !== cost) history.push({ cost, from: now });

  const merged: StoredCost = { ...existing, ...entry, workspaceId, cost, updatedAt: now, history };
  all[key] = merged;
  await writeAll(all);
  return merged;
}

export async function removeCost(id: string): Promise<void> {
  const workspaceId = currentWorkspaceId();
  if (hasDb()) {
    await dbQuery(`DELETE FROM workspace_product_costs WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
    return;
  }
  const all = await readAll();
  const key = `${workspaceId}:${id}`;
  if (all[key]) {
    delete all[key];
    await writeAll(all);
  }
}
