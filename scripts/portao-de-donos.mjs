#!/usr/bin/env node
// Portão de commit: barra quando um commit leva junto o trabalho de outro dono.
//
// ⚠️ NASCEU DE DUAS COLISÕES REAIS em 29/08/2026, com poucas horas de diferença —
// às 3h e às 15h30, e nas duas o trabalho de um agente subiu dentro do commit do
// outro sem ninguém perceber na hora. Ver `docs/donos-da-arvore.md`.
//
// Roda no `commit-msg` porque precisa das DUAS coisas ao mesmo tempo: os
// arquivos no stage e a mensagem, para reconhecer o escape `cruza-areas:`.
//
// A lógica é pura e exportada para o teste — hook sem teste é a próxima coisa
// que quebra em silêncio, e hoje já provou que instrumento sem verificação engana.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const COMPARTILHADO = "compartilhado";

/**
 * Lê o mapa do documento versionado, e não de dentro deste script: a outra dona
 * precisa poder abrir, ler e discordar sem mexer em código.
 *
 * Formato reconhecido, uma linha por regra:
 *   - `caminho/` → agente
 */
export function lerMapa(markdown) {
  const regras = [];
  for (const linha of markdown.split("\n")) {
    const casou = linha.match(/^-\s+`([^`]+)`\s*→\s*([a-z][\w-]*)\s*$/u);
    if (casou) regras.push({ caminho: casou[1], dono: casou[2] });
  }
  // Prefixo mais longo primeiro: `src/app/api/` tem que ganhar de `src/app/`.
  return regras.sort((a, b) => b.caminho.length - a.caminho.length);
}

/** O dono de um arquivo, ou `compartilhado` quando nenhuma regra casa. */
export function donoDe(regras, arquivo) {
  const normalizado = arquivo.replaceAll("\\", "/");
  const regra = regras.find((r) => normalizado.startsWith(r.caminho));
  return regra ? regra.dono : COMPARTILHADO;
}

/**
 * Avalia um commit. Devolve `{ ok, donos, porDono, temEscape }`.
 *
 * `compartilhado` nunca cruza com ninguém: documentação e teste acompanham quem
 * escreveu o código, e barrar um commit por causa de um `.md` seria o atrito que
 * faz a cerca virar coisa que se contorna.
 */
export function avaliarCommit({ arquivos, mensagem, regras }) {
  const porDono = new Map();
  for (const arquivo of arquivos) {
    const dono = donoDe(regras, arquivo);
    if (dono === COMPARTILHADO) continue;
    if (!porDono.has(dono)) porDono.set(dono, []);
    porDono.get(dono).push(arquivo);
  }
  const donos = [...porDono.keys()].sort();
  const temEscape = /^cruza-areas:\s*\S+/mu.test(mensagem ?? "");
  return { ok: donos.length <= 1 || temEscape, donos, porDono, temEscape };
}

/**
 * A mensagem de erro diz O QUE FAZER, não só que barrou — a gente passou o dia
 * de 29/08 consertando mensagens que constatam e não ajudam.
 */
export function mensagemDeBloqueio({ donos, porDono }) {
  const linhas = [
    "",
    "COMMIT BARRADO: este commit mistura trabalho de mais de um dono.",
    "",
  ];
  for (const dono of donos) {
    linhas.push(`  ${dono}:`);
    for (const arquivo of porDono.get(dono)) linhas.push(`    ${arquivo}`);
  }
  linhas.push(
    "",
    "O QUE FAZER — uma das duas:",
    "",
    "  1. DIVIDA em dois commits, por caminho explícito:",
    `       git reset && git add <arquivos de ${donos[0]}> && git commit -m "..."`,
    `       git add <arquivos de ${donos[1] ?? "outro dono"}> && git commit -m "..."`,
    "",
    "  2. Se a mudança é de CONTRATO e precisa ser ATÔMICA — dividir deixaria um",
    "     commit em que a tela mente ou o código não compila — acrescente à",
    "     mensagem a linha:",
    "",
    "       cruza-areas: <motivo em uma frase>",
    "",
    "     O critério NÃO é urgência nem tamanho. Ver docs/donos-da-arvore.md.",
    "",
  );
  return linhas.join("\n");
}

// ---- Execução como hook -----------------------------------------------------

function principal() {
  const caminhoDaMensagem = process.argv[2];
  if (!caminhoDaMensagem) {
    console.error("portao-de-donos: caminho da mensagem de commit ausente.");
    process.exit(1);
  }
  const raiz = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const regras = lerMapa(readFileSync(`${raiz}/docs/donos-da-arvore.md`, "utf8"));
  const arquivos = execFileSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf8" })
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean);
  const mensagem = readFileSync(caminhoDaMensagem, "utf8");

  const resultado = avaliarCommit({ arquivos, mensagem, regras });
  if (resultado.ok) return;
  console.error(mensagemDeBloqueio(resultado));
  process.exit(1);
}

// Só roda como hook quando invocado direto; o teste importa as funções puras.
if (process.argv[1] && process.argv[1].endsWith("portao-de-donos.mjs")) principal();
