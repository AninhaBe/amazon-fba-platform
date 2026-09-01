import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

// O DEFEITO QUE ESTE ARQUIVO REPROVA — achado em 01/09/2026, e ja estava EM
// PRODUCAO, sem cache nenhum envolvido.
//
// A aliquota da loja Shopee e editada DENTRO do modulo de custos, e ela entra no
// calculo de IMPOSTO e LUCRO de todas as linhas — calculo que quem faz e o
// SERVIDOR. Salvar a aliquota mudava a resposta do servidor e nao mexia na
// tabela: a tela seguia exibindo o imposto e o lucro do payload anterior ate a
// proxima montagem. Numero errado na tela, sem aviso — e a mensagem de sucesso
// ao lado ("Aliquota salva para esta loja") reforcava que a tabela ja refletia.
//
// ⚠️ TESTE PROPRIO, E NAO DE LADO. O conserto veio junto com o cache da tela
// (`cacheDaTela`), e defeito coberto so pelo efeito colateral de outra feature
// volta no dia em que a outra feature muda. Este arquivo reprova o defeito, nao
// a implementacao do cache.

test("salvar a aliquota AVISA a tela — nao fica so na mensagem de sucesso", async () => {
  const shopee = await fonte("src/app/components/ShopeeModulePage.tsx");

  // O editor precisa RECEBER o aviso...
  assert.match(
    shopee,
    /function ShopeeTaxRateEditor\(\{connectionId,onSalvou\}:\{connectionId:string;onSalvou:\(\)=>void\}\)/,
    "o editor de aliquota voltou a nao ter como avisar ninguem",
  );
  // ...e DISPARAR no caminho de sucesso. Casar a ramificacao, nao o nome: o
  // `onSalvou` continuaria na assinatura depois de alguem apagar a chamada.
  assert.match(
    shopee,
    /setDraft\(body\.taxRate==null\?"":String\(body\.taxRate\)\);setState\("saved"\);[\s\S]{0,300}onSalvou\(\);/,
    "salvar com sucesso voltou a nao avisar a tela",
  );
  // E o editor tem de estar LIGADO ao pai — assinatura e chamada sem fio no
  // meio nao consertam nada.
  assert.match(shopee, /<ShopeeTaxRateEditor key=\{connectionId\} connectionId=\{connectionId\} onSalvou=\{aoSalvarAliquota\}\/>/);
});

test("o aviso da aliquota REBUSCA de verdade — esquece o guardado e refaz", async () => {
  const shopee = await fonte("src/app/components/ShopeeModulePage.tsx");
  // Duas metades, e as duas importam. Só esquecer nao rebusca; so rebuscar
  // devolveria o payload guardado, de antes da aliquota.
  assert.match(
    shopee,
    /const aoSalvarAliquota=useCallback\(\(\)=>\{cache\.esquecer\(\);setAttempt\(value=>value\+1\)\},\[cache\]\);/,
    "o aviso da aliquota parou de esquecer o guardado, de rebuscar, ou os dois",
  );
});

test("o TikTok nao tem este escritor — e a ausencia e verificada, nao suposta", async () => {
  // A Shopee edita aliquota dentro do modulo; o TikTok nao. Se um editor de
  // aliquota aparecer la, ele precisa do mesmo aviso — e este teste e quem vai
  // lembrar, em vez de a divergencia ser descoberta na tela.
  const tiktok = await fonte("src/app/components/TikTokModulePage.tsx");
  assert.ok(
    !/TaxRateEditor|parseTikTokTaxRateDraft/.test(tiktok),
    "o TikTok ganhou editor de aliquota: ele precisa avisar a tela, como a Shopee",
  );
});
