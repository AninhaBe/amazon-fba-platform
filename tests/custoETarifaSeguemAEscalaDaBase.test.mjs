import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ⚠️ A SETIMA FORMA DA FAMILIA "numerador de um universo, subtraendo de outro",
// cobrada pela vendedora em 01/09/2026 as 17:39, tela de Hoje da Silveiras:
//
//   Faturamento R$ 824,64 (31 pedidos, agregado da Sales API — pendentes
//   inclusos) − Taxas e Custo de UM pedido = LUCRO R$ 743,76.
//   Noventa por cento do faturamento. Obviamente falso.
//
// A causa foi a correcao ANTERIOR aplicada com escopo errado. A regra "custo e
// tarifa so existem para o pedido cuja receita existe" nasceu para matar a
// QUINTA forma (base do piso do banco, R$ 12,89, contra custo de 28 pedidos,
// R$ 222,95 — margem de −1692,4%). Mas ela foi escrita POR PEDIDO, e vale POR
// UNIVERSO: quando a base e o faturamento injetado, a receita do pendente JA
// ESTA la dentro, porque o agregado da Amazon o conta. Barrar o custo dele
// entao e subtrair de um universo o que pertence a outro — no sentido oposto.
//
// 📌 E a supressao da margem (sexta forma) ESCONDEU o sintoma: a margem sumiu da
// tela e o lucro ficou exposto sozinho, sem o percentual que denunciaria os 90%.
// Conserto que trata o sintoma pode esconder a proxima forma da mesma causa.
//
// O que estas guardas exigem: UM parametro governa OS DOIS lados. Nao "existe um
// filtro no custo" e "existe um filtro na tarifa" — o mesmo valor nos dois, para
// que seja impossivel corrigir um e esquecer o outro.

const fonte = () =>
  readFile(new URL("../src/lib/integrations/amazonOverviewCanonical.ts", import.meta.url), "utf8");

/** A consulta inteira que contem o marcador, do SELECT ao parenteses que fecha. */
const consultaQueContem = (texto, marcador) => {
  const i = texto.indexOf(marcador);
  assert.ok(i > 0, `marcador ausente: ${marcador}`);
  const inicio = texto.lastIndexOf("SELECT", i);
  let nivel = 0;
  for (let k = inicio; k < texto.length; k += 1) {
    if (texto[k] === "(") nivel += 1;
    else if (texto[k] === ")") { nivel -= 1; if (nivel < 0) return texto.slice(inicio, k); }
  }
  return texto.slice(inicio);
};

test("a base injetada e o que define se custo e tarifa cobrem todos os pedidos", async () => {
  const s = await fonte();
  // A ramificacao, nao o identificador: o flag tem de SAIR da presenca do
  // faturamento injetado. Casar so o nome da variavel passaria com ela
  // recebendo qualquer coisa.
  assert.match(
    s,
    /const baseCobreTodosOsPedidos\s*=\s*\n?\s*opcoes\.faturamentoDoPeriodo != null && opcoes\.faturamentoDoPeriodo > 0;/,
    "o universo tem de ser decidido pela existencia do faturamento injetado",
  );
});

test("o CUSTO cobre todos os pedidos quando a base cobre — e so os valorizados quando nao", async () => {
  const s = await fonte();
  const custo = consultaQueContem(s, "i.sku, i.external_product_id, i.qty, o.occurred_at");
  assert.match(
    custo,
    /AND \(\$6::boolean OR COALESCE\(NULLIF\(o\.gross, 0\), o\.ordered_gross\) IS NOT NULL\)/,
    "sem o OR, o custo do pendente fica fora de uma base que ja o inclui (setima forma)",
  );
  // E o filtro NAO pode simplesmente sumir: sem ele volta a quinta forma.
  assert.match(custo, /COALESCE\(NULLIF\(o\.gross, 0\), o\.ordered_gross\) IS NOT NULL/,
    "apagar o filtro em vez de condiciona-lo traz de volta a margem de -1692,4%");
});

test("a TARIFA usa o MESMO parametro — um flag, dois lados", async () => {
  const s = await fonte();
  // ⚠️ ANCORA NO QUE E UNICO DESTA CONSULTA. `workspace_channel_order_fees_efetivas`
  // aparece ANTES, no LATERAL do detalhado — ancorar nele fatiava a consulta
  // errada e a guarda ficava vermelha com o codigo certo. `pedidos_estimados`
  // so existe na consulta de tarifa do periodo.
  const tarifa = consultaQueContem(s, "AS pedidos_estimados");
  assert.match(
    tarifa,
    /AND \(\$6::boolean OR COALESCE\(NULLIF\(o\.gross, 0\), o\.ordered_gross\) IS NOT NULL\)/,
    "a tarifa tem de acompanhar o mesmo universo que o custo",
  );
});

test("os dois recebem o MESMO valor, nao dois flags independentes", async () => {
  // ⚠️ Esta e a guarda que importa. Dois filtros parecidos com fontes diferentes
  // e como a divergencia volta: alguem corrige um lado e o outro fica.
  const s = await fonte();
  const usos = [...s.matchAll(/baseCobreTodosOsPedidos/g)];
  assert.ok(usos.length >= 3,
    `esperado: a definicao mais um uso em cada consulta; achei ${usos.length}`);
  // ⚠️ OS DOIS PASSARAM A RECEBER A MESMA LISTA DE PARAMETROS EM 01/09/2026.
  // A consulta de custo deixou de filtrar pelo complemento de REVENUE_STATUSES
  // (ela cobre todo pedido nao cancelado do escopo agora, porque virou a UNICA
  // fonte do custo do periodo), entao o parametro da lista saiu e o boolean
  // desceu de $7 para $6. O que a guarda cobra continua sendo o mesmo flag nos
  // dois lados — e agora a forma e literalmente identica, o que e melhor.
  const usosDoFlag = s.match(/scopeParams\(connectionId, period\), baseCobreTodosOsPedidos\]/g) ?? [];
  // ⚠️ PASSARAM A SER TRES EM 02/09/2026, e a mudanca e de fato, nao de rigor:
  // o recorte do ESTORNO virou consulta propria (ele le `posted_at`, que existe
  // na tabela e nao na view — incidente da v238). Ele carrega o MESMO flag
  // porque tem a mesma obrigacao: estorno de pedido fora da base nao pode
  // reduzir um lucro calculado sobre a base. Se o numero mudar de novo, que
  // seja com este teste vermelho e a razao escrita aqui — nunca afrouxando
  // para >= 2, que aceitaria um consumidor esquecendo o flag.
  //
  // ⚠️ PASSARAM A SER QUATRO EM 12/09/2026 (690da5a, lucro por dia): o ESTORNO
  // POR DIA e a quarta consulta com o flag, e a obrigacao e identica a do
  // estorno do periodo — o lucro do DIA sai da mesma base coerente do periodo
  // (o `porPedido`), entao estorno de pedido fora dessa base nao pode derrubar
  // a barra de um dia calculado sobre ela. Este teste ficou VERMELHO na hora,
  // como o paragrafo acima pediu, e a razao esta escrita aqui.
  assert.equal(usosDoFlag.length, 4, "custo, tarifa, estorno do periodo e estorno por dia precisam receber o mesmo flag");
});
