import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

// OS DOIS DEFEITOS QUE ESTE ARQUIVO REPROVA — achados na varredura de
// 01/09/2026, os dois MENTINDO na tela e nenhum dos dois exigindo um clique.
//
// AGUDA 2 (BriefingLead): o guard que so deixa a narracao sair na janela de 30
// dias lia a URL. Amazon, ML e Shopee chamam useDashboardPeriod() SEM
// argumento e nunca escrevem o periodo na URL, entao `days` era sempre null, o
// fallback dava TRUE e a narracao saia em QUALQUER periodo — com os numeros do
// recorte atual sob a frase fixa "nos ultimos 30 dias". Foi isto que produziu o
// print de 31/08: "nos ultimos 30 dias o faturamento ficou em R$ 0,00" ao lado
// de um card de R$ 36.554,71. Na epoca tratamos como narracao congelada e
// consertamos a persistencia — sintoma verdadeiro, causa errada.
//
// ⚠️ POR QUE NINGUEM VIU: o TikTok SINCRONIZA o periodo na URL, entao la o
// guard sempre funcionou. A mesma correcao estava em quatro telas e so
// funcionava na unica que testava a condicao de verdade. Funcionamento numa
// tela mascarou a falha nas outras tres.
//
// AGUDA 1 (central): o card de Pedidos tinha sub="Ultimos 30 dias" em texto
// fixo, escrito antes de a tela ter seletor. Ela ganhou um em 31/08, com padrao
// Hoje — e passou a mostrar os pedidos de hoje com a legenda de um mes.

test("o guard da narracao NAO le a URL — le o periodo do hook", async () => {
  const lead = await fonte("src/app/components/BriefingLead.tsx");

  // Casar a RAMIFICACAO com a origem do dado, que e o que muda o comportamento.
  assert.match(lead, /const janelaDe30Dias = props\.janela === "days=30";/, "o guard voltou a decidir por outra coisa");
  // ⚠️ E a URL nao pode voltar: era ela a fonte que nunca tinha o dado.
  //
  // Sem comentarios: a explicacao do defeito CITA `useSearchParams()`, e casar
  // o arquivo inteiro reprovava o texto que documenta o conserto. E a regra do
  // AGENTS.md ("casar fonte pega o comentario tambem") pegando quem a escreveu,
  // pela terceira vez em dois dias.
  const codigo = lead.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/useSearchParams/.test(codigo), "a narracao voltou a perguntar o periodo para a URL");

  // A prop e OBRIGATORIA. Como opcional, uma tela que esquecesse de passar
  // cairia em undefined e o guard voltaria a nunca disparar NAQUELA tela — o
  // mesmo defeito, de novo invisivel para quem olha as outras.
  assert.match(lead, /janela: string;/, "a janela sumiu do contrato");
  assert.ok(!/janela\?: string/.test(lead), "a janela virou opcional e o defeito pode voltar numa tela so");
});

test("AS QUATRO telas passam a janela — nao tres", async () => {
  // A licao do defeito: uma tela de fora nao aparece, porque as outras
  // funcionam. Entao o teste cobre as quatro, sempre.
  for (const [tela, esperado] of [
    ["src/app/amazon/page.tsx", /janela=\{period\.query\}/],
    ["src/app/components/TikTokWorkspace.tsx", /janela=\{period\.query\}/],
    ["src/app/components/MercadoLivreWorkspace.tsx", /janela=\{periodoQuery\}/],
    ["src/app/components/ShopeeWorkspace.tsx", /janela=\{periodoQuery\}/],
  ]) {
    const codigo = await fonte(tela);
    const chamada = codigo.slice(codigo.indexOf("<BriefingLead"), codigo.indexOf("<BriefingLead") + 700);
    assert.match(chamada, esperado, `${tela}: a narracao voltou a nao saber o periodo`);
  }
});

test("a query e o MESMO valor que decide o que a tela busca", async () => {
  // Se a narracao olhasse uma copia (um label, um estado proprio), as duas
  // poderiam discordar. `period.query` e o que vai para a API.
  const amazon = await fonte("src/app/amazon/page.tsx");
  assert.match(amazon, /fetch\(`\/api\/amazon\/dashboard\?\$\{[^}]*\}`|periodQuery/, "a Amazon busca por outra coisa que nao a query do hook");
});

test("a central rotula o card de Pedidos com o periodo selecionado", async () => {
  const central = await fonte("src/app/page.tsx");
  assert.match(
    central,
    /<Metric label="Pedidos" value=\{totals\.orders\.toLocaleString\("pt-BR"\)\} sub=\{period\.label\[0\]\.toUpperCase\(\) \+ period\.label\.slice\(1\)\} \/>/,
    "voltou o rotulo fixo no card de Pedidos",
  );
  // ⚠️ E o texto fixo nao pode voltar em lugar nenhum desta tela: ela e a
  // primeira que a vendedora abre.
  assert.ok(!/sub="Últimos 30 dias"/.test(central), "voltou 'Ultimos 30 dias' em texto fixo");
});
