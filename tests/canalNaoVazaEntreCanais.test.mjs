import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * REPROVA O DEFEITO DE 12/09/2026: o dashboard da Amazon exibiu a coluna
 * "Tarifa ML".
 *
 * `OrderProfitabilityTableV3` nasceu no Mercado Livre e foi reaproveitado
 * inteiro pela Amazon, com `<span>Tarifa ML</span>` fixo no cabeçalho. A
 * vendedora leu o nome do outro marketplace na própria tela, e nada ficou
 * vermelho: texto fixo é JSX válido em qualquer canal.
 *
 * ⚠️ A GUARDA DE VERDADE É O TIPO, NÃO ESTE ARQUIVO. `canal` é
 * campo OBRIGATÓRIO de `CanalV3`, então quem renderizar a peça sem passar o
 * canal não compila — foi assim que os TRÊS sítios apareceram, incluindo um que
 * o `grep` não tinha achado. Este teste é a segunda linha: ele pega o caminho
 * que o tipo não alcança, que é alguém escrever o nome do canal DE NOVO dentro
 * da peça.
 */
/**
 * AS PECAS COMPARTILHADAS — as que mais de um canal renderiza.
 *
 * LISTA FECHADA, e por isso ela diz o que NAO cobre: peca nova do esqueleto
 * entra aqui NO MESMO commit em que nasce. Guarda enumerada so protege o que
 * alguem lembrou de listar (a licao de 04/09/2026, quando o produtor de tarifa
 * sem chamador passou dois dias invisivel por nao estar na lista).
 *
 * ⚠️ `PainelV3Baixo` FICA DE FORA DA VARREDURA DE TEXTO, mas
 * NAO da guarda — e a distincao custou uma quebra que passou verde.
 *
 * A versao de 12/09/2026 o excluia com esta justificativa: *"o fundo da Amazon
 * vai ser OUTRO componente, com os blocos da Amazon"*. **Falso em menos de um
 * dia:** em 13/09 a Amazon passou a renderizar exatamente esta peca, e o titulo
 * "Radar do FULL" — logistica do Mercado Livre — apareceu na tela dela. Trocar
 * o titulo de volta por texto fixo nao derrubava teste nenhum.
 *
 * Ele continua fora da varredura porque tem blocos que SO o Mercado Livre
 * renderiza (Raio X, Promocoes, Anuncios pagos) e cujas frases citam o canal
 * com razao — a Amazon passa `null` neles e eles nao desenham. Mas os blocos
 * COMPARTILHADOS ganham asercao propria, logo abaixo, uma por titulo.
 *
 * ⚠️ QUANDO ESTA LISTA PRECISA CRESCER: sempre que um bloco
 * hoje exclusivo de um canal passar a ser renderizado pelo outro. O sinal e o
 * `null` virando dado no `DadosV3Baixo` do segundo canal.
 */
const pecas = [
  "src/app/components/OrderProfitabilityTableV3.tsx",
  "src/app/components/PainelV3.tsx",
  "src/app/components/FaixaDoPeriodoV3.tsx",
];

/** Comentário citando o defeito NÃO pode reprovar a peça: a nota que explica a
 *  proibição precisa citar a coisa proibida. Sem esta limpeza a asserção pega o
 *  próprio texto que a documenta — aconteceu quatro vezes neste projeto. */
const semComentario = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("nenhuma peça do esqueleto v3 escreve o nome de um canal", () => {
  const proibidos = [/Tarifa ML/, /Mercado Livre/, /\bAmazon\b/, /Shopee/, /TikTok/];
  for (const peca of pecas) {
    const codigo = semComentario(readFileSync(peca, "utf8"));
    for (const proibido of proibidos) {
      assert.ok(
        !proibido.test(codigo),
        `${peca} escreve ${proibido} — o nome do canal entra por \`canal: CanalV3\`, nunca no corpo da peça.`,
      );
    }
  }
});

test("cada canal declara o próprio nome para o que cobra da venda", async () => {
  const { CANAL_AMAZON, CANAL_MERCADO_LIVRE } = await import("../src/lib/canalV3.ts");
  assert.equal(CANAL_MERCADO_LIVRE.rotuloDaTarifa, "Tarifa ML");
  // Plural e com o nome do canal: a MESMA frase do cartão da faixa logo acima.
  assert.equal(CANAL_AMAZON.rotuloDaTarifa, "Taxas da Amazon");
  assert.notEqual(CANAL_AMAZON.rotuloDaTarifa, CANAL_MERCADO_LIVRE.rotuloDaTarifa);
});

test("os blocos que OS DOIS canais renderizam tiram o titulo do contrato", () => {
  const codigo = semComentario(readFileSync("src/app/components/PainelV3Baixo.tsx", "utf8"));
  // Um por bloco compartilhado. Lista fechada: cresce quando a Amazon deixar de
  // passar `null` em mais algum bloco do `DadosV3Baixo`.
  const compartilhados = [
    { bloco: "radar de estoque do marketplace", esperado: "<h2>{canal.rotuloDoRadar}</h2>", fixo: /<h2>Radar do (FULL|FBA)<\/h2>/ },
    { bloco: "coluna de tarifa da previa de pedidos", esperado: "<span>{canal.rotuloDaTarifa}</span>", fixo: /<span>(Tarifa ML|Taxas da Amazon)<\/span>/ },
  ];
  for (const { bloco, esperado, fixo } of compartilhados) {
    assert.ok(codigo.includes(esperado), `${bloco}: o titulo precisa vir de \`canal\`, e nao do texto da peca`);
    assert.ok(!fixo.test(codigo), `${bloco}: voltou o nome de um canal fixo na peca que os dois renderizam`);
  }
});
