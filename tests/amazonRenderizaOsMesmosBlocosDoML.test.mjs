import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * REPROVA O QUE ELA VIU EM 13/09/2026: *"ta faltando componente na amazon
 * ainda … cade Anúncios pagos? repasses?"*
 *
 * O dashboard da Amazon passou a renderizar `PainelV3Baixo` — a mesma peça do
 * Mercado Livre — mas entregando `null` em dois blocos. A peça aceita `null` e
 * simplesmente não desenha, de propósito: é assim que um canal omite o que não
 * tem. O efeito colateral é que **bloco esquecido some sem nada ficar
 * vermelho** — foi preciso ela abrir a tela e perguntar.
 *
 * ⚠️ E A GUARDA QUE EU TINHA ESCRITO NÃO PEGAVA. Apagar o
 * bloco "Anúncios pagos" da Amazon e rodar a suíte inteira dava VERDE. Este
 * arquivo é a quebra C do dia, a única que passou.
 *
 * ⚠️ A LISTA NÃO É MINHA — É DO TIPO. As chaves saem lidas de
 * `interface DadosV3Baixo`. Campo novo no contrato cai aqui como "não sei o que
 * fazer com isto" e obriga uma decisão, em vez de nascer esquecido.
 */
const PECA = "src/app/components/PainelV3Baixo.tsx";
const AMAZON = "src/app/(app)/amazon/page.tsx";

/** Blocos que a Amazon NÃO tem, com o motivo — não é esquecimento. */
const AUSENTES_COM_MOTIVO = {
  catalogo: "Raio X do catálogo lê os concorrentes que o Mercado Livre publica por anúncio; a SP-API não expõe equivalente.",
  promocoes: "Promoções oferecidas são campanhas que o Mercado Livre banca e oferece ao vendedor; a Amazon não tem esse convite.",
};

function chavesDoContrato() {
  const fonte = readFileSync(PECA, "utf8");
  const bloco = fonte.slice(fonte.indexOf("export interface DadosV3Baixo"));
  const corpo = bloco.slice(bloco.indexOf("{") + 1, bloco.indexOf("\n}"));
  const semComentarios = corpo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return [...semComentarios.matchAll(/^\s{2}([a-zA-Z]+)\s*:/gm)].map((m) => m[1]);
}

test("a Amazon preenche TODOS os blocos do contrato, ou declara por que não tem", () => {
  const chaves = chavesDoContrato();
  assert.ok(chaves.length >= 5, `esperava ler as chaves de DadosV3Baixo e achei ${chaves.length}: ${chaves}`);

  const fonte = readFileSync(AMAZON, "utf8");
  const ini = fonte.indexOf("const dadosV3Baixo: DadosV3Baixo = {");
  assert.ok(ini > 0, "a Amazon não monta mais `dadosV3Baixo` — o fundo da tela saiu da peça do Mercado Livre");
  const montagem = fonte.slice(ini, fonte.indexOf("\n  };", ini));

  for (const chave of chaves) {
    const nulo = new RegExp(`^\s{4}${chave}: null,`, "m").test(montagem);
    if (nulo) {
      assert.ok(
        AUSENTES_COM_MOTIVO[chave],
        `a Amazon entrega \`${chave}: null\` e não há motivo declarado. `
        + "Bloco que vira null some da tela sem nada ficar vermelho — foi assim que 'Anúncios pagos' e 'Repasses' sumiram. "
        + "Se a Amazon realmente não tem esse bloco, escreva o porquê em AUSENTES_COM_MOTIVO.",
      );
      continue;
    }
    assert.match(
      montagem, new RegExp(`${chave}:`),
      `a Amazon não preenche \`${chave}\` — o bloco não aparece na tela dela, e o Mercado Livre mostra.`,
    );
  }
});

test("os blocos que a Amazon tem de verdade continuam ligados", () => {
  const montagem = readFileSync(AMAZON, "utf8");
  // Um por bloco que ela cobrou pelo nome, com o dado que o alimenta.
  assert.match(montagem, /anuncios: !profit\?\.adsConectado/, "Anúncios pagos saiu da Amazon");
  // ⚠️ A ANCORA MUDOU EM 13/09/2026 e a intencao anterior fica
  // registrada: ela exigia `<SaldoNaAmazon`, o cartao grande e antigo. Ele foi
  // trocado pela MESMA peca compacta do Mercado Livre (`EtapaDoCaminhoView`),
  // porque ela pos as duas telas lado a lado e a da Amazon era a antiga.
  assert.match(montagem, /saldo: saldo \? \(\s*<EtapaDoCaminhoView/, "Repasses (saldo) saiu da Amazon");
  assert.match(montagem, /radar: \{/, "Radar do FBA saiu da Amazon");
  assert.match(montagem, /revisar: \{/, "a prévia de Pedidos saiu da Amazon");
});
