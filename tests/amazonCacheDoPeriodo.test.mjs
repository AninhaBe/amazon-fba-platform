import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Medido em producao em 28/08/2026, no movimento que a dona do produto faz todo
// dia (abre em 30 dias, vai para 7, VOLTA para 30): o card de Faturamento
// continuou mostrando R$ 1.603,70 — o valor de 7 dias — sob o rotulo "30 dias"
// por 551ms, enquanto a celula de Taxas ao lado ja mostrava o recorte novo.
//
// A causa nao foi o cache: foi o que ficou FORA dele. CINCO fatias eram estado
// solto, escrito so quando a resposta chegava. O que estava no snapshot
// repintava do cache no primeiro quadro; o que estava fora esperava a rede,
// mostrando enquanto isso o numero do periodo anterior. Foi a DISCORDANCIA
// entre celulas vizinhas da mesma faixa que denunciou o defeito.
//
// ⚠️ ESTA E UMA GUARDA DE FONTE, E ELA CABE: proibe um PADRAO (aplicar payload
// sem registrar no snapshot), nao verifica logica. A fronteira entre os dois
// tipos de teste esta no ADR-017.

const CAMINHO = "src/app/amazon/page.tsx";
const fonte = await readFile(new URL(`../${CAMINHO}`, import.meta.url), "utf8");

test("toda fatia aplicada do payload tambem entra no snapshot do periodo", () => {
  const inicio = fonte.indexOf("const aplicarPayload =");
  assert.notEqual(inicio, -1, `nao achei aplicarPayload em ${CAMINHO}`);
  const bloco = fonte.slice(inicio, fonte.indexOf("\n    };", inicio));
  assert.ok(bloco.includes("next.orders"), "o bloco lido nao parece o de aplicar o payload");

  // Toda fatia escrita a partir do payload precisa ir para as DUAS pontas: o
  // estado (para esta renderizacao) e o `next` (que vira o snapshot no cache).
  const setters = [...bloco.matchAll(/\bset([A-Z]\w*)\(/g)].map((m) => m[1]);
  const semSnapshot = [...new Set(setters)].filter((setter) => {
    const campo = setter[0].toLowerCase() + setter.slice(1);
    return !bloco.includes(`next.${campo}`);
  });
  assert.deepEqual(
    semSnapshot,
    [],
    `${CAMINHO}: estas fatias sao escritas do payload mas nao entram no snapshot do periodo: ` +
      `${semSnapshot.join(", ")}. Sem isso, voltar a um periodo ja visto exibe o valor do recorte ` +
      `ANTERIOR ate a rede responder — foi o defeito medido em 28/08/2026 no card de Faturamento.`
  );
});

test("as cinco fatias que escaparam sao derivadas no render, nao lidas cruas", () => {
  // Guardar no snapshot nao basta: a tela tem de LER o derivado. Se alguem
  // voltar a ler o estado bruto, o defeito volta inteiro.
  const brutoDe = { conciliacao: "conciliacaoBruta", faturamento: "faturamentoBruto",
    pedidosFeitos: "pedidosFeitosBruto", canceladas: "canceladasBrutas", cobertura: "coberturaBruta" };
  for (const [fatia, bruto] of Object.entries(brutoDe)) {
    const esperado = `const ${fatia} = naMao ? ${bruto} : cacheDoPeriodo?.${fatia} ?? null;`;
    assert.ok(
      fonte.includes(esperado),
      `${CAMINHO}: '${fatia}' precisa ser derivada no render — na mao se for deste periodo, ` +
        `senao do cache, senao null. Esperava a linha: ${esperado}`
    );
  }
});
