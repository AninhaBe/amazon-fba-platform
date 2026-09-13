import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { declaracaoDeBase, BASE_SEM_DIFERENCA } from "../src/app/components/baseDaMargem.ts";

// 31/08/2026: a tela mostrou lucro e margem sobre R$ 748,56 apurados ao lado de
// um card de Faturamento de R$ 1.068,37. A explicacao existia — dentro do "i".
// A Ana passou o dia sem ve-la e concluiu que a tela estava errada.
//
// A frase agora e UMA, para os quatro canais. Quatro versoes divergem na
// primeira vez que alguem ajusta uma.

const moeda = "BRL";

test("declara a diferenca com os DOIS numeros, para a leitura fechar", () => {
  const frase = declaracaoDeBase({ baseApurada: 748.56, faturamentoExibido: 1068.37, moeda });
  assert.match(frase, /748,56/);
  assert.match(frase, /1\.068,37/);
  assert.match(frase, /apurados de/);
});

test("com pedidos aguardando, a frase diz a CAUSA da diferenca", () => {
  const uma = declaracaoDeBase({ baseApurada: 100, faturamentoExibido: 150, moeda, pedidosAguardando: 1 });
  assert.match(uma, /1 pedido aguardando confirmação/);
  const varias = declaracaoDeBase({ baseApurada: 100, faturamentoExibido: 150, moeda, pedidosAguardando: 3 });
  assert.match(varias, /3 pedidos aguardando confirmação/);
});

test("bases iguais NAO declaram nada", () => {
  // Explicar diferenca que nao existe treina a pessoa a ignorar a frase no dia
  // em que ela importa — mesmo raciocinio da marca de "ainda consolidando".
  assert.equal(declaracaoDeBase({ baseApurada: 500, faturamentoExibido: 500, moeda }), null);
  assert.equal(declaracaoDeBase({ baseApurada: 500, faturamentoExibido: 400, moeda }), null);
  assert.equal(declaracaoDeBase({ baseApurada: null, faturamentoExibido: 500, moeda }), null);
  assert.equal(declaracaoDeBase({ baseApurada: 500, faturamentoExibido: null, moeda }), null);
  assert.equal(BASE_SEM_DIFERENCA, "sobre vendas");
});

test("a frase e composta em UM lugar — nenhum canal escreve a propria", async () => {
  // A trava contra a segunda declaracao. Se a Shopee (ou ML, ou TikTok) montar
  // "apurados de" por conta propria, as duas divergem sem ninguem perceber.
  for (const caminho of [
    "src/app/(app)/amazon/amazonFinancialCards.ts",
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/MercadoLivreWorkspace.tsx",
    "src/app/components/TikTokWorkspace.tsx",
  ]) {
    const fonte = await readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
    assert.ok(!/apurados de \$\{|apurados de R\$/.test(fonte), `${caminho}: montou a propria declaracao`);
  }
  // ⚠️ A AMAZON SAIU DESTA LISTA EM 31/08/2026, e a razao e o oposto de
  // regressao: ela nao declara mais base nenhuma. A vendedora aboliu a base
  // apurada do canal ("TEM QUE ESQUECER O APURADO"), entao lucro, margem e
  // imposto saem do mesmo numero que o card exibe e nao ha diferenca para
  // explicar. A peca compartilhada segue viva para Shopee, ML e TikTok, que
  // ainda tem duas bases de verdade.
  //
  // A trava acima — nenhum canal monta "apurados de" a mao — continua valendo
  // para os quatro, inclusive para a Amazon, que agora nao pode nem consumir
  // nem reescrever a frase.
  const amazon = await readFile(new URL("../src/app/(app)/amazon/amazonFinancialCards.ts", import.meta.url), "utf8");
  assert.ok(!/declaracaoDeBase\(/.test(amazon), "a Amazon nao declara mais base — ver AGENTS.md, uma base so");
});

test("a faixa Amazon não recebe mais a declaração longa sob a Margem", async () => {
  // INTENÇÃO ALTERADA EM 13/09/2026: a dona pediu a retirada das legendas que
  // deixavam os cartões maiores que os do ML. O que falta permanece em
  // Pendências, com número e destino.
  const pagina = await readFile(new URL("../src/app/(app)/amazon/page.tsx", import.meta.url), "utf8");
  const codigo = pagina.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/baseDaFaixa|baseDoResultado: cards\.find/.test(codigo), "a declaração voltou a esticar a faixa");
  assert.match(codigo, /faltaOValorDaAmazon[\s\S]{0,300}href: "\/amazon\/monitor"/);
});
