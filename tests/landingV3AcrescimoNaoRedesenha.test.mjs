import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) =>
  codigo.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const LANDING = "src/app/landing-v2/LandingV2Experience.tsx";
const FORM = "src/app/landing-v2/SolicitarOrcamento.tsx";
const CSS = "src/app/landing-v2/landing-v2.module.css";

/**
 * ⚠️ A v3 É ACRÉSCIMO, NÃO REDESENHO — regra da casa, e aqui ela tem prazo:
 * as duas seções são exigência da revisão da SP-API (caso 21846204931).
 * Uma landing que "melhorou de visual" no meio de uma revisão é uma variável a
 * mais numa conversa que já está com relógio correndo.
 */

test("as seções que já existiam continuam na página, na mesma ordem", async () => {
  const codigo = semComentarios(await fonte(LANDING));
  // A ancora inclui o FECHAMENTO da expressao (`}`): sem ele, `styles.process`
  // casa tambem `styles.processo`, e renomear a secao passaria despercebido.
  // Casamento por substring e o mesmo defeito de ancoragem do catalogo.
  const ordem = ["styles.intro}", "styles.priorities}", "styles.exploration}", "styles.support}", "styles.process}", "styles.measured}", "styles.finalCta}"];
  let cursor = -1;
  for (const secao of ordem) {
    const posicao = codigo.indexOf(secao);
    assert.ok(posicao > 0, `a seção ${secao} sumiu da landing`);
    assert.ok(posicao > cursor, `a seção ${secao} mudou de posição — isso é redesenho, não acréscimo`);
    cursor = posicao;
  }
});

test("ANÁLISE DE MARCAS: fala só da conta do vendedor, nunca de comprador", async () => {
  const codigo = await fonte(LANDING);
  assert.match(codigo, /Análise de marcas/, "a seção exigida pela revisão sumiu");
  assert.match(codigo, /termos de busca/i);
  assert.match(codigo, /comportamento de compra/i);

  // ⚠️ A PROIBIÇÃO LÊ O FONTE SEM COMENTÁRIOS — o comentário que explica por que
  // não se promete dado de comprador cita "dado de comprador"
  // (docs/achado-guarda-que-depende-da-forma.md, caso 1).
  const texto = semComentarios(codigo);
  for (const proibido of [/dados? de comprador(?!es)/i, /dados? dos concorrentes/i, /quem comprou/i]) {
    assert.ok(!proibido.test(texto), `a landing promete algo que a AUP 4.4/4.5 não permite: ${proibido}`);
  }
  // E a declaração explícita de escopo precisa estar na página, não só na nossa cabeça.
  assert.match(texto, /dados da conta conectada/i, "a página deixou de declarar que o dado é só da conta conectada");
});

test("PREÇOS: é orçamento, e a página NÃO publica preço", async () => {
  const codigo = semComentarios(await fonte(LANDING));
  assert.match(codigo, /id="pricing-title"/, "a seção de preços sumiu");
  assert.match(codigo, /or[çc]amento/i);

  // ⚠️ A decisão de publicar tabela NÃO foi tomada. Um "a partir de R$" que
  // aparecesse aqui comprometeria a decisão dela com um número não aprovado.
  assert.ok(!/a partir de R\$/i.test(codigo), "a landing passou a publicar preço, e essa decisão não foi tomada");
  assert.ok(!/R\$\s?\d/.test(codigo), "apareceu valor em reais na seção de preços");
});

test("o FORMULÁRIO pede os quatro campos combinados e não promete o que não sabe", async () => {
  const codigo = await fonte(FORM);
  for (const campo of [/name="nome"/, /name="email"/, /name="marketplaces"/, /name="faixaDePedidos"/]) {
    assert.match(codigo, campo, `o formulário perdeu o campo ${campo}`);
  }
  const texto = semComentarios(codigo);
  // O erro precisa oferecer o caminho alternativo — formulário que falha sem dar
  // o e-mail transforma interessado em desistente.
  assert.match(texto, /contato@nexoaihub\.com/, "o caminho alternativo sumiu da mensagem de erro");
  // Mas ele NAO pode ser concatenado as cegas: cinco mensagens da rota ja citam
  // o e-mail, e as que a pessoa mais ve (limite, chave ausente, falha de envio)
  // estao entre elas. A ancora e a RAMIFICACAO, nao a existencia da string.
  assert.match(
    texto,
    /estado\.mensagem\.includes\(CONTATO\) \? null :/,
    "o e-mail voltou a ser concatenado sempre — aparece duas vezes na mesma frase",
  );
  // E não pode dizer "enviado" sem o servidor ter confirmado.
  assert.match(texto, /if \(!resposta\.ok\)/, "o formulário deixou de conferir a resposta do servidor");
});

test("nenhuma classe nova é usada sem existir no CSS", async () => {
  const codigo = await fonte(LANDING) + await fonte(FORM);
  const css = await fonte(CSS);
  const usadas = new Set([...codigo.matchAll(/styles\.([a-zA-Z][\w]*)/g)].map((m) => m[1]));
  const ausentes = [...usadas].filter((classe) => !new RegExp(`\\.${classe}[\\s,:{]`).test(css));
  assert.deepEqual(ausentes, [], `classes usadas e nunca definidas: ${ausentes.join(", ")}`);
});
