import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 29/08/2026 — o passo de escrow da Shopee tinha QUATRO defeitos no mesmo laco,
// e o terceiro e o grave:
//
//   1. duas chamadas externas por pedido (escrow + detalhe), 20 por passo,
//      varios passos por tique, a cada 3 minutos, 24h por dia;
//   2. cursor CIRCULAR: ao dar a volta, reperguntava os mesmos pedidos para
//      sempre — inclusive os que a Shopee ainda nao tem como liquidar;
//   3. o cursor e uma POSICAO numa lista FILTRADA que ENCOLHE conforme os
//      pedidos liquidam, entao ele PULA pedidos que nunca chegam a ser
//      perguntados. Buraco no dado financeiro dela, e SILENCIOSO: pedido nunca
//      perguntado nao aparece em lugar nenhum como faltando;
//   4. nenhuma tentativa deixava marca — settlement_attempt_at estava NULO em
//      20.162 de 20.162 pedidos, entao "nao ha escrow" e "nunca perguntamos"
//      eram indistinguiveis.
//
// Medido no dia: 2.809 de 20.162 pedidos com qualquer tarifa registrada (14%).

const fonte = await readFile(new URL("../src/lib/integrations/shopeeSync.ts", import.meta.url), "utf8");
const escrow = fonte.slice(fonte.indexOf("async function syncMissingEscrow"));
// O codigo COMENTA o defeito antigo para explica-lo — entao procurar o padrao
// proibido no texto cru acusaria a propria explicacao. Mesma armadilha que ja
// quebrou dois testes meus hoje.
const semComentario = (trecho) =>
  trecho
    .split("\n")
    .filter((linha) => !/^\s*(\/\/|--|\*|\/\*)/.test(linha))
    .join("\n");

test("a fila do escrow nao tem OFFSET — sem posicao nao ha o que pular", () => {
  const consulta = semComentario(escrow.slice(0, escrow.indexOf("let failed = 0")));
  assert.doesNotMatch(
    consulta,
    // A clausula SQL, nao os identificadores `nextOffset`/`cursorOffset`.
    /OFFSET \$\d/i,
    "OFFSET numa lista que encolhe pula pedido em silencio: o conserto e remover a estrutura, nao vigia-la"
  );
  assert.doesNotMatch(consulta, /cursorOffset % total/, "o cursor circular reperguntava para sempre");
  assert.match(
    consulta,
    /ORDER BY o\.settlement_attempt_at ASC NULLS FIRST/,
    "a fila precisa se ordenar por quem nunca foi perguntado, depois por quem foi ha mais tempo"
  );
});

test("nao repergunta o mesmo pedido antes do intervalo", () => {
  const consulta = semComentario(escrow.slice(0, escrow.indexOf("let failed = 0")));
  assert.match(consulta, /settlement_attempt_at IS NULL/);
  assert.match(consulta, /REPERGUNTA_APOS_DIAS/);
  assert.match(fonte, /const REPERGUNTA_APOS_DIAS = Number\(process\.env\.SHOPEE_REPERGUNTA_ESCROW_DIAS \|\| 7\)/);
});

test("TODA tentativa deixa marca, inclusive a que volta vazia", () => {
  // Sem marca nao existe diferenca entre "nao ha" e "nao perguntei", e o sistema
  // le ausencia de marca como ausencia de fato. Mesmo defeito do zero fabricado.
  for (const desfecho of ["tentado", "sem_escrow", "sem_detalhe", "liquidado", "falhou"]) {
    assert.match(
      escrow,
      new RegExp(`marcarTentativaDeEscrow\\([^)]*"${desfecho}"`),
      `o desfecho "${desfecho}" nao deixa marca`
    );
  }
  // A marca vem ANTES da chamada: se ela falhar no meio, o pedido nao pode
  // voltar a fila na passagem seguinte.
  const antesDaChamada = escrow.indexOf('marcarTentativaDeEscrow(connection.id, row.external_order_id, "tentado")');
  const primeiraChamada = escrow.indexOf("getShopeeEscrowDetail");
  assert.ok(antesDaChamada > -1 && antesDaChamada < primeiraChamada, "a marca precisa preceder a chamada externa");
});

test("nao busca o detalhe que ja esta no banco — era metade das chamadas do passo", () => {
  assert.match(escrow, /const guardado = detalheGuardado\(row\.raw\)/);
  assert.match(fonte, /function detalheGuardado/);
  // So vale se for MESMO um detalhe: sem essa checagem trocariamos uma chamada a
  // menos por um dado a menos, que e o pior dos dois.
  const guardado = fonte.slice(fonte.indexOf("function detalheGuardado"));
  assert.match(guardado.slice(0, 500), /item_list/);
});

test("a tela conta tarifa, nao 'processado' — e nao atribui culpa", async () => {
  const tela = await readFile(new URL("../src/app/components/ShopeeWorkspace.tsx", import.meta.url), "utf8");
  // A conta anterior era paidOrders - processedOrders: os dois valiam 9.849 na
  // loja real, dava zero, e a tela caia numa frase SEM NUMERO.
  assert.doesNotMatch(tela, /profitCoverage\.paidOrders - profitCoverage\.processedOrders/);
  assert.match(tela, /profitCoverage\.processedOrders - profitCoverage\.ordersWithFees/);
  // A frase anterior dizia "a Shopee ainda nao postou" — atribuia a causa ao
  // fornecedor dela quando boa parte e nossa. Enquanto o carimbo nao tiver
  // historico, NAO HA COMO SABER de quem e a espera.
  assert.doesNotMatch(tela, /A Shopee ainda não postou o extrato/);
  assert.match(tela, /sem a tarifa da Shopee registrada/);
});

test("conciliacao roda mesmo com o sync 'complete' — sucesso de uma etapa nao pode parar outra", () => {
  // 29/08/2026, a segunda causa. O lease normal exige `status <> 'complete'`.
  // Quando os pedidos alcancaram o presente e a linha virou 'complete', o passo
  // inteiro passou a retornar em ZERO SEGUNDO e o escrow — que roda no fim dele
  // — deixou de existir, com 17 mil pedidos na fila e NENHUM erro em lugar
  // nenhum. Nao parou a Shopee: paramos nos, porque terminamos outra coisa.
  //
  // A mesma linha de status serve trabalhos de naturezas diferentes: a ingestao
  // TERMINA, a conciliacao financeira NAO. Um trabalho que acaba silenciou um
  // que nunca acaba.
  const claim = fonte.slice(fonte.indexOf("const conciliacao = await dbQuery"));
  assert.ok(claim.length > 0, "sem claim proprio, a conciliacao volta a depender do ciclo de ingestao");
  const consulta = claim.slice(0, claim.indexOf("RETURNING"));
  assert.match(consulta, /s\.status = 'complete'/, "o claim existe justamente para o caso 'complete'");
  assert.match(consulta, /EXISTS \(/, "so pega o lease se houver fila — senao vira lease a toa a cada ciclo");
  assert.match(consulta, /settlement_attempt_at IS NULL/, "a fila do claim tem que ser a MESMA do passo");
  // O claim nao pode marcar o sync como 'error': a ingestao esta completa e
  // correta, e falha de conciliacao nao pode contaminar o estado dela.
  const corpo = claim.slice(0, claim.indexOf("const leased = await dbQuery"));
  assert.doesNotMatch(corpo, /status = 'error'/);
  assert.match(corpo, /lease_until = NULL/, "o lease precisa ser devolvido mesmo em falha");
});
