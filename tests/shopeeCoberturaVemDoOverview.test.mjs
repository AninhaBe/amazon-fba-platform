import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { coberturaDoPeriodo } from "../src/lib/coberturaPeriodo.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * ⚠️ O DEFEITO QUE ISTO REPROVA (02/09/2026): a cobertura da Shopee so era
 * calculada quando a SEGUNDA requisicao (o estado de sincronizacao) ja tinha
 * respondido. Enquanto ela nao voltava — ou se voltasse com erro — a tela pulava
 * o estado vazio e mostrava OS CARDS ZERADOS de um mes que nunca foi importado.
 *
 * "Nao vendeu" e "nao importei" sao fatos diferentes, e o zerado afirma o
 * primeiro. E a regra da casa: tela sem dado mostra o estado real.
 */

test("COMPORTAMENTO: sem o estado de sincronizacao, a cobertura ainda acusa periodo nao importado", () => {
  // O caso real: o periodo pedido termina ANTES do inicio do historico
  // importado. Com `status` desconhecido — que e o que se tem enquanto a
  // segunda requisicao nao voltou —, a peca ainda precisa dizer "descoberto".
  const junho = coberturaDoPeriodo({
    periodoDeMs: Date.parse("2026-06-01T00:00:00Z"),
    periodoAteMs: Date.parse("2026-06-30T23:59:59Z"),
    coveredFrom: "2026-08-01T00:00:00Z",
    status: null,
  });
  assert.equal(
    junho.periodoInteiroDescoberto, true,
    "com o historico comecando depois do periodo, a tela tem de dizer que nao importou",
  );

  // E o contraste: dentro da janela importada, nao ha o que avisar.
  const agosto = coberturaDoPeriodo({
    periodoDeMs: Date.parse("2026-08-10T00:00:00Z"),
    periodoAteMs: Date.parse("2026-08-20T23:59:59Z"),
    coveredFrom: "2026-08-01T00:00:00Z",
    status: null,
  });
  assert.equal(agosto.periodoInteiroDescoberto, false, "periodo dentro do historico nao pode virar estado vazio");
});

test("a Shopee le o inicio do historico do OVERVIEW, nao de uma segunda requisicao", async () => {
  const codigo = semComentarios(await fonte("src/app/components/ShopeeWorkspace.tsx"));

  // Ancorado na DEFINICAO — de onde o valor nasce —, nao no uso: casar
  // `coveredFrom: historicoDesde` provaria so que a variavel tem esse nome, e
  // trocar a FONTE dela uma linha acima nao mudaria o nome (o defeito do ticket
  // medio, 02/09/2026).
  assert.match(
    codigo,
    /const historicoDesde = overview\.metrics\.revenueCoverage\.historicoDesde \?\? sync\?\.coveredFrom \?\? null;/,
    "a cobertura voltou a nascer da segunda requisicao",
  );

  // E a cobertura NAO pode voltar a ser condicional ao `sync` existir: era isso
  // que fazia o estado vazio ser pulado.
  assert.ok(
    !/const cobertura = sync \?/.test(codigo),
    "a cobertura voltou a depender do sync ter chegado",
  );
  assert.match(codigo, /const cobertura = coberturaDoPeriodo\(\{/, "a cobertura deixou de ser calculada");
});

test("os dois canais usam a MESMA peca e a MESMA fonte — um e a referencia do outro", async () => {
  for (const tela of [
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/MercadoLivreWorkspace.tsx",
  ]) {
    const codigo = semComentarios(await fonte(tela));
    assert.match(codigo, /coberturaDoPeriodo\(\{/, `${tela}: deixou de usar a peca compartilhada`);
    assert.match(
      codigo,
      /revenueCoverage\.historicoDesde/,
      `${tela}: deixou de ler o inicio do historico do overview`,
    );
  }
});
