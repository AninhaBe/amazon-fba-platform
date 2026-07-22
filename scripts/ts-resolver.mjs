// Permite que scripts standalone importem os módulos .ts do projeto, que usam
// imports relativos sem extensão ("../db"): quando a resolução padrão falha,
// tenta o mesmo caminho com ".ts". Usar junto com --experimental-strip-types:
//   node --experimental-strip-types --import ./scripts/ts-resolver.mjs <script>

import { register } from "node:module";
import { isMainThread } from "node:worker_threads";

// Os hooks rodam num worker dedicado; só o processo principal registra.
if (isMainThread) register(import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const relative = specifier.startsWith("./") || specifier.startsWith("../");
    if (error?.code === "ERR_MODULE_NOT_FOUND" && relative && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
