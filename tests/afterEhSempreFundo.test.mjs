import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// 29/08/2026 — OITO rotas chamavam `after()` direto e NENHUMA passava por
// `runComoFundo`. O sync que a tela dispara a cada abertura rodava no pool de
// USUARIO, disputando os 8 slots de que a tela precisa para desenhar.
//
// A cerca de madrugada isolou o caminho FRIO (as cinco rotas de cron) e deixou o
// QUENTE sem cerca — e por isso desligar o agendador as 12:23 nao desligou o
// sync das telas, e "com tudo desligado" nunca foi com tudo desligado.
//
// Wrap manual site a site foi como as oito escaparam. Este teste torna a cerca
// ESTRUTURAL: importar `after` de next/server fora do helper quebra o gate.

const RAIZ = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PORTA_UNICA = path.join("lib", "depoisDaResposta.ts");

async function arquivosTs(dir) {
  const encontrados = [];
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) encontrados.push(...(await arquivosTs(caminho)));
    else if (/\.tsx?$/.test(entrada.name)) encontrados.push(caminho);
  }
  return encontrados;
}

test("so `depoisDaResposta` importa `after` de next/server", async () => {
  const arquivos = await arquivosTs(RAIZ);
  const foraDaPorta = [];
  for (const arquivo of arquivos) {
    if (arquivo.endsWith(PORTA_UNICA)) continue;
    const fonte = await readFile(arquivo, "utf8");
    if (/import\s*\{[^}]*\bafter\b[^}]*\}\s*from\s*["']next\/server["']/.test(fonte)) {
      foraDaPorta.push(path.relative(RAIZ, arquivo));
    }
  }
  assert.deepEqual(
    foraDaPorta,
    [],
    `trabalho depois da resposta fora da cerca de fundo (use depoisDaResposta): ${foraDaPorta.join(", ")}`
  );
});

test("a porta unica marca como fundo E cronometra", async () => {
  const fonte = await readFile(new URL("../src/lib/depoisDaResposta.ts", import.meta.url), "utf8");
  assert.match(fonte, /runComoFundo\(/, "sem runComoFundo o trabalho volta a competir com a tela");
  assert.match(fonte, /medirTrabalhoDeFundo\(/, "sem medicao nao da para saber quanto tempo o slot fica preso");
  // Falha aqui nao chega a tela — mas some do mundo se nao for registrada.
  assert.match(fonte, /console\.error\("\[after\] trabalho falhou"/);
});
