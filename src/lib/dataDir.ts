import path from "path";

// Diretório onde os dados locais (custos, contas) são gravados.
// Em produção (Render), aponte DATA_DIR para o disco persistente montado.
export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function dataFile(name: string): string {
  return path.join(dataDir(), name);
}
