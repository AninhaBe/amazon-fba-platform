import fs from "fs/promises";
import path from "path";
import { dataFile } from "./dataDir";

// Cadastro de custos por produto, persistido em <DATA_DIR>/costs.json.
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

async function readAll(): Promise<Record<string, CostEntry>> {
  try {
    const txt = await fs.readFile(FILE, "utf8");
    const raw = JSON.parse(txt) as Record<string, CostEntry>;
    // normaliza na leitura → arquivos antigos (sem history) continuam funcionando.
    const out: Record<string, CostEntry> = {};
    for (const [k, v] of Object.entries(raw)) out[k] = normalize(v);
    return out;
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
  entry: Omit<CostEntry, "updatedAt" | "history"> & { updatedAt?: string }
): Promise<CostEntry> {
  const all = await readAll();
  const now = new Date().toISOString();
  const existing = all[entry.id];
  const cost = Number(entry.cost) || 0;

  // Só registra nova vigência quando o custo realmente muda (não a cada edição
  // de título/imagem). Assim o histórico reflete mudanças de custo, não ruído.
  const history = existing ? [...existing.history] : [];
  const currentCost = history.length ? history[history.length - 1].cost : undefined;
  if (currentCost === undefined || currentCost !== cost) {
    history.push({ cost, from: now });
  }

  const merged: CostEntry = {
    ...existing,
    ...entry,
    cost,
    updatedAt: now,
    history,
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
