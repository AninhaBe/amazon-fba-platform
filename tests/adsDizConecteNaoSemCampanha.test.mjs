import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) =>
  codigo.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const TELA = "src/app/(app)/ads/page.tsx";
const PECA = "src/app/components/ConectarAds.tsx";

/**
 * ⚠️ O DEFEITO QUE ISTO REPROVA (02/09/2026): quem nunca autorizou o Ads via
 * *"Nenhum produto anunciado neste período"* — a frase do caso CONECTADO E SEM
 * CAMPANHA. Para quem não conectou ela é falsa: afirma que a pessoa não
 * anunciou, quando o que falta é a autorização.
 *
 * 📌 E o efeito foi maior que uma frase errada: a aba pareceu "só da dona do
 * produto" por meses. O OAuth, o cron e a rota sempre foram por workspace — só
 * ela tinha autorizado porque ninguém mais achava o botão.
 *
 * É a família dos zeros que mentem, aplicada a um vazio: tela sem dado mostra o
 * estado real, nunca um silêncio que pareça "não vendeu nada".
 */

test("SEM NENHUMA CONEXAO a tela diz 'conecte' — nunca 'sem campanha'", async () => {
  const codigo = semComentarios(await fonte(TELA));

  // A ramificação é o que prova a separação dos dois silêncios. Casar só o
  // nome do componente ficaria verde com a condição invertida.
  assert.match(
    codigo,
    /\) : semNenhumaConexao \? \(\s*<ConectarAds faltando=\{canaisFaltando\} \/>/,
    "a tela voltou a dar a mesma resposta para os dois silêncios",
  );

  // E a condição precisa nascer do CAMPO do contrato, não de um palpite.
  assert.match(
    codigo,
    /const semNenhumaConexao = credenciais\.length > 0 && credenciais\.every\(\(canal\) => !canal\.conectado\)/,
    "a condição deixou de sair do estado da credencial",
  );
});

test("e COM conexao a frase de 'sem campanha' CONTINUA — ela estava certa nesse caso", async () => {
  // ⚠️ Metade da correção é não estragar o caso que já funcionava. Se o estado
  // de conexão engolisse os dois, quem conectou e não anunciou passaria a ver
  // "conecte seus anúncios" — a mentira inversa.
  const codigo = semComentarios(await fonte(TELA));
  assert.match(codigo, /title="Nenhum produto anunciado neste período"/, "a frase do caso conectado sumiu");
});

test("o botao leva para onde o CONTRATO manda, e por canal", async () => {
  const peca = semComentarios(await fonte(PECA));
  // ⚠️ Um destino fixo aqui devolveria o problema que o campo por canal
  // resolveu: a Amazon tem OAuth próprio de Ads e o ML usa a conexão de venda.
  assert.match(peca, /href=\{canal\.conectarEm\}/, "o destino virou fixo em vez de vir do contrato");
  assert.ok(!/href="\/api\/ads\/connect"/.test(peca), "o destino da Amazon foi escrito à mão na peça");
  assert.ok(!/href="\/integracoes"/.test(peca), "o destino do ML foi escrito à mão na peça");
  // Um botão por canal que falta — não um genérico.
  assert.match(peca, /faltando\.map\(\(canal\) =>/, "voltou a oferecer um botão só para os dois canais");
});

test("a instrucao que ninguem achava ganha porta de entrada", async () => {
  // `/ads/como-ligar` existia escrita e sem ninguém chegar nela. Este é o lugar
  // em que a pessoa está justamente procurando o caminho.
  const peca = semComentarios(await fonte(PECA));
  assert.match(peca, /href="\/ads\/como-ligar"/, "o link para a instrução sumiu");
});

test("a peca some quando nao ha nada a conectar", async () => {
  // Estado normal não gera aviso — a mesma regra que tirou o banner de "100%
  // sincronizada" dos quatro canais hoje de manhã.
  const peca = semComentarios(await fonte(PECA));
  assert.match(peca, /if \(faltando\.length === 0\) return null;/, "a peça passou a aparecer sem ter o que oferecer");
});

test("nenhuma classe nova e usada sem existir no CSS", async () => {
  const peca = await fonte(PECA);
  const css = await fonte("src/app/globals.css");
  const usadas = [...peca.matchAll(/className="([^"{]+)"/g)].flatMap((m) => m[1].split(/\s+/));
  // ⚠️ SEM REGEX MONTADA EM TEMPLATE LITERAL — quarta vez que essa forma
  // falha em silencio neste repo: dentro de template, `\.` vira `.` e `\s` vira
  // `s`, e a expressao deixa de casar o que promete. Comparacao literal, chata
  // e verificavel (docs/achado-guarda-que-depende-da-forma.md).
  //
  // E o DELIMITADOR e obrigatorio: procurar ".ads-conectar-botao" casa tambem
  // ".ads-conectar-botao-renomeado", e renomear a definicao passava
  // despercebido — foi o que deixou esta quebra verde na primeira rodada.
  const FIM = [" ", ",", ":", "{", String.fromCharCode(10)];
  const definida = (classe) => FIM.some((fim) => css.includes("." + classe + fim));
  const ausentes = usadas.filter((classe) => classe.startsWith("ads-") && !definida(classe));
  assert.deepEqual(ausentes, [], `classes sem definição: ${ausentes.join(", ")}`);
});
