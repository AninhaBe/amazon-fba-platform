import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Passo 4 do plano da migração canônica (docs/canonical-schema.md): "desligar
// materializer/snapshots". Executado em 28/08/2026, depois de o inventário da
// frente L medir 3,0 MILHÕES de updates em 12 linhas — o materializer já estava
// morto (zero chamadores) e ninguém lia os snapshots (a rota do ML lê o
// canônico direto); o que sobrava era a INVALIDAÇÃO órfã em todo passo de
// sync, webhook e custo, gerando WAL à toa. Este guarda impede o retorno.

test("os módulos de snapshot do overview do ML não existem mais", () => {
  assert.equal(existsSync(new URL("../src/lib/integrations/mercadoLivreOverviewMaterializer.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../src/lib/integrations/mercadoLivreOverviewCache.ts", import.meta.url)), false);
});

test("nenhum ex-chamador voltou a invalidar snapshot do overview do ML", async () => {
  const arquivos = [
    "../src/lib/costInvalidation.ts",
    "../src/lib/integrations/mercadoLivreSync.ts",
    "../src/lib/integrations/mercadoLivreWebhook.ts",
  ];
  for (const arquivo of arquivos) {
    const fonte = await readFile(new URL(arquivo, import.meta.url), "utf8");
    assert.doesNotMatch(fonte, /invalidateMercadoLivreOverviewSnapshots/, `${arquivo} voltou a invalidar snapshot morto`);
    assert.doesNotMatch(fonte, /mercadoLivreOverviewCache/, `${arquivo} voltou a importar o módulo removido`);
  }
});
