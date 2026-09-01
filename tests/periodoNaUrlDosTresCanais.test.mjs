import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { periodoNaUrl } from "../src/app/components/periodoNaUrl.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

// O DEFEITO QUE ESTE ARQUIVO REPROVA (01/09/2026).
//
// Amazon, ML e Shopee chamavam useDashboardPeriod() SEM argumento: o periodo
// nao existia no endereco. Nao era so higiene —
//   • ?days=30 no endereco era descartado em silencio;
//   • recarregar ou voltar pelo historico perdia a escolha;
//   • e QUALQUER coisa que lesse o periodo pela URL nascia quebrada. Foi assim
//     que o guard do BriefingLead morreu: lia useSearchParams(), nunca achava
//     `days`, e a narracao saia em qualquer periodo rotulando os numeros como
//     "nos ultimos 30 dias".

test("AS TRES telas escrevem o periodo no endereco", async () => {
  // As quatro, contando o TikTok que ja fazia — a licao do BriefingLead e que
  // uma tela de fora nao aparece, porque as outras funcionam.
  for (const [tela, params] of [
    ["src/app/(app)/amazon/page.tsx", "searchParams"],
    ["src/app/components/MercadoLivreWorkspace.tsx", "searchParams"],
    ["src/app/components/ShopeeWorkspace.tsx", "searchParams"],
  ]) {
    const codigo = await fonte(tela);
    // Casar a chamada COM os dois argumentos: o hook so le a URL pelo primeiro
    // e so avisa pelo segundo. `useDashboardPeriod` sozinho nao prova nada.
    //
    // Espacos normalizados em vez de regex montada: a chamada esta quebrada em
    // varias linhas, e regex com escape dentro de string virou fonte de teste
    // vermelho por motivo que nao e o produto (AGENTS.md).
    const semEspacos = codigo.replace(/\s+/g, " ");
    assert.ok(
      semEspacos.includes(`useDashboardPeriod( ${params}.toString(),`),
      `${tela}: voltou a ignorar o periodo do endereco`,
    );
    assert.match(codigo, /periodoNaUrl\(/, `${tela}: monta a URL por fora da peca compartilhada`);
    // ⚠️ A chamada surda nao pode voltar — e esta assercao PROIBE uma string,
    // entao ela olha o codigo SEM COMENTARIOS. O comentario que explica o
    // conserto cita `useDashboardPeriod()` para dizer o que era; casar o
    // arquivo cru reprovaria a propria documentacao do conserto.
    const semComentarios = codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/useDashboardPeriod\(\)/.test(semComentarios), `${tela}: voltou uma chamada surda`);
  }
});

test("o que nao e periodo sobrevive a troca", () => {
  const proxima = new URLSearchParams(periodoNaUrl("connection_id=c1&secao=vendas&days=today", "days=15"));
  assert.equal(proxima.get("connection_id"), "c1");
  assert.equal(proxima.get("secao"), "vendas");
  assert.equal(proxima.get("days"), "15");
});

test("a Shopee zera a pagina NA MESMA navegacao", async () => {
  // Sem isso, uma troca de periodo cria DUAS entradas no historico e o botao
  // voltar precisa de dois cliques para desfazer um.
  const query = periodoNaUrl("offset=50", "days=7", { offset: "0" });
  assert.equal(new URLSearchParams(query).get("offset"), "0");
  assert.equal(new URLSearchParams(query).get("days"), "7");

  const shopee = await fonte("src/app/components/ShopeeWorkspace.tsx");
  assert.match(shopee, /periodoNaUrl\(searchParams\.toString\(\), query, \{ offset: "0" \}\)/);
});

test("os dois modos continuam excludentes", () => {
  // Preset limpa from/to e intervalo limpa days: com os dois no endereco, o
  // servidor prefere from/to e o filtro prefere o que acabou de escolher — a
  // pessoa veria o numero de um periodo com o botao de outro.
  assert.equal(periodoNaUrl("from=2026-08-01&to=2026-08-10", "days=7"), "days=7");
  assert.equal(periodoNaUrl("days=30", "from=2026-08-01&to=2026-08-10"), "from=2026-08-01&to=2026-08-10");
});

test("a Amazon ganhou a fronteira de Suspense que useSearchParams exige", async () => {
  const amazon = await fonte("src/app/(app)/amazon/page.tsx");
  assert.match(amazon, /<Suspense fallback=\{<DashboardSkeleton \/>\}>\s*<Dashboard \/>\s*<\/Suspense>/);
});
