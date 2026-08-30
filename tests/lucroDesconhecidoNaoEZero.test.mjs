import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 30/08/2026 — o lucro dos QUATRO canais passou a descontar o gasto com anuncio.
// Com isso `estimatedProfit` ganhou um estado que ele nao tinha: DESCONHECIDO.
// Quando o sync de Ads nao responde, o gasto nao e zero — e "nao sei" —, e o
// lucro que dependia dele tambem nao e.
//
// O DEFEITO QUE ISTO IMPEDE: `money(null)` escreve "R$ 0,00". Uma tela que diz
// "R$ 0,00 de lucro" quando o certo e "—" nao esta incompleta: ela esta MENTINDO,
// e mente exatamente no periodo em que o Ads falhou, que e quando importa.
//
// ⚠️ ESTE TESTE NAO CONFERE "AS QUATRO TELAS TRATAM NULL" caso a caso. Ele
// PROIBE O IDIOMA que fabrica o zero — para que a quinta superficie, escrita
// amanha por quem nunca leu isto, quebre o portao em vez de nascer mentindo.
// Mesma forma do `estoqueDesconhecidoNaoEZero`.

const TELAS = [
  "src/app/components/MercadoLivreWorkspace.tsx",
  "src/app/components/ShopeeWorkspace.tsx",
  "src/app/components/ShopeeModulePage.tsx",
  "src/app/components/TikTokWorkspace.tsx",
];

/** Quanto texto antes da chamada ainda conta como "a mesma expressao JSX". */
const JANELA = 300;

/**
 * Uma chamada de formatacao de dinheiro sobre o lucro so e legitima se a MESMA
 * expressao ja tiver decidido o caso `null` — seja testando o campo direto, seja
 * por uma guarda que o inclui (`resultIncomplete`/`resultReady`, que nos quatro
 * arquivos carregam `estimatedProfit == null`).
 */
function chamadasDesprotegidas(fonte) {
  const problemas = [];
  // So o LUCRO: `fees`, `cogs` e `revenueProcessed` sao numeros que a fonte
  // sempre informa, e varre-los junto encheria o teste de falso positivo.
  const alvo = /money\(\s*[A-Za-z_$][\w.$?]*estimatedProfit\b/g;
  let achado;
  while ((achado = alvo.exec(fonte)) != null) {
    const antes = fonte.slice(Math.max(0, achado.index - JANELA), achado.index);
    const protegido =
      /estimatedProfit\s*==\s*null/.test(antes) ||
      /profit\s*==\s*null/.test(antes) ||
      /resultIncomplete/.test(antes) ||
      /resultReady/.test(antes);
    if (!protegido) {
      problemas.push(fonte.slice(achado.index, achado.index + 90).split("\n")[0]);
    }
  }
  return problemas;
}

test("lucro desconhecido vira travessao, nunca R$ 0,00 — nas quatro telas", async () => {
  for (const caminho of TELAS) {
    const fonte = await readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
    const problemas = chamadasDesprotegidas(fonte);
    assert.deepEqual(
      problemas,
      [],
      `${caminho}: lucro possivelmente nulo entrando na formatacao de dinheiro — ` +
        `null viraria "R$ 0,00". Guarde com \`estimatedProfit == null ? "—" : ...\`, ` +
        `como o ShopeeWorkspace ja faz.`
    );
  }
});

test("o tipo admite o desconhecido — senao a guarda vira codigo morto", async () => {
  // Sem `number | null` no contrato, o TypeScript garante que a guarda nunca
  // roda, e o defeito volta pela porta do tipo em vez da porta da tela.
  const ml = await readFile(new URL("../src/app/components/MercadoLivreWorkspace.tsx", import.meta.url), "utf8");
  assert.match(ml, /estimatedProfit: number \| null/, "o lucro do ML precisa poder ser desconhecido");
  assert.match(ml, /marginPct: number \| null/, "e a margem que sai dele tambem");
});

test("a guarda de resultado do ML inclui o lucro desconhecido", async () => {
  // `resultIncomplete` e o que troca os rotulos para "Resultado processado" e
  // "Lucro indisponivel". Sem `estimatedProfit == null` nele, a tela mostraria
  // travessao sob um rotulo que promete numero.
  const ml = await readFile(new URL("../src/app/components/MercadoLivreWorkspace.tsx", import.meta.url), "utf8");
  assert.match(ml, /resultIncomplete = resultParcial \|\| overview\.profit\.estimatedProfit == null/);
});
