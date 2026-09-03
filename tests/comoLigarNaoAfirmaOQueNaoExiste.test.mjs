import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ⚠️ PAGINA DE INSTRUCAO E ESTADO DE TERCEIRO ESCRITO — e envelhece calada.
//
// 🔴 Medido em 02/09/2026, quando a dona do produto finalmente chegou nesta
// pagina pela porta nova que a gente abriu:
//   - o bloco da Shopee dizia "esperando a aprovacao deles ~10 dias uteis"
//     DEPOIS de o Go Live ter sido aprovado — 26 dias afirmando um bloqueio
//     vencido, o mesmo defeito que o docs/estado-atual.md teve no mesmo periodo;
//   - o bloco do TikTok listava "App de desenvolvedor na Marketing API — NEXO"
//     como passo de um processo em andamento. Nunca foi criado nem solicitado.
//     Verbatim dela: "nunca criei nada alem do que tem hoje".
//
// 📌 A licao: pagina que afirma o estado de OUTRA empresa nao pode existir sem
// data de verificacao, e nao pode descrever PLANO como se fosse presente.

const pagina = await readFile(new URL("../src/app/(app)/ads/como-ligar/page.tsx", import.meta.url), "utf8");
const semComentario = pagina.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("nao afirma que a Shopee esta esperando aprovacao — ela ja aprovou", () => {
  assert.ok(!/Esperando a aprova/i.test(semComentario), "o Go Live foi aprovado");
  assert.ok(!/10 dias .teis/i.test(semComentario), "nao ha mais relogio de analise correndo");
  assert.match(semComentario, /aprovado e online/, "o estado real e app aprovado");
});

test("nao apresenta o app de Ads do TikTok como coisa que existe", () => {
  // A frase tem de dizer que NAO foi feito. Sem isso, a pagina promete leitura
  // de desempenho que o produto nao tem como entregar.
  assert.match(semComentario, /ainda não foi feito/, "o cadastro do TikTok nao existe, e a pagina tem de dizer");
  // ⚠️ E a lista de passos com responsaveis SAIU inteira: checklist com "voce" e
  // "NEXO" ao lado de cada item e a forma visual de "isto esta em curso", e
  // nenhuma palavra dentro dela desfaz essa leitura.
  assert.ok(!/ads-passos/.test(semComentario), "checklist de passos descreve processo em andamento");
});

test("o alerta do GMV Max FICA — e correto e e o mais valioso da pagina", () => {
  // So uma conta pode ter a autorizacao por vez, e trocar ENCERRA as campanhas
  // da anterior. E o unico ponto da pagina onde um clique errado apaga dinheiro.
  assert.match(semComentario, /encerra as campanhas GMV Max da conta anterior/i);
  assert.match(semComentario, /não aceite sem falar com a gente antes/i);
});

test("tem DATA DE VERIFICACAO — a defesa contra envelhecer calada", () => {
  assert.match(semComentario, /verificado em 02\/09\/2026/i, "estado de terceiro precisa de carimbo");
  // E a frase que resolve a divergencia sem consultar ninguem.
  assert.match(semComentario, /o console está certo/i,
    "quando a pagina e o console discordam, quem esta velho e a pagina");
});
