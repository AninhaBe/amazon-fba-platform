import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { chaveDaSessao, comRenovacaoUnica, renovacoesEmVoo } from "../src/lib/supabase/renovacaoUnica.ts";

// 29/08/2026, 12:11Z: a dona nao conseguia entrar. Log com oito
// 'AuthApiError: Too many concurrent token refresh requests on the same session'
// em SEIS segundos. Nao era o Supabase (auth respondia em 169ms de dentro da
// maquina): era o app renovando o MESMO refresh token N vezes ao mesmo tempo.
// Refresh token e de uso unico e rotativo — a primeira rotaciona e as outras
// matam a sessao.

test("COMPORTAMENTO: N chamadas concorrentes da mesma sessao viram UMA so", async () => {
  let chamadas = 0;
  const renovar = async () => { chamadas += 1; await new Promise((r) => setTimeout(r, 30)); return "ok"; };
  const chave = "sessao-a";
  const todas = await Promise.all(Array.from({ length: 8 }, () => comRenovacaoUnica(chave, renovar)));
  // ⚠️ Este assert e o teste inteiro: se alguem quebrar a serializacao, aqui da 8.
  assert.equal(chamadas, 1, `esperava 1 renovacao, houve ${chamadas} — a serializacao caiu`);
  assert.deepEqual(todas, Array(8).fill("ok"), "todos recebem o resultado da primeira");
});

test("sessoes DIFERENTES nao compartilham renovacao", async () => {
  let chamadas = 0;
  const renovar = async () => { chamadas += 1; await new Promise((r) => setTimeout(r, 10)); return chamadas; };
  await Promise.all([comRenovacaoUnica("sessao-b", renovar), comRenovacaoUnica("sessao-c", renovar)]);
  assert.equal(chamadas, 2, "duas pessoas diferentes precisam de duas renovacoes");
});

test("sem chave (visitante sem sessao) executa direto, sem gargalo global", async () => {
  let chamadas = 0;
  const renovar = async () => { chamadas += 1; return "x"; };
  await Promise.all([comRenovacaoUnica(null, renovar), comRenovacaoUnica(null, renovar)]);
  assert.equal(chamadas, 2);
});

test("a promessa em voo SOME quando termina — senao a sessao congelaria no primeiro resultado", async () => {
  await comRenovacaoUnica("sessao-d", async () => "1");
  assert.equal(renovacoesEmVoo(), 0);
  const segundo = await comRenovacaoUnica("sessao-d", async () => "2");
  assert.equal(segundo, "2", "a segunda rodada precisa renovar de novo");
});

test("falha da primeira NAO derruba quem esperava — cada um tenta por conta", async () => {
  let chamadas = 0;
  const renovar = async () => {
    chamadas += 1;
    await new Promise((r) => setTimeout(r, 20));
    if (chamadas === 1) throw new Error("primeira falhou");
    return "recuperado";
  };
  const [a, b] = await Promise.allSettled([
    comRenovacaoUnica("sessao-e", renovar),
    new Promise((r) => setTimeout(r, 5)).then(() => comRenovacaoUnica("sessao-e", renovar)),
  ]);
  assert.equal(a.status, "rejected", "a primeira propaga o proprio erro");
  assert.equal(b.status, "fulfilled", "quem esperava tenta sozinho em vez de morrer junto");
});

test("ha TETO DE ESPERA — trocar 409 por espera infinita seria o erro silencioso", async () => {
  const fonte = await readFile(new URL("../src/lib/supabase/renovacaoUnica.ts", import.meta.url), "utf8");
  assert.match(fonte, /TETO_DE_ESPERA_MS/);
  assert.match(fonte, /AUTH_RENOVACAO_TIMEOUT_MS/, "ajustavel sem deploy");
  assert.match(fonte, /Promise\.race/);
});

test("a chave e HASH do cookie, nunca o valor — token de sessao nao mora em memoria de modulo", async () => {
  const a = chaveDaSessao([{ name: "sb-acesso", value: "segredo-1" }]);
  const b = chaveDaSessao([{ name: "sb-acesso", value: "segredo-2" }]);
  assert.ok(a && b && a !== b, "cookies diferentes, chaves diferentes");
  assert.doesNotMatch(String(a), /segredo/, "o valor do cookie nao pode aparecer na chave");
  assert.equal(chaveDaSessao([{ name: "outro", value: "x" }]), null, "sem cookie de sessao nao ha chave");
});

test("o caminho de autenticacao USA a serializacao", async () => {
  const ctx = await readFile(new URL("../src/lib/workspaceContext.ts", import.meta.url), "utf8");
  assert.match(ctx, /comRenovacaoUnica\(chave, \(\) => supabase\.auth\.getClaims\(\)\)/);
});

test("a mensagem de login so CULPA a credencial quando o erro E de credencial", async () => {
  const { mensagemDeFalhaDeLogin } = await import("../src/app/login/mensagemDeFalha.ts");
  // Credencial errada de verdade: a frase de sempre.
  assert.match(mensagemDeFalhaDeLogin({ status: 400, code: "invalid_credentials" }), /senha incorretos/);
  // ⚠️ 409 de renovacao concorrente NAO e culpa dela — foi o que a trancou
  // do lado de fora em 29/08/2026 enquanto a senha estava certa.
  const nossa = mensagemDeFalhaDeLogin({ status: 409, code: "conflict", message: "Too many concurrent token refresh requests" });
  assert.doesNotMatch(nossa, /senha incorretos/);
  assert.match(nossa, /o problema e nosso|problema é nosso/i);
  // E precisa dizer para NAO repetir: tentativa repetida dispara limite de taxa,
  // e ai a mensagem teria CRIADO o problema que descrevia.
  assert.match(nossa, /Nao precisa tentar de novo|não precisa tentar de novo/i);
  // Timeout de conexao ao banco: mesmo tratamento.
  assert.doesNotMatch(mensagemDeFalhaDeLogin({ message: "timeout exceeded when trying to connect" }), /senha incorretos/);
  // Limite de taxa: manda esperar, nunca tentar de novo.
  assert.match(mensagemDeFalhaDeLogin({ status: 429 }), /Aguarde/i);
});
