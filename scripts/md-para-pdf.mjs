// Converte um .md do repo em PDF, no mesmo estilo de impressão do
// docs/amazon-ads-especialista.html (A4, tabelas que não quebram no meio).
//
//   node scripts/md-para-pdf.mjs docs/arquivo.md [saida.pdf]
//
// Usa o Chrome instalado em modo headless para imprimir. Não instala nada.
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

// Só os argumentos posicionais; flags (--conferir) não podem virar caminho.
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const entrada = args[0];
if (!entrada || !existsSync(entrada)) {
  console.error("Uso: node scripts/md-para-pdf.mjs <arquivo.md> [saida.pdf] [--conferir]");
  process.exit(1);
}
const saida = args[1] ?? entrada.replace(/\.md$/, ".pdf");

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find(existsSync);
if (!CHROME) {
  console.error("Chrome não encontrado — necessário para gerar o PDF.");
  process.exit(1);
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Formatação dentro da linha. Ordem importa: código primeiro, para o conteúdo
// dele não ser reinterpretado como negrito ou link.
function inline(txt) {
  const codigos = [];
  let s = esc(txt).replace(/`([^`]+)`/g, (_, c) => `\u0000${codigos.push(c) - 1}\u0000`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codigos[+i]}</code>`);
}

const linhas = readFileSync(entrada, "utf8").split(/\r?\n/);
const out = [];
let i = 0;
let lista = null; // "ul" | "ol"

const fechaLista = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };

while (i < linhas.length) {
  const l = linhas[i];

  if (l.startsWith("```")) {                                   // bloco de código
    fechaLista();
    const buf = [];
    i++;
    while (i < linhas.length && !linhas[i].startsWith("```")) buf.push(linhas[i++]);
    i++;
    out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
    continue;
  }

  if (/^\|/.test(l) && /^\|[\s:|-]+\|?$/.test(linhas[i + 1] ?? "")) {  // tabela
    fechaLista();
    const celulas = (linha) => linha.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const cab = celulas(l);
    i += 2;
    const corpo = [];
    while (i < linhas.length && /^\|/.test(linhas[i])) corpo.push(celulas(linhas[i++]));
    // Cabeçalho vazio (`| | |`) é usado no repo para tabela de duas colunas sem
    // título. Renderizar o <thead> nesse caso vira uma barra preta sem texto.
    const temCabecalho = cab.some((c) => c !== "");
    out.push(
      `<table>` +
      (temCabecalho ? `<thead><tr>${cab.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` : "") +
      `<tbody>` +
      corpo.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") +
      `</tbody></table>`
    );
    continue;
  }

  const h = l.match(/^(#{1,4})\s+(.*)$/);
  if (h) { fechaLista(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }

  if (/^\s*>\s?/.test(l)) {                                    // citação
    fechaLista();
    const buf = [];
    while (i < linhas.length && /^\s*>\s?/.test(linhas[i])) buf.push(linhas[i++].replace(/^\s*>\s?/, ""));
    out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
    continue;
  }

  if (/^(-{3,}|\*{3,})$/.test(l.trim())) { fechaLista(); out.push("<hr>"); i++; continue; }

  const li = l.match(/^\s*[-*]\s+(.*)$/);
  const oli = l.match(/^\s*\d+\.\s+(.*)$/);
  if (li || oli) {
    const tipo = li ? "ul" : "ol";
    if (lista !== tipo) { fechaLista(); out.push(`<${tipo}>`); lista = tipo; }
    out.push(`<li>${inline((li ?? oli)[1])}</li>`);
    i++;
    continue;
  }

  if (!l.trim()) { fechaLista(); i++; continue; }

  fechaLista();
  const buf = [l];
  i++;
  while (i < linhas.length && linhas[i].trim() && !/^(#|\||>|```|-{3,}|\s*[-*]\s|\s*\d+\.\s)/.test(linhas[i])) buf.push(linhas[i++]);
  out.push(`<p>${inline(buf.join(" "))}</p>`);
}
fechaLista();

const titulo = (readFileSync(entrada, "utf8").match(/^#\s+(.*)$/m) ?? [, path.basename(entrada)])[1];

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
@page { size: A4; margin: 16mm 14mm 18mm; }
body { font-family: "Segoe UI", Calibri, system-ui, sans-serif; font-size: 10pt; line-height: 1.55; color: #16181d; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { font-size: 22pt; line-height: 1.15; margin: 0 0 4px; letter-spacing: -.4px; }
h2 { font-size: 14pt; margin: 26px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #16181d; page-break-after: avoid; }
h3 { font-size: 11.2pt; margin: 18px 0 5px; color: #0d5c73; page-break-after: avoid; }
h4 { font-size: 10.2pt; margin: 13px 0 4px; page-break-after: avoid; }
p { margin: 0 0 8px; }
ul, ol { margin: 0 0 9px; padding-left: 19px; }
li { margin-bottom: 3px; }
strong { font-weight: 600; }
code { font-family: Consolas, "Courier New", monospace; font-size: 8.8pt; background: #f4f6f9; padding: 1px 4px; border-radius: 3px; }
pre { background: #16181d; color: #e8ecf2; padding: 10px 13px; margin: 9px 0; font-size: 8.6pt; line-height: 1.6; white-space: pre-wrap; page-break-inside: avoid; border-radius: 3px; }
pre code { background: none; color: inherit; padding: 0; font-size: inherit; }
table { width: 100%; border-collapse: collapse; margin: 9px 0 13px; font-size: 8.8pt; page-break-inside: avoid; }
th { background: #16181d; color: #fff; text-align: left; padding: 5px 7px; font-weight: 600; }
td { padding: 4px 7px; border-bottom: 1px solid #d8dce4; vertical-align: top; }
tr:nth-child(even) td { background: #fafbfd; }
blockquote { background: #f4f6f9; border-left: 3px solid #0d5c73; padding: 8px 12px; margin: 10px 0; page-break-inside: avoid; }
hr { border: 0; border-top: 1px solid #d8dce4; margin: 18px 0; }
a { color: #0d5c73; }
</style></head><body>${out.join("\n")}</body></html>`;

const dir = mkdtempSync(path.join(tmpdir(), "mdpdf-"));
const htmlPath = path.join(dir, "doc.html");
writeFileSync(htmlPath, html, "utf8");

// `--conferir` gera também um PNG da primeira dobra, para inspecionar o resultado
// sem depender de visualizador de PDF.
if (process.argv.includes("--conferir")) {
  const png = path.resolve(saida.replace(/\.pdf$/, "-conferencia.png"));
  execFileSync(CHROME, [
    "--headless", "--disable-gpu", "--window-size=1240,1754",
    `--screenshot=${png}`, `file:///${htmlPath.replace(/\\/g, "/")}`,
  ], { stdio: "pipe" });
  console.log(`Conferência visual: ${png}`);
}

execFileSync(CHROME, [
  "--headless",
  "--disable-gpu",
  "--no-pdf-header-footer",
  `--print-to-pdf=${path.resolve(saida)}`,
  `file:///${htmlPath.replace(/\\/g, "/")}`,
], { stdio: "pipe" });

console.log(`PDF gerado: ${saida}`);
