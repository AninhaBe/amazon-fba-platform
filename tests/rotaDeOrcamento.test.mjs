import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "../scripts/ts-resolver.mjs";

// ⚠️ A ROTA DE ORÇAMENTO É PÚBLICA, SEM SESSÃO — o que chega nela é texto de
// estranho, e a validação da tela não protege nada (qualquer um posta direto).
//
// 📌 ESTES TESTES CHAMAM A DECISÃO DE VERDADE e conferem o que ela RESPONDE.
// Casar o fonte provaria só que as palavras existem — e a família inteira de
// testes decorativos deste projeto nasceu disso (AGENTS.md). Foi por isso que a
// regra saiu de dentro do `route.ts`: o runner não resolve `next/server`, então
// um teste do arquivo da rota SÓ conseguiria ler o fonte.
//
// O envio é injetado, então nenhum teste toca a rede nem manda e-mail.

const {
  processarPedidoDeOrcamento,
  zerarContadores,
  textoDoEmail,
  LIMITE_POR_IP,
  DESTINO,
} = await import("../src/app/api/contato/orcamento/pedidoDeOrcamento.ts");

const VALIDO = {
  nome: "Ana Beatriz",
  email: "ana@exemplo.com.br",
  marketplaces: ["Amazon", "Shopee"],
  faixaDePedidos: "100 a 500 pedidos/mês",
};

const AGORA = 1_756_000_000_000;
let contadorDeIp = 0;

/** Cada chamada usa IP próprio: senão o teto do caso anterior contamina o seguinte. */
function pedir(corpo, opcoes = {}) {
  const enviados = [];
  const promessa = processarPedidoDeOrcamento({
    corpoBruto: opcoes.cru !== undefined ? opcoes.cru : JSON.stringify(corpo),
    ip: opcoes.ip ?? `10.0.0.${++contadorDeIp}`,
    agora: opcoes.agora ?? AGORA,
    chave: opcoes.chave === undefined ? "chave-de-teste" : opcoes.chave,
    enviar: async (pedido) => { enviados.push(pedido); return opcoes.falha ?? null; },
  });
  return promessa.then((resultado) => ({ ...resultado, enviados }));
}

test("pedido valido envia e responde 200", async () => {
  zerarContadores();
  const r = await pedir(VALIDO);
  assert.equal(r.status, 200);
  assert.equal(r.enviados.length, 1, "o pedido valido tem de chegar ao envio");
  assert.deepEqual(r.enviados[0].marketplaces, ["Amazon", "Shopee"]);
});

test("SEM CREDENCIAL a rota NAO finge que enviou", async () => {
  zerarContadores();
  const r = await pedir(VALIDO, { chave: null });
  // 503, nao 200: responder sucesso sem enviar faz o pedido sumir sem ninguem
  // saber, que e pior do que a landing sem formulario.
  assert.equal(r.status, 503);
  assert.equal(r.enviados.length, 0, "nao pode nem tentar enviar sem chave");
  assert.match(r.corpo.error, new RegExp(DESTINO.replace(".", "\\.")),
    "o caminho alternativo tem de ir junto");
});

test("falha do provedor vira frase dizivel — o detalhe NAO vaza para a tela", async () => {
  zerarContadores();
  const r = await pedir(VALIDO, { falha: "Resend respondeu 401: {\"name\":\"validation_error\",\"key\":\"re_abc123\"}" });
  assert.equal(r.status, 502);
  assert.ok(!/re_abc123|validation_error|Resend/.test(r.corpo.error),
    "chave, nome de provedor e corpo de erro nao podem aparecer para a pessoa");
  assert.match(r.corpo.error, /Escreva para/);
});

