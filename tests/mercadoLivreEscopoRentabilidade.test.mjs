import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Monitor Unificado, E1 (28/08/2026): o teto de 1000 pedidos detalhados do ML
// passa a ser comunicado na tabela de rentabilidade — mesma frase da referência
// Amazon. Antes, a lista cortava em silêncio.

test("o canonico expoe o escopo do detalhamento amarrado ao teto real", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/mercadoLivreOverviewCanonical.ts", import.meta.url), "utf8");
  // ⚠️ A FORMA MUDOU EM 13/09/2026 (previa do dashboard) e este teste ficou
  // VERMELHO na hora, como devia — a razao escrita aqui: o escopo passou a ter
  // DUAS fontes com a MESMA verdade — o caminho completo segue contando
  // linesByOrder.size; a previa (que so busca os pedidos das 5 linhas) conta
  // pelo COUNT do conjunto inteiro (escopoRows), porque a frase "Exibindo os N
  // mais recentes" e o unico aviso do recorte e refletir 5 seria mentir.
  // A intencao original — escopo amarrado ao teto REAL — continua exigida:
  assert.match(fonte, /const pedidosDetalhados = detalhe === "previa"\s*\? \(escopoRows\?\.\[0\]\?\.pedidos_detalhados \?\? 0\)\s*: linesByOrder\.size;/);
  assert.match(fonte, /detailedOrders: pedidosDetalhados,\s*completePeriod: pedidosDetalhados < DETAILED_ORDER_LIMIT,/);
  // O teto continua o da referência; mudou o teto, muda a comunicação junto.
  assert.match(fonte, /const DETAILED_ORDER_LIMIT = 1_000/);
});

test("o caminho legado declara que nao conhece o teto — null, nunca um escopo inventado", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/mercadoLivre.ts", import.meta.url), "utf8");
  assert.match(fonte, /profitabilityScope: null as MercadoLivreProfitabilityScope \| null/);
});

test("dashboard e monitor do ML passam a frase de escopo, e ela diz o que exibe sem se desculpar", async () => {
  const fonte = await readFile(new URL("../src/app/components/MercadoLivreWorkspace.tsx", import.meta.url), "utf8");
  // ⚠️ ERAM DOIS PONTOS DE USO ATE 07/09/2026: o dashboard e o
  // monitor. O canvas do Caminho do Dinheiro trocou a tabela do dashboard
  // pelo card `TabelaDeVendas`, que recebe a MESMA frase pela prop `escopo`.
  // Sobrou UM `scopeNote` — o do monitor —, e a frase continua nos dois
  // lugares, com nomes diferentes.
  const chamadas = fonte.match(/scopeNote=\{fraseDeEscopo\(overview\.profitabilityScope\)\}/g) ?? [];
  assert.equal(chamadas.length, 1, "o monitor — o dashboard passa a mesma frase por `escopo`");
  // ⚠️ A PROP MUDOU DE NOME E DE DONO EM 11/09/2026, e a exigencia
  // nao: era `escopo={...}` no card `TabelaDeVendas`, que o v3 substituiu. Hoje
  // a lista recortada e o card "Pedidos" do `PainelV3Baixo`, e a frase entra
  // pelo campo `escopo` do contrato.
  //
  // ⚠️ E ELA TINHA SE PERDIDO NA TROCA: entre 09 e 11/09 o card
  // mostrava cinco linhas debaixo de totais de centenas de pedidos, sem nada
  // dizendo que era um recorte. Nada ficou vermelho — a guarda apontava para o
  // card que nao existia mais, entao reprovava por endereco, nao por conteudo.
  assert.match(fonte, /escopo: fraseDeEscopo\(overview\.profitabilityScope\),/,
    "o card de Pedidos do dashboard parou de receber a frase de escopo");
  // E o painel EXIBE a frase — passar sem desenhar seria o mesmo que nao passar.
  const painel = await readFile(new URL("../src/app/components/PainelV3Baixo.tsx", import.meta.url), "utf8");
  assert.ok(
    painel.includes('{dados.revisar.escopo ? <p className="v3-nota">{dados.revisar.escopo}</p> : null}'),
    "a frase de escopo deixou de ser desenhada no card de Pedidos",
  );
  // Período completo = sem frase (o texto padrão da tabela serve).
  assert.match(fonte, /if \(!scope \|\| scope\.completePeriod\) return undefined/);
  assert.match(fonte, /Exibindo os \$\{scope\.detailedOrders\} pedidos mais recentes\. Os totais financeiros acima consideram o período completo\./);
  // Regra da casa: nada de "parcial"/"incompleto" se desculpando na tela.
  assert.doesNotMatch(fonte, /fraseDeEscopo[^}]*parcial/i);
});
