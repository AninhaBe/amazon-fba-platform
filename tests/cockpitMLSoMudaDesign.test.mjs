import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) =>
  codigo.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const ML = "src/app/components/MercadoLivreWorkspace.tsx";
const PECA = "src/app/components/CockpitDoResultado.tsx";

/**
 * ⚠️ A RESTRIÇÃO DA DONA FOI LITERAL (03/09/2026): *"SEM ALTERAÇÃO NENHUMA QUE
 * NÃO SEJA O DESIGN"*. Este arquivo é a guarda dessa frase.
 *
 * O risco de um redesenho não é ficar feio — é mudar um número de lugar e, no
 * caminho, mudar o número. Por isso as asserções abaixo olham para o que a peça
 * NÃO pode fazer: calcular, buscar, decidir condição.
 */

test("a peca do cockpit NAO calcula nada — ela so apresenta", async () => {
  const codigo = semComentarios(await fonte(PECA));
  // Nenhuma aritmética de dinheiro: a peça recebe valores prontos e formatados.
  for (const proibido of [/\/ 100/, /\* 100/, /toFixed\(/, /marginPct/, /estimatedProfit/]) {
    assert.ok(!proibido.test(codigo), `a peça passou a calcular: ${proibido}`);
  }
  // E não busca nada: sem fetch, sem hook de dados.
  assert.ok(!/fetch\(|useEffect|useState/.test(codigo), "a peça ganhou vida própria — ela é de apresentação");
});

test("a cascata OMITE parcela desconhecida em vez de desenhar zero", async () => {
  // ⚠️ `null ≠ 0` vale para a proporção como vale para o número: uma barra que
  // soma o que ninguém sabe mente com a autoridade de um desenho.
  const codigo = semComentarios(await fonte(PECA));
  assert.match(
    codigo,
    /parte\.valor != null && Math\.abs\(parte\.valor\) > 0/,
    "a cascata voltou a aceitar parcela desconhecida como fatia",
  );
});

test("os numeros da faixa saem dos MESMOS campos que a tela ja exibia", async () => {
  const codigo = semComentarios(await fonte(ML));
  const faixa = codigo.slice(codigo.indexOf("<CockpitDoResultado"), codigo.indexOf("/>", codigo.indexOf("parcelas=")));
  // Cada parcela tem de vir do produtor, não de uma conta nova na tela.
  // ⚠️ A ANCORA E O PAR `valor: <campo>,` — casar so o nome do campo
  // ficava verde com o valor multiplicado, porque o mesmo campo aparece tambem
  // no ROTULO da parcela. Duas ocorrencias, e a assercao achava a inocente.
  for (const campo of ["overview.profit.fees", "overview.profit.cogs", "overview.profit.sellerShipping", "overview.profit.taxes"]) {
    assert.ok(faixa.includes(`valor: ${campo},`), `a faixa deixou de ler ${campo} cru do produtor`);
  }
  // E a contagem de vendas é a mesma do cartão de pedidos.
  assert.ok(faixa.includes("overview.metrics.paidOrders"), "a contagem de vendas virou outra");
  // ⚠️ O lucro respeita `resultIncomplete`: enquanto falta custo, tarifa ou
  // imposto, ele é DESCONHECIDO. Mostrar o parcial em 44px seria a mentira mais
  // cara possível — o número grande é o que a pessoa lê primeiro.
  assert.ok(faixa.includes("lucro={resultIncomplete ? null : overview.profit.estimatedProfit}"),
    "o lucro incompleto passou a ser exibido como se fosse o resultado");
});

test("as PENDENCIAS sao as mesmas — mesma condicao, mesmo texto, mesmo destino", async () => {
  const codigo = semComentarios(await fonte(ML));
  const lista = codigo.slice(codigo.indexOf("const pendenciasDoCanal"), codigo.indexOf("];", codigo.indexOf("const pendenciasDoCanal")));
  for (const parte of [
    "semAliquota",
    "Cadastrar alíquota",
    "overview.metrics.productsWithoutCost > 0",
    "/mercado-livre/produtos",
    "overview.metrics.cancelledOrders > 0",
    "/mercado-livre/monitor",
    "critical.length > 0",
    "/mercado-livre/estoque",
  ]) {
    assert.ok(lista.includes(parte), `a pendência mudou de condição ou destino: ${parte}`);
  }
});

test("OS OUTROS TRES CANAIS NAO FORAM TOCADOS — o teste e do canal, nao do app", async () => {
  // ⚠️ A dona chamou o redesenho de TESTE e quer validar num canal antes de
  // mandar replicar. Se a peça vazasse para os outros, ela estaria validando
  // quatro telas achando que valida uma.
  for (const tela of [
    "src/app/(app)/amazon/page.tsx",
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/TikTokWorkspace.tsx",
  ]) {
    const codigo = semComentarios(await fonte(tela));
    assert.ok(!/CockpitDoResultado|LinhaDePendencias/.test(codigo), `${tela}: o redesenho vazou para um canal que não pediu`);
    // E eles continuam passando as próprias pendências pelo BriefingLead.
    // A forma de passar varia entre as telas (`acoes={[` numa, `acoes={` com
    // expressão noutra) — o que importa é que continuam passando.
    assert.match(codigo, /acoes=\{/, `${tela}: perdeu as ações do BriefingLead`);
  }
});

test("e o BriefingLead continua servindo os quatro — a peca compartilhada nao mudou", async () => {
  // O ML deixou de PASSAR ações; a capacidade continua no componente, intacta,
  // porque os outros três a usam.
  const briefing = semComentarios(await fonte("src/app/components/BriefingLead.tsx"));
  assert.match(briefing, /acoes/, "a capacidade de ações sumiu da peça compartilhada");
});

test("nenhuma classe do cockpit e usada sem existir no CSS", async () => {
  const codigo = (await fonte(PECA)) + (await fonte(ML));
  const css = await fonte("src/app/globals.css");
  // ⚠️ O BACKTICK CONTA: `className={`cockpit-chip${...}`}` nao tem aspas,
  // e a extracao que so olhava aspas deixava a classe fora da conferencia — a
  // quebra de renomear `.cockpit-chip` ficou verde por isso.
  const usadas = new Set([...codigo.matchAll(/["`](cockpit-[\w-]+)/g)].map((m) => m[1]));
  const FIM = [" ", ",", ":", ".", "{", String.fromCharCode(10)];
  const ausentes = [...usadas].filter((classe) => !FIM.some((fim) => css.includes("." + classe + fim)));
  assert.deepEqual(ausentes, [], `classes sem definição: ${ausentes.join(", ")}`);
});