test("RECUSA o que a tela nao mandaria — nome, e-mail e vocabulario", async (t) => {
  const casos = [
    ["nome vazio", { ...VALIDO, nome: "" }],
    ["nome de 1 letra", { ...VALIDO, nome: "A" }],
    ["nome gigante", { ...VALIDO, nome: "x".repeat(121) }],
    ["nome ausente", { email: VALIDO.email, marketplaces: VALIDO.marketplaces, faixaDePedidos: VALIDO.faixaDePedidos }],
    ["e-mail sem arroba", { ...VALIDO, email: "ana.exemplo.com" }],
    ["e-mail sem ponto no dominio", { ...VALIDO, email: "ana@exemplo" }],
    ["e-mail com espaco", { ...VALIDO, email: "an a@exemplo.com" }],
    ["e-mail gigante", { ...VALIDO, email: `${"a".repeat(200)}@x.com` }],
    ["nenhum canal", { ...VALIDO, marketplaces: [] }],
    ["so canal desconhecido", { ...VALIDO, marketplaces: ["Magalu"] }],
    ["marketplaces nao e lista", { ...VALIDO, marketplaces: "Amazon" }],
    ["faixa fora da lista", { ...VALIDO, faixaDePedidos: "Uns 10 mil" }],
    ["faixa vazia", { ...VALIDO, faixaDePedidos: "" }],
    ["numero no lugar de texto", { ...VALIDO, nome: 42 }],
  ];
  for (const [nome, corpo] of casos) {
    await t.test(nome, async () => {
      zerarContadores();
      const r = await pedir(corpo);
      assert.equal(r.status, 400, `${nome} tinha de ser recusado`);
      assert.equal(r.enviados.length, 0, `${nome} nao pode disparar e-mail`);
      assert.ok(typeof r.corpo.error === "string" && r.corpo.error.length > 0, "erro precisa ser dizivel");
    });
  }
});

test("o canal desconhecido e DESCARTADO, nao repassado ao e-mail", async () => {
  zerarContadores();
  const r = await pedir({ ...VALIDO, marketplaces: ["Amazon", "<script>alert(1)</script>", "Magalu"] });
  assert.equal(r.status, 200);
  // A prova e o que CHEGOU ao envio, nao o que a funcao diz fazer.
  assert.deepEqual(r.enviados[0].marketplaces, ["Amazon"]);
  assert.ok(!textoDoEmail(r.enviados[0]).includes("script"), "texto de estranho nao entra no e-mail");
});

test("RECUSA quebra de linha — e assim que se injeta cabecalho de e-mail", async () => {
  // Um `\nBcc:` no meio de um valor vira cabecalho. O `email` ainda alimenta o
  // `reply_to`, entao os dois campos sao conferidos.
  for (const corpo of [
    { ...VALIDO, nome: "Ana\nBcc: alvo@exemplo.com" },
    { ...VALIDO, nome: "Ana\r\nBcc: alvo@exemplo.com" },
    { ...VALIDO, email: "ana@exemplo.com\nBcc: alvo@exemplo.com" },
  ]) {
    zerarContadores();
    const r = await pedir(corpo);
    assert.equal(r.status, 400);
    assert.equal(r.enviados.length, 0);
  }
});

test("RECUSA corpo gigante e JSON invalido, sem estourar", async () => {
  zerarContadores();
  const gigante = await pedir(null, { cru: JSON.stringify({ ...VALIDO, nome: "x".repeat(20_000) }) });
  assert.equal(gigante.status, 413, "payload gigante nao pode nem ser processado");
  const quebrado = await pedir(null, { cru: "{isto nao e json" });
  assert.equal(quebrado.status, 400);
  const lista = await pedir(null, { cru: "[1,2,3]" });
  assert.equal(lista.status, 400, "array no lugar de objeto tambem e recusado");
  const nulo = await pedir(null, { cru: null });
  assert.equal(nulo.status, 400);
});

test("TETO POR IP: barra depois do limite, e SO o IP que estourou", async () => {
  zerarContadores();
  const ip = "10.9.9.9";
  for (let i = 0; i < LIMITE_POR_IP; i += 1) {
    const ok = await pedir(VALIDO, { ip });
    assert.equal(ok.status, 200, `o pedido ${i + 1} tinha de passar`);
  }
  const barrado = await pedir(VALIDO, { ip });
  assert.equal(barrado.status, 429, "o pedido seguinte do mesmo IP tem de ser barrado");
  assert.equal(barrado.enviados.length, 0, "barrado nao envia");
  assert.match(barrado.corpo.error, /escreva direto para/i,
    "barrar sem dar saida transforma interessado em desistente");
  const outro = await pedir(VALIDO, { ip: "10.9.9.10" });
  assert.equal(outro.status, 200, "o teto e POR IP");
});

