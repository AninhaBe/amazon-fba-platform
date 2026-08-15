import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Guarda de fronteira entre canais.
//
// Em 15/08/2026 a loja TikTok do sócio apareceu dentro de /amazon/produtos: o
// `getProducts()` — que alimenta telas de "Operação Amazon" — consultava
// `workspace_channel_products WHERE provider='tiktok_shop'` e juntava tudo na
// mesma lista. Entrou no commit fb48a81, de 186 arquivos, sem revisão focada.
// Efeito: 70 produtos que não eram nem dela nem da Amazon, e o card "produtos sem
// custo" do dashboard mandando cadastrar custo de todos eles.
//
// A regra: quem consulta canal por nome mora em src/lib/integrations/. Módulo de
// escopo genérico ou de um canal não pode ler o de outro.

const RAIZ_LIB = path.join(process.cwd(), "src", "lib");
const PROVIDERS = ["tiktok_shop", "shopee", "mercado_livre", "amazon"];

function arquivosDaRaizDeLib() {
  return readdirSync(RAIZ_LIB, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => path.join(RAIZ_LIB, e.name));
}

test("módulo fora de integrations/ não consulta canal por nome", () => {
  const infratores = [];
  for (const arquivo of arquivosDaRaizDeLib()) {
    const src = readFileSync(arquivo, "utf8");
    // Ignora comentários: o histórico do bug está documentado em prosa.
    const codigo = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const p of PROVIDERS) {
      if (new RegExp(`provider\\s*=\\s*'${p}'|provider\\s*=\\s*"${p}"`).test(codigo)) {
        infratores.push(`${path.basename(arquivo)} → provider='${p}'`);
      }
    }
  }
  assert.deepEqual(
    infratores,
    [],
    `Consulta a canal específico fora de src/lib/integrations/:\n  ${infratores.join("\n  ")}`
  );
});

test("getProducts é da Amazon e não importa nenhum canal", () => {
  const src = readFileSync(path.join(RAIZ_LIB, "products.ts"), "utf8");
  const codigo = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(codigo, /workspace_channel_products/, "products.ts não deve consultar catálogo de canal");
  assert.doesNotMatch(codigo, /from "\.\/integrations\//, "products.ts não deve importar módulo de canal");
  assert.doesNotMatch(codigo, /"tiktok"|'tiktok'/, "products.ts não deve conhecer TikTok");
});
