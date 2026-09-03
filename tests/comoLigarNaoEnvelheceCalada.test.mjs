import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const PAGINA = "src/app/(app)/ads/como-ligar/page.tsx";
const fonte = () => readFile(new URL(`../${PAGINA}`, import.meta.url), "utf8");
const semComentarios = (codigo) =>
  codigo.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * ⚠️ O DEFEITO QUE ISTO REPROVA (02/09/2026): esta página passou 26 dias
 * afirmando *"Esperando a aprovação deles"* sobre a Shopee — DEPOIS de o Go Live
 * ter sido aprovado. Ninguém mentiu: a frase era verdadeira quando foi escrita.
 *
 * 📌 É a família "estado de terceiro escrito": a página afirma com confiança o
 * que só se sabe abrindo o console de outra empresa. Sem carimbo de data, ela
 * envelhece calada — e a vendedora chegou nela justamente pela porta nova que a
 * aba de Ads abriu hoje.
 */

test("a Shopee nao esta mais 'esperando aprovacao' — o app foi medido online", async () => {
  const codigo = semComentarios(await fonte());
  // A proibição lê o fonte SEM COMENTÁRIOS: a nota que explica a correção cita
  // a frase corrigida (caso 1 do catálogo de ancoragem).
  assert.ok(!/Esperando a aprovação deles/.test(codigo), "a frase vencida voltou");
  assert.ok(!/10 dias úteis/.test(codigo), "o prazo de uma análise que já terminou voltou");
  assert.ok(!/relógios de aprovação que correm sozinhos/.test(codigo), "voltou a dizer que há relógio correndo");
  assert.match(codigo, /aprovado e online/, "o estado medido sumiu da página");
});

test("e a pagina CARIMBA quando foi verificada — senao ela envelhece calada de novo", async () => {
  const codigo = semComentarios(await fonte());
  assert.match(codigo, /Estado verificado em \d{2}\/\d{2}\/\d{4}/, "o carimbo de verificação sumiu");
  // ⚠️ O carimbo sozinho não basta: quem lê precisa saber quem ganha quando a
  // página e o console discordam. Sem essa frase, a data vira decoração.
  assert.match(codigo, /o console está certo/, "a regra de desempate sumiu do rodapé");
});

test("o alerta do GMV Max continua INTEIRO — e a informacao mais cara da pagina", async () => {
  // ⚠️ Só UMA conta pode ter a autorização por vez, e trocar ENCERRA as
  // campanhas da anterior. É o único ponto da página onde um clique errado apaga
  // campanha em produção. Corrigir texto vizinho não pode levá-lo junto.
  const codigo = semComentarios(await fonte());
  assert.match(codigo, /uma<\/b> conta de anúncios pode ter a autorização/, "o alerta do GMV Max foi diluído");
  assert.match(codigo, /encerra as campanhas GMV Max da conta anterior/, "a consequência do alerta sumiu");
});

test("a linha do TikTok DIZ que o cadastro nao existe — a resposta chegou", async () => {
  // ⚠️ ESTE TESTE FOI INVERTIDO EM 02/09/2026, e a inversao e o desenho dele.
  //
  // A versao anterior exigia que a linha "App de desenvolvedor na Marketing API"
  // ficasse INTACTA: nao havia evidencia de que o app existisse, nem de que NAO
  // existisse (podia ter sido criado fora do repo), e trocar por "ainda nao
  // solicitado" seria inventar o estado oposto. Guarda de espera, correta.
  //
  // A dona do produto respondeu, verbatim: *"nunca criei nada alem do que tem
  // hoje"*. A limitacao que justificava a espera morreu, e a guarda morre com
  // ela — se sobrevivesse, passaria a DEFENDER a pagina desatualizada, e quem
  // corrigisse quebraria a suite (AGENTS.md, "recusa temporaria").
  const codigo = semComentarios(await fonte());
  assert.match(codigo, /ainda não foi feito/, "a pagina tem de dizer que o cadastro nao existe");
  // ⚠️ E a LISTA DE PASSOS saiu inteira, nao ganhou um "ainda nao": checklist
  // com responsavel em cada item e a forma visual de "isto esta em curso", e
  // nenhuma palavra dentro dela desfaz essa leitura.
  assert.ok(!/ads-passos/.test(codigo), "checklist com responsaveis descreve processo em andamento");
});
