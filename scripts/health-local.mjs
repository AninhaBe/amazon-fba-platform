import { spawn } from "node:child_process";
import net from "node:net";
import process from "node:process";

const results = [];
const npmCli = process.env.npm_execpath;

function npmArgs(args) {
  return npmCli ? { command: process.execPath, args: [npmCli, ...args] } : { command: "npm", args };
}

export function acceptsStatus(actual, expected) {
  return expected.includes(actual);
}

export function summarize(resultsToSummarize) {
  const failed = resultsToSummarize.filter((result) => result.status === "FAIL").length;
  const blocked = resultsToSummarize.filter((result) => result.status === "BLOCKED").length;
  return { failed, blocked, exitCode: failed ? 1 : 0 };
}

function record(stage, status, detail) {
  const result = { stage, status, detail };
  results.push(result);
  console.log(`${status.padEnd(7)} ${stage} - ${detail}`);
}

function run(command, args, stage) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", (error) => {
      record(stage, "FAIL", `não iniciou: ${error.message}`);
      resolve(false);
    });
    child.on("exit", (code, signal) => {
      if (code === 0) record(stage, "PASS", "concluído");
      else record(stage, "FAIL", `exit ${code ?? `signal ${signal}`}`);
      resolve(code === 0);
    });
  });
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(500);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}

async function choosePort() {
  if (!await canConnect("127.0.0.1", 3000) && !await canConnect("::1", 3000)) return 3000;
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => port ? resolve(port) : reject(new Error("porta alternativa indisponível")));
    });
  });
}

async function waitForServer(baseUrl, child, logs) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`servidor encerrou prematuramente (${child.exitCode}): ${logs().slice(-1000)}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`timeout aguardando servidor: ${logs().slice(-1000)}`);
}

async function requestCheck(baseUrl, check, cookie) {
  try {
    const response = await fetch(`${baseUrl}${check.path}`, {
      redirect: "manual",
      headers: cookie ? { cookie } : {},
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    const buildFailure = /Internal Server Error|Module not found|Cannot find module|Build Error/i.test(body);
    if (!acceptsStatus(response.status, check.statuses) || buildFailure) {
      record(check.stage, "FAIL", `HTTP ${response.status}${buildFailure ? ", assinatura de erro no corpo" : ""}`);
      return;
    }
    if (check.shape) {
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = null; }
      if (!check.shape(parsed)) {
        record(check.stage, "FAIL", `HTTP ${response.status}, shape inesperado`);
        return;
      }
    }
    record(check.stage, "PASS", `HTTP ${response.status}`);
  } catch (error) {
    record(check.stage, "FAIL", error.message);
  }
}

async function runtimeSmoke() {
  const port = await choosePort();
  if (port !== 3000) record("runtime:porta", "PASS", `porta 3000 ocupada; usando servidor controlado em ${port}`);
  else record("runtime:porta", "PASS", "porta 3000 livre; usando servidor controlado");

  let output = "";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const append = (chunk) => { output = (output + chunk.toString()).slice(-8_000); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(baseUrl, child, () => output);
    record("runtime:start", "PASS", "artefato de produção iniciou");
    const anonymous = [
      { stage: "smoke:health", path: "/api/health", statuses: [200], shape: (v) => v?.ok === true },
      { stage: "smoke:login", path: "/login", statuses: [200] },
      { stage: "smoke:home", path: "/", statuses: [307, 308] },
      { stage: "smoke:integracoes", path: "/integracoes", statuses: [307, 308] },
      { stage: "smoke:api-integracoes", path: "/api/integrations", statuses: [401, 503] },
      { stage: "smoke:shopee-page", path: "/shopee", statuses: [307, 308] },
      { stage: "smoke:shopee-api", path: "/api/integrations/shopee/overview?days=7", statuses: [401, 503] },
      { stage: "smoke:tiktok-page", path: "/tiktok", statuses: [307, 308] },
      { stage: "smoke:tiktok-api", path: "/api/integrations/tiktok/overview?days=7", statuses: [401, 503] },
      { stage: "smoke:tiktok-amostra", path: "/api/tiktok/amostra?dias=1&limite=1", statuses: [401, 503] },
    ];
    for (const check of anonymous) await requestCheck(baseUrl, check);

    const cookie = process.env.SELLERCORE_HEALTH_COOKIE?.trim();
    if (!cookie) {
      record("smoke:authenticated", "BLOCKED", "SELLERCORE_HEALTH_COOKIE ausente; subetapa autenticada somente leitura não executada");
    } else {
      await requestCheck(baseUrl, {
        stage: "smoke:authenticated-integrations",
        path: "/api/integrations",
        statuses: [200],
        shape: (v) => Array.isArray(v?.providers),
      }, cookie);
      record("smoke:authenticated-channels", "BLOCKED", "overviews podem acionar sincronização; não executados pelo gate somente leitura");
    }
  } catch (error) {
    record("runtime:start", "FAIL", error.message);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
}

export async function main() {
  console.log("SellerCore local health gate\n");
  for (const [stage, args] of [
    ["lint", ["run", "lint"]],
    ["typescript", ["exec", "tsc", "--", "--noEmit", "--incremental", "false"]],
    ["tests", ["test"]],
    ["next-build", ["run", "build"]],
  ]) {
    const invocation = npmArgs(args);
    await run(invocation.command, invocation.args, stage);
  }
  await run("git", ["diff", "--check"], "git-diff-check");
  if (results.some((result) => result.stage === "next-build" && result.status === "PASS")) {
    await runtimeSmoke();
  } else {
    record("runtime", "BLOCKED", "build falhou; smoke não pode iniciar artefato real");
  }
  const summary = summarize(results);
  console.log(`\nSUMMARY PASS=${results.filter((r) => r.status === "PASS").length} FAIL=${summary.failed} BLOCKED=${summary.blocked}`);
  process.exitCode = summary.exitCode;
}

if (process.argv[1] && new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1").replaceAll("%20", " ") === process.argv[1].replaceAll("\\", "/")) {
  await main();
}
