import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
    assert.match(job, /^    timeout-minutes: 5$/m, `${name} deve ter timeout de 5 minutos`);
    assert.match(job, /^      APP_BASE_URL: \$\{\{ secrets\.APP_BASE_URL \}\}$/m);
    assert.match(job, /^      CRON_SECRET: \$\{\{ secrets\.CRON_SECRET \}\}$/m);
    assert.match(job, /curl -sS --fail-with-body --max-time 250/);
    assert.match(job, /-H "Authorization: Bearer \$\{CRON_SECRET\}"/);
  }
});
