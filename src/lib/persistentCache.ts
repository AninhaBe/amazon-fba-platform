import fs from "fs/promises";
import path from "path";
import { dataDir } from "./dataDir";

// Cache persistido em disco (<DATA_DIR>/cache/<key>.json), com timestamp.
// Sobrevive a restart do servidor — bom para respostas caras (relatórios).

function file(key: string): string {
  return path.join(dataDir(), "cache", `${key.replace(/[^a-z0-9_-]/gi, "_")}.json`);
}

export async function readCache<T>(key: string): Promise<{ at: number; value: T } | null> {
  try {
    return JSON.parse(await fs.readFile(file(key), "utf8"));
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  const f = file(key);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, JSON.stringify({ at: Date.now(), value }), "utf8");
}
