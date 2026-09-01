import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { progressoQueAparece, sinaisSilenciadosPorAlarme } from "../src/app/components/hierarquiaDeAvisos.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// O DEFEITO QUE ESTE ARQUIVO REPROVA — auditoria de empilhamento, 01/09/2026.
//
// NAO ERA EXCESSO DE INFORMACAO. ERA A MESMA INFORMACAO REPETIDA:
// sinaisDoResultado() devolve ate TRES sinais, e a MESMA lista era passada para
// tres cartoes no ML e quatro na Shopee — ate 9 e 12 marcas "⚠" dizendo tres
// coisas. Repeticao ensina a varrer a faixa sem ler nenhuma.
//
// ⚠️ E POR ISSO O CONSERTO NAO TIRA INFORMACAO: os tres sinais continuam
// visiveis, uma vez cada, com numero e link. O que saiu foi a repeticao. Se
// algum corte fizer um sinal sumir de vez, o corte esta errado — vira o oposto
// do que ela pediu, que e apontar o que falta com numero.

test("CORTE 1 — os sinais aparecem UMA vez por tela, nao um por cartao", async () => {
  for (const tela of [
    "src/app/components/MercadoLivreWorkspace.tsx",
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/(app)/amazon/page.tsx",
    "src/app/components/TikTokWorkspace.tsx",
  ]) {
    const codigo = semComentarios(await fonte(tela));
    // ⚠️ POR VIEW, nao por arquivo. O ML tem duas telas no mesmo modulo
    // (dashboard e Monitor), e cada uma mostra os sinais UMA vez — o corte
    // proibe repetir a MESMA lista em varios cartoes da MESMA tela, nao
    // mostra-la nas telas que a usam.
    const vezes = (codigo.match(/<SinaisDoResultado sinais=\{sinais\} \/>/g) ?? []).length;
    const limite = tela.includes("MercadoLivreWorkspace") ? 2 : 1;
    assert.ok(vezes <= limite, `${tela}: os sinais voltaram a repetir (${vezes} vezes, limite ${limite})`);
  }
});

test("e NENHUM sinal desapareceu — a lista continua na tela", async () => {
  // A condicao que atravessa os tres cortes. Um corte que zera a lista e pior
  // que o empilhamento.
  // ⚠️ O TIKTOK ENTROU AQUI EM 01/09/2026, e a ausencia dele era um buraco: a
  // rodada de quebras mostrou que APAGAR os sinais do TikTok nao era pego por
  // teste nenhum. A lista cobria tres canais e a regra vale para os quatro —
  // exatamente o defeito que o guard do BriefingLead teve, numa tela de fora.
  for (const tela of [
    "src/app/components/MercadoLivreWorkspace.tsx",
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/(app)/amazon/page.tsx",
    "src/app/components/TikTokWorkspace.tsx",
    "src/app/components/ShopeeModulePage.tsx",
  ]) {
    const codigo = semComentarios(await fonte(tela));
    // ⚠️ O NOME DA VARIAVEL NAO E PARTE DA REGRA: a primeira versao casava
    // `sinais={sinais}` literal e reprovou o ShopeeModulePage, que chama a lista
    // de `sinaisDaTela`. Guarda que so aceita um nome ensina a renomear para
    // fugir dela.
    assert.match(codigo, /<SinaisDoResultado\s+sinais=\{\w+\}\s*\/>/, `${tela}: os sinais sumiram de vez`);
  }
});

test("CORTE 2 — conexao caida cala os sinais, e so onde ela EMPILHA", async () => {
  assert.equal(sinaisSilenciadosPorAlarme(true), true);
  assert.equal(sinaisSilenciadosPorAlarme(false), false, "os sinais voltam quando a conexao volta");

  // Amazon e ML: a faixa de conexao caida convive com o conteudo.
  for (const [tela, condicao] of [
    ["src/app/(app)/amazon/page.tsx", "Boolean(brokenConnection)"],
    ["src/app/components/MercadoLivreWorkspace.tsx", "conexaoCaida"],
  ]) {
    const codigo = semComentarios(await fonte(tela));
    assert.ok(
      codigo.includes(`!sinaisSilenciadosPorAlarme(${condicao}) && sinais.length > 0`),
      `${tela}: o alarme voltou a dividir espaco com os sinais`,
    );
  }
});

test("na Shopee e no TikTok a conexao caida e TAKEOVER — nao ha o que calar", async () => {
  // ⚠️ Verificado, nao suposto. Foi um erro do meu inventario inicial dizer que
  // os quatro empilhavam: nestes dois a tela inteira e substituida, entao a
  // supressao seria codigo que nao muda nada.
  for (const tela of ["src/app/components/ShopeeWorkspace.tsx", "src/app/components/TikTokWorkspace.tsx"]) {
    const codigo = semComentarios(await fonte(tela));
    assert.match(codigo, /return[\s\S]{0,220}<ConnectionBroken/, `${tela}: a conexao caida deixou de ser takeover`);
  }
});

test("CORTE 3 — os dois avisos de progresso ja sao mutuamente exclusivos", async () => {
  // Outro erro do inventario, e este vale registrar: `SincronizacaoCompleta` so
  // age com status "complete" e `AvisoDeSyncInterrompido` so com erro de sync.
  // Nao existe estado em que as duas faixas aparecam juntas — nao havia o que
  // cortar, e cortar seria codigo que nao move numero nenhum.
  const faixa = await fonte("src/app/components/SincronizacaoCompleta.tsx");
  assert.match(faixa, /if \(status !== "complete" \|\| !coveredFrom\) return;/);

  const tiktok = semComentarios(await fonte("src/app/components/TikTokWorkspace.tsx"));
  assert.match(tiktok, /\(syncPhase === "retryable_error" \|\| syncPhase === "reauth_required"\) && \(/);
});

test("a peca da hierarquia escolhe UM progresso, e o que nao se resolve sozinho ganha", () => {
  assert.equal(progressoQueAparece(["em-andamento", "interrompido"]), "interrompido");
  assert.equal(progressoQueAparece(["concluido", "em-andamento"]), "em-andamento");
  assert.equal(progressoQueAparece([null, undefined]), null);
});
