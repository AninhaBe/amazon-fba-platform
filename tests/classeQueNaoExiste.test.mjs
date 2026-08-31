import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// CLASSE QUE NAO EXISTE NAO DA ERRO — ELA SIMPLESMENTE NAO FAZ NADA.
//
// 31/08/2026: a aba de Ads abria com `<div className="dashboard-shell">`, uma
// classe inventada que nunca existiu no CSS. Nada quebrou, nada avisou. O efeito
// era a pagina ficar sem o `min-width: 0` da raiz do frame — e a fileira de
// canais transbordava, cortando o quarto card. Aparecia a 1425px e sumia a
// 1900px: o tipo de defeito que passa na revisao de quem tem monitor grande e
// aparece na tela do cliente.
//
// Este teste reprova classe USADA e NAO DEFINIDA. Ele nao julga estilo; julga
// existencia — que e o unico erro dessa familia que da para pegar de graca.

const TAILWIND =
  /[:[]|^!|^(group|contents|truncate|underline|italic|uppercase|lowercase|capitalize|hidden|block|inline(-\w+)?|flex|grid|table|static|fixed|absolute|relative|sticky|isolate|antialiased|sr-only|container|border|rounded|shadow|ring|outline-none)$|^-?(m|mx|my|mt|mb|ml|mr|p|px|py|pt|pb|pl|pr|w|h|min|max|gap|space|inset|top|left|right|bottom|z|text|bg|border|rounded|shadow|ring|opacity|font|leading|tracking|align|justify|items|self|content|place|col|row|order|basis|grow|shrink|flex|grid|object|overflow|whitespace|break|cursor|select|pointer|list|divide|transition|duration|delay|ease|animate|scale|rotate|translate|skew|origin|backdrop|blur|from|via|to|fill|stroke|aspect|columns|float|clear|resize|scroll|snap|touch|will|accent|caret|decoration|indent|line|size|underline|table)-/;

/**
 * CLASSES SEM ESTILO, DE PROPOSITO — a allowlist.
 *
 * Cada uma aqui e um gancho semantico (teste, script, seletor de leitura) que
 * nunca teve regra no CSS. Elas foram inventariadas em 31/08/2026, quando o
 * teste nasceu; a lista existe para que as ATUAIS nao travem o portao e para que
 * a PROXIMA classe orfa quebre.
 *
 * ⚠️ Acrescentar aqui e uma decisao, nao um reflexo: se a classe deveria estilar
 * algo, o conserto e no CSS (ou usar a classe certa), nao nesta lista.
 *
 * ⚠️ AS 24 DA PRIMEIRA LEVA NAO FORAM VERIFICADAS UMA A UMA. Elas entraram para
 * o teste poder nascer verde e passar a guardar o futuro; a triagem de quais
 * sao gancho semantico legitimo e quais sao `dashboard-shell` esperando
 * acontecer esta com o cerebro. Quem confirmar uma, troque a linha por um
 * comentario dizendo o que ela ancora.
 */
const SEM_ESTILO_POR_DECISAO = new Set([
  "amazon-listings-page",
  "abc-page",
  "empty-state-action",
  "link-button",
  "marketplace-app-sellercore",
  "rail-nav",
  "revenue-empty-label",
  "channel-module-saude",
  "shopee-saude-nota",
  "shopee-dashboard-page",
  "tiktok-dashboard-page",
  "performance-page",
  "performance-table-shell",
  "auth-flow-packets",
  "meli-listings-page",
  "meli-calculator-page",
  "product-table-shell",
  "product-identity",
  "overview-page",
  "central-channel-section",
  "research-workspace",
  "research-results-shell",
  "research-table",
  "audit-pending-reasons",
]);

async function arquivosDe(raiz) {
  const encontrados = [];
  async function varrer(dir) {
    for (const entrada of await readdir(dir, { withFileTypes: true })) {
      const alvo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) await varrer(alvo);
      else if (/\.(tsx|css)$/.test(entrada.name)) encontrados.push(alvo);
    }
  }
  await varrer(raiz);
  return encontrados;
}

test("nenhuma tela usa classe que nao existe no CSS", async () => {
  const arquivos = await arquivosDe("src");

  const definidas = new Set();
  for (const arquivo of arquivos.filter((f) => f.endsWith(".css"))) {
    for (const achado of (await readFile(arquivo, "utf8")).matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
      definidas.add(achado[1]);
    }
  }

  const orfas = [];
  for (const arquivo of arquivos.filter((f) => f.endsWith(".tsx"))) {
    // Comentario nao renderiza: sem tirar, a NOTA que explica o defeito
    // ("eu tinha escrito className='dashboard-shell'") reprovaria o conserto.
    const fonte = (await readFile(arquivo, "utf8"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const achado of fonte.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      // `${...}` vira espaco: o pedaco que sobra ("is-", "channel-") e fragmento
      // de template, nao classe — por isso os terminados em "-" saem fora.
      const texto = (achado[1] ?? achado[2] ?? "").replace(/\$\{[^}]*\}/g, " ");
      for (const classe of texto.split(/\s+/).filter(Boolean)) {
        if (classe.endsWith("-") || definidas.has(classe)) continue;
        if (TAILWIND.test(classe) || SEM_ESTILO_POR_DECISAO.has(classe)) continue;
        orfas.push(`${classe} (${arquivo})`);
      }
    }
  }

  assert.deepEqual(
    orfas,
    [],
    "classe usada e nunca definida: ou o CSS falta, ou a classe certa e outra, ou ela e gancho " +
      "semantico — e nesse caso entra em SEM_ESTILO_POR_DECISAO com o motivo"
  );
});
