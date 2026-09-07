import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const raiz = new URL("../", import.meta.url);
const fonte = (caminho) => readFile(new URL(caminho, raiz), "utf8");
const semComentarios = (codigo) =>
  codigo
    .split(String.fromCharCode(13)).join("")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * ⚠️ A FAIXA DE AVALIACAO SAIU PORQUE A REGRA MUDOU — nao porque ninguem usava.
 * Esta distincao e o arquivo inteiro, e registra a INTENCAO INVERTIDA: ate a
 * tranca da assinatura, a faixa estava CERTA e era util.
 *
 * O que mudou em 07/09/2026: `decidirAcesso` passou a liberar so ADMIN ou
 * `assinatura.status === "ativa"`. Trial deixou de dar acesso. A partir dai a
 * peca mentia nos DOIS ramos, e o vivo era o pior:
 *
 *   ramo "vencido" -> morto para usuario normal (a tranca redireciona antes da
 *     casca montar). So um ADMIN, que passa sem olhar assinatura, ainda o
 *     alcancaria — e ele morre junto com a peca.
 *
 *   ramo "nao vencido" -> VIVO E FALSO. `getTrial()` devolve trial sempre que o
 *     workspace tem um `endsAt` guardado, independente da tranca. Quem fez trial
 *     e DEPOIS assinou lia "3 dias restantes de avaliacao — Acesso liberado ate
 *     10/09": o acesso dela nao vinha do trial e nao terminava naquele dia. Se
 *     cancelasse a assinatura no dia 8 achando que tinha avaliacao ate o 10,
 *     perderia acesso na hora.
 *
 * E a familia que o AGENTS.md nomeia: afirmacao verdadeira morre junto com a
 * regra que a sustentava, e divergencia COM MENTIRA e defeito, nao divida.
 *
 * ⚠️ E A ROTA CONTINUA DE PE DE PROPOSITO. `/api/trial` e `src/lib/trial.ts` sao
 * do backend; o dado pode servir a relatorio mesmo sem faixa. O que saiu foi o
 * CONSUMO na tela — nao o registro.
 */

test("nenhuma tela fala de periodo de avaliacao", async () => {
  const componentes = await readdir(new URL("src/app/components/", raiz));
  assert.ok(!componentes.includes("TrialNotice.tsx"), "a peca voltou para a arvore");

  // ⚠️ A PROIBICAO LE O FONTE SEM COMENTARIOS: a nota que explica a
  // remocao cita o nome removido. E a armadilha que ja pegou este projeto
  // quatro vezes, e por isso ela e obrigatoria em toda assercao que PROIBE.
  const casca = semComentarios(await fonte("src/app/components/AppShell.tsx"));
  assert.ok(!casca.includes("TrialNotice"), "a casca voltou a montar a faixa de avaliacao");

  // ⚠️ COM DELIMITADOR: procurar "trial" solto casaria `industrial`,
  // `trialha` e qualquer palavra que o contenha. O que interessa e a CLASSE.
  const css = (await fonte("src/app/globals.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!css.includes(".trial-"), "sobrou CSS da faixa de avaliacao sem ninguem para vestir");
});

test("o que decide o ACESSO nao consulta trial — e e por isso que a faixa mentia", async () => {
  // ⚠️ ESTA ASSERCAO E A RAZAO DA REMOCAO, e nao a remocao em si. Se um dia
  // o trial voltar a dar acesso, ela cai — e ai a faixa pode voltar, porque
  // voltaria a dizer a verdade. Sem esta guarda, alguem reintroduziria a peca
  // num mundo onde ela ainda mente, ou a manteria fora num mundo onde ela
  // voltou a fazer sentido.
  const acesso = semComentarios(await fonte("src/lib/billing/acesso.ts"));
  const decisao = acesso.slice(acesso.indexOf("export function decidirAcesso"), acesso.indexOf("export function textoDoBloqueio"));

  assert.ok(!decisao.includes("trial"),
    "`decidirAcesso` voltou a consultar trial: se o trial libera acesso de novo, a faixa volta a dizer a verdade e a remocao precisa ser revista");
  assert.ok(decisao.includes('entrada.assinatura.status === "ativa"'),
    "a regra de liberacao mudou de forma — reveja se a faixa de avaliacao ainda mente");
});
