import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// 🔴 O PRIMEIRO INCIDENTE QUE O VIGIA DE DEFASAGEM PEGOU — 03/09/2026.
//
// Medido no /api/health: sync do ML "atrasado", 1 de 2 conexoes com pior caso de
// 662 MINUTOS (11 horas), enquanto o webhook estava ok (0 min). Push entregando,
// varredura morta — o cenario exato que o desacoplamento de 02/09 existe para
// tornar visivel. Sem ele, o webhook teria escrito last_success_at e o alarme
// nunca teria tocado.
//
// A CAUSA, e ela e a mesma doenca UMA CAMADA ABAIXO: o scheduler do ML re-elege
// conexao em `error` com
//
//     sync.status = 'error' AND sync.updated_at < now() - interval '15 minutes'
//
// e o webhook gravava `updated_at = now()` a cada evento. A conexao recebia push
// a cada poucos minutos, entao `updated_at` NUNCA envelhecia 15 minutos, e ela
// nunca voltava a ser candidata. Ficou 11 horas fora da varredura.
//
// 📌 Uma coluna com DOIS significados: "alguem escreveu aqui" e "quando foi a
// ultima tentativa da varredura". Ontem foi `last_success_at`; hoje `updated_at`.
// Quem le como backoff precisa de uma coluna que SO a varredura escreve.

const ler = (caminho) => readFile(new URL(caminho, import.meta.url), "utf8");
const semComentario = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

test("NENHUM caminho de push carimba updated_at do sync", async () => {
  for (const caminho of [
    "../src/lib/integrations/mercadoLivreWebhook.ts",
    "../src/app/api/webhooks/shopee/route.ts",
  ]) {
    const codigo = semComentario(await ler(caminho));
    // A forma exata que causou o incidente.
    assert.ok(!/last_push_at = now\(\), updated_at = now\(\)/.test(codigo),
      `${caminho}: push carimbando updated_at prende a conexao fora da re-eleicao`);
    // E qualquer outra forma de tocar a coluna no mesmo UPDATE.
    for (const bloco of codigo.match(/UPDATE workspace_marketplace_syncs[\s\S]{0,400}?`/g) ?? []) {
      if (!/last_push_at/.test(bloco)) continue;
      assert.ok(!/updated_at\s*=\s*now\(\)/.test(bloco),
        `${caminho}: o UPDATE do push nao pode mexer em updated_at`);
    }
  }
});

test("o scheduler continua usando updated_at como backoff — e por isso ela e sagrada", async () => {
  // Se um dia o backoff mudar de coluna, esta guarda tem de ser revisitada junto:
  // ela existe porque `updated_at` significa "ultima tentativa da varredura".
  const codigo = semComentario(await ler("../src/lib/integrations/mercadoLivreScheduler.ts"));
  assert.match(codigo, /sync\.status = 'error'[\s\S]{0,120}sync\.updated_at < now\(\) - interval '15 minutes'/,
    "o backoff de erro le updated_at; se isso mudar, a guarda acima muda junto");
});

test("e a VARREDURA continua carimbando updated_at — senao nada envelhece", async () => {
  // O outro lado da moeda: se a varredura parasse de escrever, a conexao em erro
  // seria re-eleita para sempre, em loop apertado contra a API do canal.
  const codigo = semComentario(await ler("../src/lib/integrations/mercadoLivreSync.ts"));
  assert.match(codigo, /SET status = 'error'[\s\S]{0,160}updated_at = now\(\)/,
    "a varredura precisa carimbar a tentativa que falhou");
});
