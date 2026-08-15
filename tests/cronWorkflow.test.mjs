import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

const workflow = await readFile(new URL("../.github/workflows/cron.yml", import.meta.url), "utf8");
const jobsSection = workflow.slice(workflow.search(/^jobs:\r?$/m) + "jobs:".length);
const jobEntries = [...jobsSection.matchAll(/^  ([\w-]+):\r?\n([\s\S]*?)(?=^  [\w-]+:\r?$|(?![\s\S]))/gm)];
const jobs = new Map(jobEntries.map(([, name, body]) => [name, body]));

const expectedJobs = new Map([
  ["sync-mercado-livre", "/api/cron/mercado-livre-sync"],
  ["sync-amazon", "/api/cron/amazon-sync"],
  ["sync-shopee", "/api/cron/shopee-sync"],
  ["sync-tiktok", "/api/cron/tiktok-sync"],
]);

test("cron separa os quatro marketplaces em jobs independentes", () => {
  assert.deepEqual([...jobs.keys()].sort(), [...expectedJobs.keys()].sort());

  for (const [name, endpoint] of expectedJobs) {
    const job = jobs.get(name);
    assert.ok(job, `job ${name} ausente`);
    assert.doesNotMatch(job, /^    needs:/m, `${name} não deve depender de outro job`);
    assert.match(job, new RegExp(`${endpoint.replaceAll("/", "\\/")}(?:["']|$)`, "m"));
  }
});

test("cada job preserva timeout, autenticação e limites do curl", () => {
  for (const [name, job] of jobs) {
    // 8 min, não 5: precisa caber a tentativa original mais as duas repetições
    // (3 × 120s de `--max-time` + 2 × 15s de espera ≈ 4,5 min de pior caso).
    assert.match(job, /^    timeout-minutes: 8$/m, `${name} deve ter timeout de 8 minutos`);
    assert.match(job, /^      APP_BASE_URL: \$\{\{ secrets\.APP_BASE_URL \}\}$/m);
    assert.match(job, /^      CRON_SECRET: \$\{\{ secrets\.CRON_SECRET \}\}$/m);
    assert.match(job, /curl -sS --fail-with-body/);
    assert.match(job, /-H "Authorization: Bearer \$\{CRON_SECRET\}"/);
  }
});

test("toda chamada repete o que for transitório antes de falhar", () => {
  // Um deploy no Render reinicia o container e devolve 502 a quem estiver
  // chamando. Sem repetição, isso vira e-mail de falha sem nada quebrado —
  // e-mail que a Ana recebeu em série em 15/08/2026 até parar de acreditar nele.
  for (const [name, job] of jobs) {
    assert.match(job, /--retry 2 --retry-delay 15 --retry-all-errors/, `${name} precisa repetir erro transitório`);
    // O pior caso das tentativas tem de caber no timeout do job.
    const [, maxTime] = job.match(/--max-time (\d+)/) ?? [];
    assert.ok(maxTime, `${name} precisa limitar cada tentativa`);
    const pior = 3 * Number(maxTime) + 2 * 15;
    assert.ok(pior < 8 * 60, `${name}: pior caso ${pior}s estoura o timeout de 8 min`);
  }
});

test("repetir nao pode virar silencio: o job ainda falha se persistir", () => {
  // `--fail-with-body` mantém o exit code de erro depois das tentativas, então
  // falha real continua chegando por e-mail. Retirar isto transformaria o cron
  // num sino que nunca toca.
  for (const [name, job] of jobs) {
    assert.match(job, /--fail-with-body/, `${name} nao pode engolir erro persistente`);
    assert.doesNotMatch(job, /\|\|\s*true/, `${name} nao pode mascarar o exit code`);
    assert.doesNotMatch(job, /continue-on-error/, `${name} nao pode ignorar a falha`);
  }
});

test("o orcamento do TikTok nao pode voltar a destoar dos outros canais", () => {
  // 180_000 era nove vezes o de todos os demais (Shopee e o proprio
  // runTiktokSyncBatch usam 20_000). Com os quatro jobs em paralelo no mesmo
  // container, o TikTok era o unico que morria: 502 em 37s, 75s e 100s medidos
  // em 15/08/2026, sem nunca avancar o checkpoint financeiro.
  const scheduler = readFileSync(new URL("../src/lib/integrations/tiktokScheduler.ts", import.meta.url), "utf8");
  const [, budget] = scheduler.match(/budgetMs = (\d[\d_]*)/) ?? [];
  assert.ok(budget, "runScheduledTiktokSync precisa declarar budgetMs");
  const ms = Number(budget.replace(/_/g, ""));
  assert.ok(ms <= 60_000, `budgetMs de ${ms}ms segura memoria demais numa requisicao so`);
  // E o `maxDuration` da rota ainda tem de cobrir o orcamento mais a fase financeira.
  const rota = readFileSync(new URL("../src/app/api/cron/tiktok-sync/route.ts", import.meta.url), "utf8");
  const [, maxDuration] = rota.match(/maxDuration = (\d+)/) ?? [];
  assert.ok(Number(maxDuration) * 1000 >= ms + ms / 3, "maxDuration precisa cobrir sync + financeiro");
});
