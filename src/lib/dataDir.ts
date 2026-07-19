import path from "path";

// Diretório onde os dados locais (custos, contas) são gravados.
// Em produção (Render), aponte DATA_DIR para o disco persistente montado.
export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function dataFile(...segments: string[]): string {
  const configured = process.env.DATA_DIR;
  return configured
    ? path.join(configured, ...segments)
    : path.join(process.cwd(), "data", ...segments);
}
