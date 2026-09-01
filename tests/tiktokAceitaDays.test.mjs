import test from "node:test";
import assert from "node:assert/strict";
import { periodRequest, TiktokModuleError } from "../src/lib/integrations/tiktokModuleContract.ts";

// ═══ O DEFEITO QUE ESTE ARQUIVO REPROVA ═════════════════════════════════════
//
// As rotas de módulo do TikTok exigiam `from`/`to` e RECUSAVAM `days`. Como a
// rota exigia data, a conversão de preset para data foi parar no CLIENTE — e lá
// ela usava `toISOString()`, que é UTC.
//
// Consequência medida: das 21h à meia-noite de Brasília — 13% de TODO DIA,
// todos os dias — o "hoje" do cliente já era o dia seguinte em UTC. A janela ia
// para o FUTURO e a aba do TikTok aparecia VAZIA à noite e normal de manhã.
//
// A correção de raiz é esta: o preset é resolvido no SERVIDOR, em dia-calendário
// de Brasília, e o cliente não converte nada. Conversão que não existe não erra
// de fuso.

const q = (s) => new URLSearchParams(s);
const brt = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);

test("aceita o preset `days=today` — era ele que a rota recusava", () => {
  // ⚠️ COM O CÓDIGO ANTIGO ISTO LANÇAVA `INVALID_PERIOD`. É a asserção que
  // reprova a volta da exigência de from/to.
  const p = periodRequest(q("days=today"));
  assert.equal(p.label, "Hoje");
  assert.equal(brt(p.from), brt(new Date()), "o início tem de ser HOJE no fuso de Brasília");
});

test("sem parâmetro nenhum, o padrão é Hoje — o mesmo dos quatro dashboards", () => {
  // Dois padrões em dois lugares divergem; é só questão de quando. Já aconteceu
  // neste projeto com o `|| "30"` do servidor contra o "Hoje" da tela.
  assert.equal(periodRequest(q("")).label, "Hoje");
});

test("os presets são os mesmos dos outros canais, e nada além deles", () => {
  for (const dias of [7, 15, 30]) {
    assert.equal(periodRequest(q(`days=${dias}`)).label, `Últimos ${dias} dias`);
  }
  // Preset inventado é recusado, e com a mensagem que diz o que fazer.
  assert.throws(() => periodRequest(q("days=45")), (erro) => {
    assert.ok(erro instanceof TiktokModuleError);
    assert.equal(erro.code, "INVALID_PERIOD");
    assert.match(erro.message, /Hoje ou um per[íi]odo de 7, 15 ou 30/);
    return true;
  });
});

test("🔑 a janela NUNCA vai para o futuro — o defeito das 21h", () => {
  // A afirmação central, e ela é sobre COMPORTAMENTO: o fim do período de hoje
  // é o fim do dia de HOJE em Brasília, nunca um dia à frente. Com a conversão
  // em UTC no cliente, das 21h em diante o início já caía no dia seguinte.
  const agora = new Date();
  for (const consulta of ["days=today", "days=7", "days=30", ""]) {
    const p = periodRequest(q(consulta));
    assert.ok(p.from <= agora, `${consulta}: a janela começa no futuro (${p.from.toISOString()})`);
    assert.equal(brt(p.to), brt(agora), `${consulta}: o fim do período não é o dia de hoje em Brasília`);
  }
});

test("`days=7` cobre 7 dias-calendário INCLUINDO hoje", () => {
  const p = periodRequest(q("days=7"));
  const dias = Math.round((p.to.getTime() - p.from.getTime()) / 86_400_000);
  assert.equal(dias, 7, `esperava 7 dias-calendário e vieram ${dias}`);
});

test("o intervalo personalizado continua valendo, e tem precedência", () => {
  const p = periodRequest(q("from=2026-08-01&to=2026-08-31&days=today"));
  assert.equal(p.label, "2026-08-01 a 2026-08-31");
  assert.equal(brt(p.from), "2026-08-01");
  assert.equal(brt(p.to), "2026-08-31");
});

test("uma data só é pedido malformado, nao meio periodo", () => {
  // Inventar a outra ponta produziria um recorte que ninguém pediu.
  for (const consulta of ["from=2026-08-01", "to=2026-08-31", "from=01/08/2026&to=31/08/2026"]) {
    assert.throws(() => periodRequest(q(consulta)), /from e to no formato YYYY-MM-DD/);
  }
});

test("o teto de dias continua sendo respeitado no personalizado", () => {
  assert.throws(() => periodRequest(q("from=2020-01-01&to=2026-08-31")), /no máximo 365 dias/);
});
