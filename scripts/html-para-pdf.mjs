// Imprime um documento HTML de docs/ em PDF, preservando o layout próprio dele.
//
// Irmão do `md-para-pdf.mjs`, e existe por um motivo específico: o md-para-pdf
// aplica UM template a todos os documentos, e a crítica dela em 23/08/2026 foi
// justamente que "todos os seus PDFs têm o mesmo padrão sem graça". Documento
// que merece layout próprio nasce como .html em docs/ e é impresso por aqui —
// sem .md equivalente, para não haver duas versões divergindo.
//
//   node scripts/html-para-pdf.mjs docs/plano-landing-e-produto.html \
//        "C:/Users/Pichau/Downloads/NEXO-landing-e-o-produto.pdf" --conferir
//
// --conferir gera também um PNG da primeira dobra. Vale a pena: o PDF pode sair
// com fonte de fallback ou quebra de página feia, e isso só aparece olhando.

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find((p) => existsSync(p));

if (!CHROME) {
  console.error("Chrome não encontrado nos caminhos padrão do Windows.");
  process.exit(1);
}

const [entrada, saida] = process.argv.slice(2).filter((a) => !a.startsWith("--"));

if (!entrada || !saida) {
  console.error("Uso: node scripts/html-para-pdf.mjs <entrada.html> <saida.pdf> [--conferir]");
  process.exit(1);
}

const htmlPath = path.resolve(entrada);
if (!existsSync(htmlPath)) {
  console.error(`Arquivo não encontrado: ${htmlPath}`);
  process.exit(1);
}

const url = `file:///${htmlPath.replace(/\\/g, "/")}`;
const pdfPath = path.resolve(saida);

if (process.argv.includes("--conferir")) {
  const png = pdfPath.replace(/\.pdf$/i, "-conferencia.png");
  execFileSync(CHROME, [
    "--headless", "--disable-gpu", "--window-size=1240,1754",
    `--screenshot=${png}`, url,
  ], { stdio: "pipe" });
  console.log(`Conferência visual: ${png}`);
}

execFileSync(CHROME, [
  "--headless",
  "--disable-gpu",
  "--no-pdf-header-footer",
  `--print-to-pdf=${pdfPath}`,
  url,
], { stdio: "pipe" });

const kb = Math.round(statSync(pdfPath).size / 1024);
console.log(`PDF gerado: ${pdfPath} (${kb} KB)`);