test("pedido RECUSADO nao gasta a cota de quem vai corrigir e reenviar", async () => {
  // Quem erra o e-mail e conserta nao pode ser barrado por causa das proprias
  // tentativas invalidas — o limite existe contra flood, nao contra engano.
  zerarContadores();
  const ip = "10.9.9.11";
  for (let i = 0; i < LIMITE_POR_IP + 3; i += 1) {
    const r = await pedir({ ...VALIDO, email: "sem-arroba" }, { ip });
    assert.equal(r.status, 400);
  }
  const bom = await pedir(VALIDO, { ip });
  assert.equal(bom.status, 200, "depois de varias recusas, o pedido correto ainda passa");
});

test("a JANELA expira: o mesmo IP volta a poder depois de uma hora", async () => {
  zerarContadores();
  const ip = "10.9.9.12";
  for (let i = 0; i < LIMITE_POR_IP; i += 1) await pedir(VALIDO, { ip });
  assert.equal((await pedir(VALIDO, { ip })).status, 429);
  const depois = await pedir(VALIDO, { ip, agora: AGORA + 61 * 60 * 1000 });
  assert.equal(depois.status, 200, "passada a janela, o limite solta");
});

test("o e-mail sai em TEXTO PURO com todos os campos", async () => {
  // Texto puro em vez de HTML escapado: sem HTML nao ha injecao de HTML, e a
  // decisao nao depende de o escape estar certo em todo caminho futuro.
  const corpo = textoDoEmail(VALIDO);
  assert.ok(!/[<>]/.test(corpo), "nada de marcacao no corpo do e-mail");
  for (const trecho of [VALIDO.nome, VALIDO.email, "Amazon, Shopee", VALIDO.faixaDePedidos]) {
    assert.ok(corpo.includes(trecho), `o e-mail precisa conter: ${trecho}`);
  }
});

test("a rota esta na lista de publicas, senao o formulario recebe 401", async () => {
  // Medido em 31/08/2026 contra producao: rota fora da lista devolve 401 do
  // proxy ANTES de chegar no roteador. Sem esta linha o formulario falharia
  // sempre, e a pessoa veria a frase generica do cliente.
  const proxy = await readFile(new URL("../src/lib/supabase/proxy.ts", import.meta.url), "utf8");
  assert.ok(proxy.includes('  "/api/contato/orcamento",'),
    "a rota publica precisa estar em publicPaths");
});

test("o remetente e do NOSSO dominio, e a pessoa vai em reply_to", async () => {
  // Enviar "de" um endereco de terceiro e falsificacao de remetente: o SPF/DKIM
  // dele nao cobre o nosso envio, cai em spam e queima a nossa reputacao.
  const rota = await readFile(new URL("../src/app/api/contato/orcamento/route.ts", import.meta.url), "utf8");
  assert.ok(rota.includes("        from: REMETENTE,"), "o from tem de ser a constante do nosso dominio");
  assert.ok(rota.includes("        reply_to: pedido.email,"), "a pessoa entra em reply_to");
  const codigo = rota.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(codigo, /from:\s*pedido\.email/, "nunca enviar 'de' quem preencheu");
});

test("o remetente esta no dominio VERIFICADO, e o destinatario nao precisa ser", async () => {
  // 🔴 FALHA MEDIDA EM PRODUCAO (02/09/2026), com a chave ja publicada:
  //   403 This API key is not authorized to send emails from nexoaihub.com
  //
  // Quem autoriza o envio e o dominio VERIFICADO no provedor — o `.com.br`,
  // verificado desde 26/08 —, e a chave e restrita a ele por privilegio minimo.
  // A primeira versao usou o `.com` porque e o endereco que a empresa divulga:
  // "o e-mail da empresa" e "o dominio que pode enviar" nao sao a mesma coisa.
  const { REMETENTE, DESTINO } = await import("../src/app/api/contato/orcamento/pedidoDeOrcamento.ts");
  assert.match(REMETENTE, /@nexoaihub\.com\.br>$/,
    "o remetente tem de estar no dominio verificado (.com.br), senao o provedor recusa com 403");
  // E o destinatario continua no .com de proposito: receber nao exige
  // verificacao, e e a caixa que a dona do produto le.
  assert.equal(DESTINO, "contato@nexoaihub.com");
});
