import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A legenda do gráfico é a MESMA nos canais.
//
// Ela nasceu dentro da página da Amazon e o Mercado Livre ficou sem: a tela do
// ML mostrava só "R$ 2.247,76 no período", sem dizer quantos pedidos foram
// confirmados, quantos aguardam pagamento e quantos foram cancelados. Cobrado
// por ela em 24/08/2026, comparando as duas telas lado a lado.

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

// OS QUATRO. Equalizar dois e esquecer dois é o mesmo defeito mudado de lugar —
// foi o que ela cobrou em 24/08/2026: "você tá pecando na regra de deixar os
// marketplaces atualizados".
const TELAS = [
  ["src/app/(app)/amazon/page.tsx", "Amazon"],
  // ⚠️ O ML SAIU DESTA LISTA em 07/09/2026 porque o BLOCO saiu: o
  // canvas do Caminho do Dinheiro cortou o corpo antigo do dashboard. A
  // regra continua valendo para os outros canais, e volta a valer para o ML
  // no dia em que ele tiver um bloco que precise dela.
  ["src/app/components/ShopeeWorkspace.tsx", "Shopee"],
  ["src/app/components/TikTokWorkspace.tsx", "TikTok Shop"],
];

test("os dois canais usam o mesmo componente de legenda", () => {
  for (const [caminho, canal] of TELAS) {
    const s = fonte(caminho);
    assert.match(s, /<LegendaDeVendas/, `${canal} não usa a legenda compartilhada`);
    assert.doesNotMatch(
      s,
      /className="sales-split"/,
      `${canal} voltou a montar a legenda por conta — o markup mora no componente`
    );
  }
});

test("cada canal explica a PROPRIA regra de quando o dinheiro entra", () => {
  const notas = TELAS.map(([caminho, canal]) => {
    const nota = (fonte(caminho).match(/nota="([^"]+)"/) ?? [])[1];
    assert.ok(nota, `${canal} não explica a regra do próprio marketplace`);
    return nota;
  });
  // Nota genérica seria pior que nota nenhuma: cada marketplace tem regra
  // própria, e uma frase que serve para todos não ensina nada sobre nenhum.
  assert.equal(new Set(notas).size, notas.length, "dois canais estão repetindo a mesma explicação");
});

test("cancelado entra por quantidade, nunca por valor", () => {
  const componente = fonte("src/app/components/LegendaDeVendas.tsx");
  assert.match(componente, /cancelados\?:\s*\{\s*pedidos:\s*number\s*\}/);
  for (const [caminho, canal] of TELAS) {
    const s = fonte(caminho);
    const chamada = s.slice(s.indexOf("<LegendaDeVendas"), s.indexOf("<LegendaDeVendas") + 700);
    assert.doesNotMatch(
      chamada,
      /cancelados=\{\{[^}]*valor/,
      `${canal} passou valor de cancelado — na Amazon isso é estimativa nossa`
    );
  }
});

test("a legenda aparece quando ha pedido, mesmo sem pendente", () => {
  const componente = fonte("src/app/components/LegendaDeVendas.tsx");
  // A condição de sumir tem que exigir os TRÊS zerados. Quando dependia só de
  // "aguardando > 0", o filtro Hoje — com o único pedido já confirmado — fazia
  // a linha inteira desaparecer (23/08/2026).
  assert.match(
    componente,
    /confirmados\.pedidos <= 0 && pedidosAguardando <= 0 && pedidosCancelados <= 0/
  );
});

// ⚠️ ESTE TESTE SE CHAMAVA "as mesmas TRES abas nos dois
// canais" e exigia a de Composicao nos dois. A intencao mudou em 10/09/2026,
// por decisao dela: tirar aquela aba do ML e por a rentabilidade no lugar.
//
// O MOTIVO, medido antes de propor: das sete linhas daquela aba no ML, duas ja
// apareciam na faixa a 20px dali (Total recebido e Margem, como "Resultado
// processado") e quatro na faixa do dashboard. So uma era exclusiva.
//
// ⚠️ A AMAZON CONTINUA COM AS TRES, e a divergencia e
// DELIBERADA, nao esquecimento — ninguem mediu a duplicata la, e a regra da
// casa e que replicar entre canais e reimplementar, nunca copiar. Se a mesma
// medicao for feita na Amazon e der o mesmo resultado, este teste muda de novo;
// ate la, ele guarda o que os dois canais REALMENTE tem em comum.
test("as duas abas comuns aos dois monitores continuam de pé", () => {
  const amazon = fonte("src/app/(app)/monitor/page.tsx");
  const ml = fonte("src/app/components/MercadoLivreWorkspace.tsx");
  // "Transações" faltava no ML: o extrato do Mercado Pago existia só no card do
  // dashboard, e quem abria o monitor não achava onde ver quando o dinheiro cai.
  for (const aba of ["Transações", "Rentabilidade por venda"]) {
    assert.ok(amazon.includes(aba), `Amazon perdeu a aba "${aba}"`);
    assert.ok(ml.includes(aba), `Mercado Livre perdeu a aba "${aba}"`);
  }
});

test("a aba de Composição não volta ao monitor do ML — nem na tela, nem no tipo", () => {
  const ml = fonte("src/app/components/MercadoLivreWorkspace.tsx");
  // ⚠️ SEM COMENTARIOS: a explicacao da remocao, no proprio
  // arquivo, CITA o rotulo e o valor proibidos — casar o texto cru reprovaria a
  // documentacao do conserto. E a armadilha que o AGENTS.md nomeia e que ja
  // pegou quatro vezes neste projeto em dois dias.
  const codigo = ml.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!codigo.includes("Composi"), "a aba de Composição voltou para o monitor do ML");
  // O valor sai do TIPO junto com a aba: deixado la, um `?secao=composition`
  // antigo cairia numa aba em branco em vez de cair no padrao.
  assert.ok(!codigo.includes("composition"), "o valor composition voltou ao tipo da seção");
});
