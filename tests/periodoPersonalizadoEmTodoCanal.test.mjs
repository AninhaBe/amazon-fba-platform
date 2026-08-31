import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

// O DEFEITO (achado pela Vitrine em 31/08/2026, na Shopee).
//
// A tela ja oferecia "Personalizado" e mandava `from`/`to`. A rota lia SO
// `days`, caia no `|| "30"` e devolvia TRINTA DIAS — com o rotulo do periodo que
// a pessoa escolheu. Numero de uma janela com etiqueta de outra, sem erro em
// lugar nenhum.
//
// ⚠️ E a pior forma do defeito, porque a tela PARECE certa: nao ha travessao, nao
// ha aviso, nao ha log. E a mesma familia do dia inteiro (anuncio, tarifa,
// faturamento, imposto, narracao): dois lados discordando sobre qual periodo e,
// e o silencio no meio.
//
// ⚠️ AS ROTAS DE ABC NAO ENTRAM, E ISSO E MEDIDO, NAO ESQUECIDO. Elas tambem
// leem so `days` — mas as telas de ABC nao oferecem seletor e nao mandam
// `from`/`to`, entao ali e latente, nao sangrando. No dia em que ganharem o
// seletor, entram nesta lista sozinhas (a descoberta abaixo e por diretorio).

const raiz = (caminho) => new URL(`../${caminho}`, import.meta.url);
const fonte = (caminho) => readFile(raiz(caminho), "utf8");

async function rotasDeOverview(dir = "src/app/api") {
  const achadas = [];
  for (const entrada of await readdir(raiz(dir), { withFileTypes: true })) {
    const caminho = `${dir}/${entrada.name}`;
    if (entrada.isDirectory()) achadas.push(...(await rotasDeOverview(caminho)));
    else if (entrada.name === "route.ts" && /\/(overview|dashboard)\/route\.ts$/.test(caminho)) {
      achadas.push(caminho);
    }
  }
  return achadas;
}

test("toda rota de dashboard/overview que aceita `days` tambem aceita `from`/`to`", async () => {
  const rotas = await rotasDeOverview();
  assert.ok(rotas.length >= 3, `descoberta quebrou: achou ${rotas.length} rota(s)`);

  for (const caminho of rotas) {
    const src = await fonte(caminho);
    const leDays = /searchParams\.get\("days"\)/.test(src) || /resolvePeriod/.test(src);
    if (!leDays) continue;
    // `resolvePeriod` ja trata from/to por dentro (src/lib/period.ts) — quem o
    // usa esta coberto sem repetir o parsing.
    if (/resolvePeriod/.test(src)) continue;
    assert.match(
      src,
      /searchParams\.get\("from"\)/,
      `${caminho} lê \`days\` e ignora \`from\`/\`to\`: o Personalizado da tela vira 30 dias em silêncio`,
    );
    assert.match(
      src,
      /searchParams\.get\("to"\)/,
      `${caminho} lê \`from\` e não lê \`to\` — meia janela é pior que nenhuma`,
    );
    // ⚠️ LER NAO E USAR, e este teste ja falhou nisso.
    //
    // A primeira versao so exigia que a string `searchParams.get("from")`
    // existisse. Na prova negativa eu apaguei o BLOCO que usa o valor e deixei a
    // leitura da variavel — e o teste continuou verde. E o mesmo defeito de
    // "o teste garantiu a frase, nao a leitura", agora na propria suite: um
    // teste que casa a existencia de um simbolo nao prova comportamento nenhum.
    assert.match(
      src,
      /if \(fromValue \|\| toValue\)/,
      `${caminho} lê \`from\`/\`to\` e não RAMIFICA neles: o valor chega e é ignorado`,
    );
  }
});

test("uma data so e RECUSADA, nunca completada por conta propria", async () => {
  // Inventar a outra ponta seria devolver um periodo que ninguem pediu, que e o
  // mesmo defeito com outra roupa.
  for (const caminho of await rotasDeOverview()) {
    const src = await fonte(caminho);
    if (!/searchParams\.get\("from"\)/.test(src)) continue;
    assert.match(
      src,
      /if \(!fromValue \|\| !toValue/,
      `${caminho} precisa recusar periodo com uma data so`,
    );
  }
});

test("o contrato do personalizado e O MESMO nos canais — divergir cria a proxima diferenca", async () => {
  // Mensagens e limites copiados entre canais de proposito. Se um aceitar 365
  // dias e outro 90, a proxima pergunta dela vai ser por que o mesmo filtro
  // responde coisas diferentes em telas diferentes.
  const comPersonalizado = [];
  for (const caminho of await rotasDeOverview()) {
    const src = await fonte(caminho);
    if (/searchParams\.get\("from"\)/.test(src)) comPersonalizado.push({ caminho, src });
  }
  assert.ok(comPersonalizado.length >= 2, "esperava ao menos dois canais com personalizado");
  for (const { caminho, src } of comPersonalizado) {
    assert.match(src, /365 \* DAY/, `${caminho} diverge no teto de 365 dias`);
    assert.match(src, /O período personalizado é inválido\./, `${caminho} diverge na mensagem de período inválido`);
  }
});
