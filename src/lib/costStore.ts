import fs from "fs/promises";
import path from "path";

// Cadastro de custos por produto, persistido em data/costs.json.
// Chave = SellerSKU quando existe (bate com os pedidos), senão o ASIN.

const FILE = path.join(process.cwd(), "data", "costs.json");

export interface CostEntry {
  id: string; // chave (SKU ou ASIN)
  sku?: string;
  asin?: string;
  title?: string;
  imageUrl?: string;
  cost: number;
  updatedAt: string;
}

async function readAll(): Promise<Record<string, CostEntry>> {
  try {
    const txt = await fs.readFile(FILE, "utf8");
    return JSON.parse(txt) as Record<string, CostEntry>;
  } catch {
    return {};
  }
}

async function writeAll(data: Record<string, CostEntry>): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
}

export async function getCosts(): Promise<Record<string, CostEntry>> {
  return readAll();
}

export async function setCost(
  entry: Omit<CostEntry, "updatedAt"> & { updatedAt?: string }
): Promise<CostEntry> {
  const all = await readAll();
  const merged: CostEntry = {
    ...all[entry.id],
    ...entry,
    cost: Number(entry.cost) || 0,
    updatedAt: new Date().toISOString(),
  };
  all[entry.id] = merged;
  await writeAll(all);
  return merged;
}

export async function removeCost(id: string): Promise<void> {
  const all = await readAll();
  if (all[id]) {
    delete all[id];
    await writeAll(all);
  }
}
