import fs from "fs/promises";
import path from "path";
import { dataFile } from "./dataDir";

// Contas conectadas via OAuth, persistidas em <DATA_DIR>/accounts.json.
// Cada vendedor que autoriza o app entra aqui com seu refresh token.

const FILE = dataFile("accounts.json");

export interface Account {
  sellerId: string; // selling_partner_id devolvido pela Amazon
  refreshToken: string;
  name?: string; // apelido definido pelo usuário (tem prioridade na exibição)
  marketplace?: string; // nome do marketplace, preenchido automaticamente (ex.: "Amazon.com.br")
  connectedAt: string;
}

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

export async function getAccounts(): Promise<Account[]> {
  return Object.values(await readAll());
}

export async function getAccount(sellerId: string): Promise<Account | undefined> {
  return (await readAll())[sellerId];
}

export async function saveAccount(a: Omit<Account, "connectedAt"> & { connectedAt?: string }): Promise<Account> {
  const all = await readAll();
  const merged: Account = { ...all[a.sellerId], ...a, connectedAt: new Date().toISOString() };
  all[a.sellerId] = merged;
  await writeAll(all);
  return merged;
}

/** Define (ou limpa) o apelido de uma conta, sem tocar em token/connectedAt. */
export async function setAccountName(sellerId: string, name: string): Promise<void> {
  const all = await readAll();
  if (all[sellerId]) {
    all[sellerId].name = name.trim() || undefined;
    await writeAll(all);
  }
}

export async function removeAccount(sellerId: string): Promise<void> {
  const all = await readAll();
  delete all[sellerId];
  await writeAll(all);
}
