import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { diaEmBrasilia } from "../src/app/components/diaEmBrasilia.ts";
import { moduleApiQuery, moduleHref } from "../src/app/components/TikTokModulesModel.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

// OS DOIS DEFEITOS QUE ESTE ARQUIVO REPROVA, achados em 01/09/2026 no mesmo
// lugar — a conversao de periodo que o cliente do TikTok fazia na mao.
//
// 1. FUSO. `toISOString()` e UTC. Das 21:00 as 23:59 de Brasilia o dia que saia
//    dali era o de AMANHA, e a rota nao reinterpreta: ancora em -03:00 e usa
//    como veio. Em "Hoje" a janela inteira caia no FUTURO e a aba vinha VAZIA,
//    voltando ao normal de manha — 13% de todo dia, todos os dias.
// 2. ROTULO DE UM RECORTE SOBRE O NUMERO DE OUTRO, e este chegava a tela em
//    QUALQUER horario: ao abrir, a URL nao tem from/to, o filtro mostrava
//    "Hoje" (padrao do hook) e o fallback do contrato mandava 30 dias. Um mes
//    de movimento sob a palavra "Hoje".
//
// A raiz foi consertada no servidor (e8b87ba: `periodRequest` aceita days), e
// aqui a conversao foi APAGADA em vez de sobreviver ao limite que a justificava.

test("nenhuma conversao de data sobrou no cliente do TikTok", async () => {
  for (const arquivo of [
    "src/app/components/TikTokModulePage.tsx",
    "src/app/components/TikTokModulesModel.ts",
    "src/app/components/TikTokWorkspace.tsx",
  ]) {
    const codigo = await fonte(arquivo);
    const semComentarios = codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/toISOString\(\)/.test(semComentarios), `${arquivo}: voltou a tirar data de um ISO em UTC`);
    assert.ok(!/setDate\(/.test(semComentarios), `${arquivo}: voltou a calcular data na mao`);
  }
  // E a peca que fazia a conversao NAO PODE VOLTAR A EXISTIR: divida com prazo
  // que sobrevive ao prazo deixa de proteger e passa a mentir (AGENTS.md).
  await assert.rejects(fonte("src/app/components/janelaDeDias.ts"), "o arquivo da conversao voltou");
});

test("o preset escolhido CHEGA ao servidor — nao morre no contrato", () => {
  // Casar comportamento: `days` tem de sobreviver a montagem da query. Sem ele
  // na lista, o preset existia so na barra de enderecos — o mesmo defeito que o
  // `atividade` teve em 28/08/2026.
  for (const kind of ["monitor", "finance", "inventory", "abc"]) {
    const saida = new URLSearchParams(moduleApiQuery("days=7", "conexao-1", kind));
    assert.equal(saida.get("days"), "7", `${kind}: o preset nao chegou ao servidor`);
  }
});

test("a janela NAO e mais inventada aqui — sem periodo, quem decide e o servidor", () => {
  // Era o fallback de 30 dias: ele injetava from/to quando a URL nao tinha, e
  // por isso a tela abria com um mes de dado sob o rotulo "Hoje".
  for (const kind of ["monitor", "finance", "inventory", "abc"]) {
    const saida = new URLSearchParams(moduleApiQuery("", "conexao-1", kind));
    assert.equal(saida.get("from"), null, `${kind}: voltou a inventar o inicio da janela`);
    assert.equal(saida.get("to"), null, `${kind}: voltou a inventar o fim da janela`);
  }
});

test("o intervalo personalizado continua passando inteiro", () => {
  const saida = new URLSearchParams(moduleApiQuery("from=2026-08-01&to=2026-08-10", "conexao-1", "monitor"));
  assert.equal(saida.get("from"), "2026-08-01");
  assert.equal(saida.get("to"), "2026-08-10");
});

test("trocar de modulo NAO perde o preset", () => {
  // Levava `from`/`to` e deixava `days` para tras: quem escolheu 7 dias e foi
  // para outra aba via a escolha sumir.
  for (const destino of ["/tiktok/monitor", "/tiktok/financeiro", "/tiktok/estoque", "/tiktok/abc"]) {
    const href = moduleHref(destino, "days=15&connection_id=c1", "c1");
    assert.match(href, /days=15/, `${destino}: perdeu o preset na navegacao`);
  }
});

test("o dia de Brasilia sobrevive, e continua sendo o de Brasilia", () => {
  // 2026-09-01 22:00 BRT = 2026-09-02T01:00Z — o instante em que a conversao
  // antiga errava. O teto dos campos de data do filtro depende disto.
  const noite = new Date(Date.UTC(2026, 8, 2, 1, 0, 0));
  assert.equal(diaEmBrasilia(noite), "2026-09-01");
  assert.equal(noite.toISOString().slice(0, 10), "2026-09-02", "e ESTE era o valor que ia para a rota");
});

test("o filtro usa a peca compartilhada para o teto das datas", async () => {
  const filtro = await fonte("src/app/components/DashboardPeriodFilter.tsx");
  assert.match(filtro, /const today = diaEmBrasilia\(\);/);
  assert.ok(!/new Intl\.DateTimeFormat\("en-CA"/.test(filtro), "o filtro voltou a ter a propria copia");
});
