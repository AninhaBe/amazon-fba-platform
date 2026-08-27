import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

// `/amazon` CAIA EM ESTADO DE FALHA NA CONTA DEMO (27/08/2026).
//
// O workspace de demonstração tem conexão `amazon:demo` e pedidos no canônico,
// mas NÃO tem linha em `workspace_accounts` — token sintético não é credencial.
// `withAccountContext` respondia 409 "Conecte uma conta Amazon" ANTES de o
// handler rodar, e a aba inteira quebrava, enquanto a Visão geral — que lê o
// mesmo canônico — mostrava R$ 5.169,20 do mesmo canal.
//
// ⚠️ A trava dos DOIS LADOS: o ramo só existe para "nenhuma credencial", nunca
// para "a credencial não funciona". Conta real com token revogado TEM linha em
// `workspace_accounts`, então `accounts.length > 0` e o fallback não roda.

test("o contrato do withAccountContext: fallback SÓ com zero contas", () => {
  const helper = fonte("src/lib/withAccount.ts");
  // É esta condição que separa demo de conta real com token caído. Se ela
  // afrouxar (ex.: passar a rodar em erro de token), a distinção some.
  assert.match(helper, /accounts\.length === 0 && options\?\.onMissingAccount/);
});

test("o dashboard da Amazon serve o canônico quando não há conta nenhuma", () => {
  const rota = fonte("src/app/api/amazon/dashboard/route.ts");
  assert.match(rota, /onMissingAccount: responder/, "o MESMO handler responde com e sem conta");
  // O corpo não pode passar a exigir conta: os três pontos que tocam a SP-API
  // degradam sozinhos, e é isso que torna o fallback honesto em vez de um mock.
  assert.match(rota, /getDailySales\(period, defaultMarketplaceId\(\)\)\.catch/);
  assert.match(rota, /getStockRadar\(period, canonical\.velocityBySku\)\.catch/);
  assert.match(rota, /conta\?\.refreshToken && sincronizacaoVelha/, "sync sob demanda só com credencial");
});

test("sem cobertura canônica o fallback NÃO inventa zero", () => {
  // Demo sem pedido no período tem de dizer que o sync não cobriu, e não
  // desenhar um painel zerado — é a mesma regra de "tela sem dado".
  const rota = fonte("src/app/api/amazon/dashboard/route.ts");
  assert.match(rota, /O sync ainda não cobriu este período/);
  assert.match(rota, /status: 503/);
});

test("as demais rotas de conta seguem sem fallback, de propósito", () => {
  // Este teste existe para a mudança ser DELIBERADA: quem adicionar
  // `onMissingAccount` noutra rota tem de decidir o que ela serve sem conta.
  // `/api/profit` e `/api/finances` falam com a SP-API no corpo inteiro — servir
  // canônico ali seria trocar a base de dados do número sem dizer.
  for (const rota of ["src/app/api/profit/route.ts", "src/app/api/finances/route.ts"]) {
    assert.doesNotMatch(fonte(rota), /onMissingAccount/, rota);
  }
});
