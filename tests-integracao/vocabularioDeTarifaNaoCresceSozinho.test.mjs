import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { LOCAL_HOSTS } from "../scripts/migration-safety.mjs";

// ═══ TIPO DE TARIFA NOVO NÃO PODE APARECER EM SILÊNCIO ══════════════════════
//
// ✅ VISTO VERMELHO EM 12/09/2026, e vale registrar como: acrescentei
// `'reembolso_parcial'` ao CHECK `channel_order_fees_vocabulario_canonico` num
// Postgres descartável e rodei. Ele reprovou nomeando o valor novo e imprimindo
// a decisão inteira — o que fazer, onde, e o que acontece se ninguém fizer.
// Depois desfiz a alteração. (O teste chegou a ser escrito sem essa prova,
// porque o WSL desta máquina estava sem memória para subir a VM; a prova veio
// no mesmo dia, assim que ele voltou.)
//
// COMO REPETIR: mesma alteração no CHECK, num banco DESCARTÁVEL — nunca em
// produção; a tabela real tem 143 mil linhas e o CHECK é validado no ALTER.
//
// ═══ POR QUE ELE EXISTE ═══
//
// Em 12/09/2026 onze consultas trocaram `fee_type <> 'refund'` por uma lista
// positiva (`TIPOS_DE_TARIFA_QUE_CUSTAM`, em canonical.ts), por ordem da dona
// do produto: *"lista negra nao existe, se esta no nexo com esse termo, pode
// remover"*.
//
// A troca é equivalente HOJE por construção — a lista é o vocabulário do CHECK
// menos `refund`, e o banco proíbe qualquer outro valor. Mas essa equivalência
// **não é estável**: ela dura exatamente até alguém acrescentar um valor ao
// CHECK sem acrescentá-lo à lista.
//
// 🔴 E A FALHA TERIA A DIREÇÃO PIOR POSSÍVEL, que é o motivo deste arquivo:
// tarifa é dinheiro que REDUZ o resultado. Um tipo novo esquecido de fora da
// lista não dá erro de SQL, não corrompe dado, não aparece na tela — ele
// simplesmente deixa de ser somado ao custo, e **o lucro sobe em silêncio**.
// Com a lista negra antiga, o tipo novo entrava sozinho, que era o lado seguro.
// Ao trocar para positiva ganhamos legibilidade e PERDEMOS essa proteção; este
// teste é a proteção de volta.
//
// 📌 O tamanho disso não é hipotético: a mesma medição de 12/09 mostrou 452
// linhas `other` na Amazon somando R$ 1.786,73 — dinheiro que uma lista
// positiva "semântica" (só commission + fulfillment) teria apagado do custo.

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL ausente: o teste do VOCABULARIO DE TARIFA nao rodou. Isto e FALHA, nao " +
    "ausencia de trabalho. Suba um Postgres descartavel e rode `npm run ci:preparar-banco`.",
  );
}
if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
  throw new Error(`BLOCKED: TEST_DATABASE_URL aponta para "${new URL(url).hostname}", que nao e descartavel.`);
}

const { TIPOS_DE_TARIFA_QUE_CUSTAM } = await import("../src/lib/integrations/canonical.ts");

/** Extrai os literais entre aspas simples do texto do CHECK. */
function valoresDoCheck(definicao) {
  return [...definicao.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
}

test("o vocabulario de tarifa do BANCO nao cresce sem a lista do codigo crescer junto", async () => {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    const { rows } = await cliente.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'channel_order_fees_vocabulario_canonico'`,
    );
    assert.equal(rows.length, 1,
      "o CHECK do vocabulario sumiu da tabela real. Ou a migration 0028 foi revertida, ou " +
      "alguem removeu a restricao — nos dois casos a lista positiva do codigo deixou de ter " +
      "garantia nenhuma, porque qualquer string volta a poder ser gravada.");

    const noBanco = valoresDoCheck(rows[0].def);
    assert.ok(noBanco.length >= 8, `nao consegui ler os valores do CHECK: ${rows[0].def}`);

    // `refund` é o único que fica DE FORA da lista de custo, e de propósito:
    // estorno devolve dinheiro, não reduz o resultado.
    const esperado = noBanco.filter((v) => v !== "refund").sort();
    const noCodigo = [...TIPOS_DE_TARIFA_QUE_CUSTAM].sort();

    const faltando = esperado.filter((v) => !noCodigo.includes(v));
    const sobrando = noCodigo.filter((v) => !esperado.includes(v));

    assert.deepEqual(
      noCodigo, esperado,
      "TIPOS_DE_TARIFA_QUE_CUSTAM divergiu do CHECK do banco.\n" +
      (faltando.length
        ? `  🔴 O BANCO ACEITA E O CODIGO IGNORA: ${faltando.join(", ")}\n` +
          "     Esta e a direcao PERIGOSA. Tarifa desses tipos deixa de ser somada ao custo\n" +
          "     e o LUCRO SOBE EM SILENCIO — sem erro, sem tela errada, sem rastro.\n" +
          "     O QUE FAZER: acrescente cada um a TIPOS_DE_TARIFA_QUE_CUSTAM em\n" +
          "     src/lib/integrations/canonical.ts, A MENOS que o tipo devolva dinheiro\n" +
          "     (como refund) — nesse caso acrescente a excecao AQUI, com o porque escrito.\n"
        : "") +
      (sobrando.length
        ? `  ⚠️ O CODIGO LISTA E O BANCO NAO ACEITA: ${sobrando.join(", ")}\n` +
          "     Inofensivo para o numero (nao existe linha assim), mas e mentira no codigo:\n" +
          "     alguem apertou o CHECK e nao limpou a lista. Remova de canonical.ts.\n"
        : "") +
      "  SE NINGUEM FIZER NADA: a lista positiva vira uma lista negra pior que a que\n" +
      "  ela substituiu — ilegivel E incompleta.",
    );
  } finally {
    await cliente.end();
  }
});
