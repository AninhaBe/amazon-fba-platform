// Renderiza um HTML em PNG com Chrome headless, no tamanho que a vitrine pedir.
//
// Irmão do `html-para-pdf.mjs` e existe pelo mesmo motivo: peça que tem layout
// próprio nasce como .html versionado e é renderizada por aqui — nunca um PNG
// solto que ninguém sabe refazer. O TikTok já mudou a regra da vitrine uma vez
// (reprovou o Go Live em 31/08/2026 por imagem repetida); quando mudar de novo,
// se reescreve o HTML e se roda isto.
//
//   node scripts/html-para-png.mjs docs/vitrine-tiktok/1-featured.html \
//        G:/sc-temp/vitrine/1-featured.png [largura] [altura]
//
// A dimensão entra por parâmetro DE PROPÓSITO: o console do TikTok ainda não
// declarou a exigida, e a composição foi feita para reescalar sem redesenhar.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find((p) => existsSync(p));
if (!CHROME) {
  console.error("Chrome não encontrado nos caminhos padrão do Windows.");
  process.exit(1);
}

const [entrada, saida, largura = "1600", altura = "900"] = process.argv.slice(2);
if (!entrada || !saida) {
  console.error("uso: node scripts/html-para-png.mjs <entrada.html> <saida.png> [largura] [altura]");
  process.exit(1);
}
if (!existsSync(entrada)) {
  console.error(`Arquivo não encontrado: ${entrada}`);
  process.exit(1);
}
mkdirSync(path.dirname(path.resolve(saida)), { recursive: true });

execFileSync(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  // 2x: a vitrine reescala para baixo, e texto reescalado de 2x continua nítido.
  "--force-device-scale-factor=2",
  `--window-size=${largura},${altura}`,
  `--screenshot=${path.resolve(saida)}`,
  `--user-data-dir=${process.env.TMP || "."}/chrome-vitrine`,
  pathToFileURL(path.resolve(entrada)).href,
], { stdio: "inherit" });

const { size } = statSync(saida);
console.log(`${saida} — ${(size / 1024).toFixed(0)} KB (${largura}x${altura} @2x)`);
