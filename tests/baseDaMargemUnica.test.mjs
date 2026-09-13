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

test("a declaracao vai na FACE do card, nunca no tooltip", async () => {
  // O defeito nao era a frase faltar: era ela estar num lugar que exige hover.
  // `sub` renderiza sem interacao; `info` e o "i".
  const pagina = await readFile(new URL("../src/app/(app)/amazon/page.tsx", import.meta.url), "utf8");
  // ⚠️ MUDOU DE MECANISMO EM 12/09/2026, NAO DE EXIGENCIA. A
  // regua de cartoes da Amazon virou a faixa do periodo (a mesma peca do ML), e
  // com ela a base declarada deixou de sair num `sub` de card para sair na
  // LINHA SOB O NUMERO da coluna de Margem — que renderiza sem interacao do
  // mesmo jeito. O que esta guarda existe para impedir continua igual: a base
  // nunca pode depender de hover, e foi o que aconteceu em 31/08/2026, quando a
  // frase existia dentro do "i" e a vendedora concluiu que a tela estava errada.
  /**
   * ⚠️ ANCORA REAPONTADA EM 13/09/2026, e a intencao anterior
   * fica registrada: ela exigia `baseDeclarada` — a frase INTEIRA, com a base,
   * o que falta e a devolucao juntas por " · " — no sub da faixa.
   *
   * O que mudou: no cartao antigo aquilo cabia; na faixa do v3 o sub tem uma
   * linha, e as tres viravam um paragrafo de cinco. Medido nas duas telas lado
   * a lado: 194px na Amazon contra 126px no Mercado Livre.
   *
   * A INTENCAO NAO MUDOU — a declaracao continua na FACE, sem hover. Mudou o
   * que vai junto dela: `faltaValor` virou pendencia no bloco "O que falta para
   * o numero fechar", com numero e link, que e onde a doutrina dela manda
   * apontar falta. A exigencia de 04/09 ("campo proprio, sem hover") segue
   * cumprida — e melhor que antes, quando a frase morava dentro de outra.
   */
  assert.match(pagina, /baseDoResultado: cards\.find\(\(c\) => c\.key === "marginPct"\)\?\.baseDaFaixa/);
  assert.ok(!/info=\{card\.baseDeclarada\}/.test(pagina), "declaracao dentro do 'i' nao declara nada");
  assert.ok(!/dica: entrada\.baseDoResultado/.test(pagina), "a base foi parar na dica da coluna");
});
