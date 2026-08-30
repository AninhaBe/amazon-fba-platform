// INSTRUMENTO DE ACEITE DA FRENTE "consolidar as idas ao banco" (TODO.md →
// Infra / performance). SOMENTE LEITURA.
//
// Uso:
//   node --env-file=.env.local --experimental-strip-types \
//        --import ./scripts/ts-resolver.mjs \
//        scripts/dashboard-diff-campo-a-campo.mjs capturar antes.json
//
//   node ... scripts/dashboard-diff-campo-a-campo.mjs comparar antes.json depois.json
//   node ... scripts/dashboard-diff-campo-a-campo.mjs comparar antes.json   # captura o depois na hora
//
// ⚠️ POR QUE ELE EXISTE, E POR QUE SAI JUNTO COM A FRENTE E NAO DEPOIS.
//
// O criterio de aceite da otimizacao NAO e "menos consultas": e a tela mostrar
// EXATAMENTE os mesmos numeros, campo por campo. Conferir isso a mao e como um
// campo passa despercebido — e otimizacao que muda numero e defeito com outro
// nome. Instrumento que chega depois da mudanca nao consegue capturar o ANTES,
// e sem o antes o criterio vira declaracao em vez de prova.
//
// ⚠️ ELE FALHA RUIDOSAMENTE. Divergencia sai como uma linha por campo, com o
// caminho e os DOIS valores, e o processo termina com codigo 1. Ele nao imprime
// dois JSONs para alguem comparar com o olho: era isso que a gente estava
// tentando parar de fazer.
//
// ⚠️ CONTA REAL, NUNCA A DEMO. A demo nao tem o dado que importa (tarifa real,
// anuncio, custo cadastrado), entao "igual na demo" nao prova nada. O script se
// recusa a rodar contra conexao marcada como demo.
//
// ⚠️ A FOTO QUE ELE GERA NAO ENTRA NO REPOSITORIO, E ELA NAO E PARA GUARDAR.
//
// Dado financeiro de producao no historico do git e para sempre: nao se apaga
// sem reescrever historia e vaza para qualquer clone. O que entra no repo e este
// script — reproduzivel, sem dado dentro.
//
// E a foto e INSTRUMENTO, nao artefato: ela precisa sobreviver da captura ate a
// comparacao, nao do projeto inteiro. Se o trabalho atravessar dias, RECAPTURE o
// antes com o codigo que estiver em producao — o codigo antigo esta vivo
// enquanto a mudanca nao subir. Foto velha e pior que foto nova: entre uma e
// outra o DADO muda, e um antes de tres dias atras compara periodos que ja nao
// existem. Guardar por muito tempo cria ilusao de rigor e entrega ruido.
//
// ⚠️ O QUE ELE PEGOU NA PRIMEIRA VEZ QUE RODOU (30/08/2026), antes do deploy:
//
//   `operator does not exist: text = uuid` — os TRES paineis caiam. Causa:
//   `workspace_id` e `uuid` na migration 0012 e `text` na 0016, e
//   `primeiroDiaComAnuncio` usava um `$1` so nas duas metades da consulta; o
//   Postgres infere o tipo do parametro pelo primeiro uso e a segunda comparacao
//   virava `text = uuid`. A SUITE NAO PEGOU: o teste que varre as duas tabelas
//   nao filtra por `workspace_id`, entao a consulta dele nunca esbarrava no
//   conflito. Quem pegou foi a captura contra o banco real, na estreia.
//
// ⚠️ E O DEFEITO IRMAO, que este script nao pegou mas a mesma sessao expos:
//
//   uma medicao de gasto com anuncio feita SEM filtro de `workspace_id` somou
//   dois inquilinos e reportou R$ 2.419,70 de anuncio no Mercado Livre "da
//   vendedora" — dinheiro do OUTRO workspace. O produto sempre filtrou; a
//   medicao e que nao filtrou. Por isso a captura aqui roda dentro de
//   `runWithWorkspace` e o `PROBE_WORKSPACE_ID` e obrigatorio: consulta de
//   diagnostico em app multi-inquilino sem escopo nao mede o que voce acha.
//
// ⚠️ REGRA DE HIGIENE (ADR-028): script local contra producao nao abre pool de
// 10 — o pooler tem pool_size 15 compartilhado com o app e os crons.
process.env.DB_POOL_MAX = "3";

import { writeFile, readFile } from "node:fs/promises";

const [modo, arquivoA, arquivoB] = process.argv.slice(2);
if (!["capturar", "comparar"].includes(modo)) {
  console.error("uso: ... dashboard-diff-campo-a-campo.mjs capturar <saida.json>");
  console.error("     ... dashboard-diff-campo-a-campo.mjs comparar <antes.json> [depois.json]");
  process.exit(2);
}

const WORKSPACE = process.env.PROBE_WORKSPACE_ID;
if (!WORKSPACE) throw new Error("PROBE_WORKSPACE_ID ausente — o script nao adivinha workspace.");

const { runWithWorkspace } = await import("../src/lib/workspaceScope.ts");
const { runWithAccount } = await import("../src/lib/accountContext.ts");
const { dbQuery } = await import("../src/lib/db.ts");

// ════════════════════════════════════════════════════════════════════════════
// PERIODOS: DIAS FECHADOS, DE PROPOSITO.
//
// "Hoje" muda embaixo da medicao — o gasto com anuncio do dia corrente cresce
// ate a meia-noite (docs/amazon-ads.md) e uma venda nova entra a qualquer
// momento. Comparar duas capturas com o dia corrente dentro produziria
// divergencia REAL que a otimizacao nao causou, o instrumento gritaria errado, e
// instrumento que grita errado e desligado na segunda vez.
// ════════════════════════════════════════════════════════════════════════════
function periodosFechados() {
  const ontem = new Date();
  ontem.setUTCHours(23, 59, 59, 999);
  ontem.setUTCDate(ontem.getUTCDate() - 1);
  return [7, 15, 30].map((dias) => {
    const inicio = new Date(ontem);
    inicio.setUTCDate(inicio.getUTCDate() - (dias - 1));
    inicio.setUTCHours(0, 0, 0, 0);
    return {
      rotulo: `${dias}d ate ${ontem.toISOString().slice(0, 10)}`,
      dias,
      startISO: inicio.toISOString(),
      endISO: ontem.toISOString(),
      from: inicio,
      to: ontem,
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// IMPRESSAO DIGITAL DO DADO DE BAIXO.
//
// Sem isto o instrumento e injusto: se um pedido novo, uma tarifa liquidada ou
// uma linha de anuncio entrar entre a captura do antes e a do depois, os
// numeros mudam SEM a otimizacao ter culpa — e o script culparia a otimizacao.
//
// Entao ele mede o substrato tambem. Divergencia na impressao digital nao e
// "reprovado": e "esta comparacao nao vale, capture o antes de novo".
// ════════════════════════════════════════════════════════════════════════════
async function impressaoDigital(periodo) {
  const [pedidos, tarifas, anuncio, custos] = await Promise.all([
    dbQuery(
      `SELECT COUNT(*)::text n, COALESCE(MAX(occurred_at)::text,'-') ultimo
         FROM workspace_channel_orders
        WHERE workspace_id=$1 AND occurred_at >= $2::timestamptz AND occurred_at <= $3::timestamptz`,
      [WORKSPACE, periodo.startISO, periodo.endISO],
    ),
    dbQuery(
      `SELECT COUNT(*)::text n, COALESCE(SUM(ABS(amount))::text,'0') soma
         FROM workspace_channel_order_fees WHERE workspace_id=$1`,
      [WORKSPACE],
    ),
    dbQuery(
      `SELECT COUNT(*)::text n, COALESCE(SUM(cost)::text,'0') soma
         FROM workspace_ad_product_metrics
        WHERE workspace_id=$1 AND day >= $2::date AND day <= $3::date`,
      [WORKSPACE, periodo.startISO.slice(0, 10), periodo.endISO.slice(0, 10)],
    ),
    dbQuery(
      `SELECT COUNT(*)::text n, COALESCE(MAX(updated_at)::text,'-') ultimo
         FROM workspace_product_costs WHERE workspace_id=$1`,
      [WORKSPACE],
    ),
  ]);
  return {
    pedidos: pedidos[0]?.n, ultimoPedido: pedidos[0]?.ultimo,
    linhasDeTarifa: tarifas[0]?.n, somaDeTarifa: tarifas[0]?.soma,
    linhasDeAnuncio: anuncio[0]?.n, somaDeAnuncio: anuncio[0]?.soma,
    custosCadastrados: custos[0]?.n, ultimoCusto: custos[0]?.ultimo,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// A CONTA REAL. Nenhum identificador hardcoded, e recusa explicita da demo.
// ════════════════════════════════════════════════════════════════════════════
async function contaAmazonReal() {
  const { getAccounts } = await import("../src/lib/accountStore.ts");
  const contas = await runWithWorkspace(WORKSPACE, () => getAccounts());
  const conta = contas[0];
  if (!conta) throw new Error("Sem conta Amazon em workspace_accounts para este workspace.");
  return conta;
}

async function conexaoMercadoLivreReal() {
  const linhas = await dbQuery(
    `SELECT id, metadata->>'demo' AS demo FROM workspace_integrations
      WHERE workspace_id=$1 AND provider='mercado_livre' AND status='connected'
      ORDER BY updated_at ASC LIMIT 1`,
    [WORKSPACE],
  );
  const linha = linhas[0];
  if (!linha) return null;
  if (linha.demo === "true") {
    throw new Error(
      "A conexao do Mercado Livre deste workspace esta marcada como DEMO. " +
      "A demo nao tem tarifa real, anuncio nem custo cadastrado: comparar nela nao prova nada.",
    );
  }
  const { getIntegration } = await import("../src/lib/integrations/integrationStore.ts");
  return runWithWorkspace(WORKSPACE, () => getIntegration(linha.id));
}

// ════════════════════════════════════════════════════════════════════════════
// CAPTURA. Chama os MESMOS produtores que as rotas chamam — nao um SELECT meu.
// Medir por um caminho proprio mediria o meu caminho, nao o da tela.
// ════════════════════════════════════════════════════════════════════════════
async function capturar() {
  const conta = await contaAmazonReal();
  const conexaoML = await conexaoMercadoLivreReal();
  console.log(`conta Amazon: marketplace ${conta.marketplace} (token nao exibido)`);
  console.log(`conexao ML:   ${conexaoML ? conexaoML.id : "nenhuma conectada"}`);

  const { getAmazonOverviewFromCanonical } = await import("../src/lib/integrations/amazonOverviewCanonical.ts");
  const { getProfitSummary } = await import("../src/lib/profit.ts");
  const { getMercadoLivreOverviewFromCanonical } = await import("../src/lib/integrations/mercadoLivreOverviewCanonical.ts");

  const superficies = {};
  for (const periodo of periodosFechados()) {
    const period = {
      startISO: periodo.startISO, endISO: periodo.endISO, days: periodo.dias,
      key: `${periodo.startISO}:${periodo.endISO}`, custom: true,
    };
    const capturado = await runWithWorkspace(WORKSPACE, () =>
      runWithAccount({ sellerId: conta.sellerId, refreshToken: conta.refreshToken }, async () => ({
        amazonOverview: await getAmazonOverviewFromCanonical(period).catch((e) => ({ ERRO: String(e?.message ?? e) })),
        amazonProfit: await getProfitSummary(period).catch((e) => ({ ERRO: String(e?.message ?? e) })),
        mercadoLivre: conexaoML
          ? await getMercadoLivreOverviewFromCanonical(conexaoML, {
              from: periodo.from, to: periodo.to, label: periodo.rotulo,
            }).catch((e) => ({ ERRO: String(e?.message ?? e) }))
          : null,
      })),
    );
    superficies[periodo.rotulo] = {
      impressaoDigital: await impressaoDigital(periodo),
      campos: achatar(capturado),
    };
    console.log(`  ${periodo.rotulo}: ${Object.keys(superficies[periodo.rotulo].campos).length} campos`);
  }
  return { workspace: WORKSPACE, capturadoEm: new Date().toISOString(), superficies };
}

// ════════════════════════════════════════════════════════════════════════════
// ACHATAMENTO.
//
// ⚠️ ARRAY COM ID E CASADO POR ID, NAO POR POSICAO. Uma consulta reescrita pode
// devolver a mesma lista em ordem diferente: comparando por indice, isso viraria
// N divergencias falsas e o ruido esconderia a divergencia de verdade. A ORDEM
// vira UM campo proprio (`__ordem`), entao reordenar aparece como um achado
// claro — que e o que ela e — em vez de vinte.
// ════════════════════════════════════════════════════════════════════════════
const CAMPOS_VOLATEIS = new Set([
  // Carimbos de "quando rodou", nao numeros da tela. Divergem por construcao
  // entre duas capturas e nao dizem nada sobre a otimizacao.
  "syncedAt", "updatedAt", "capturadoEm", "generatedAt", "adsAteDia",
]);

const idDe = (item) =>
  item?.sku ?? item?.id ?? item?.date ?? item?.orderId ?? item?.amazonOrderId ?? item?.asin ?? null;

function achatar(valor, prefixo = "", saida = {}) {
  if (valor === null || typeof valor !== "object") {
    saida[prefixo || "(raiz)"] = valor;
    return saida;
  }
  if (Array.isArray(valor)) {
    const ids = valor.map(idDe);
    if (ids.length && ids.every((id) => id != null) && new Set(ids).size === ids.length) {
      saida[`${prefixo}.__ordem`] = ids.join(" > ");
      valor.forEach((item, i) => achatar(item, `${prefixo}[${ids[i]}]`, saida));
    } else {
      saida[`${prefixo}.__tamanho`] = valor.length;
      valor.forEach((item, i) => achatar(item, `${prefixo}[${i}]`, saida));
    }
    return saida;
  }
  for (const [chave, v] of Object.entries(valor)) {
    if (CAMPOS_VOLATEIS.has(chave)) continue;
    achatar(v, prefixo ? `${prefixo}.${chave}` : chave, saida);
  }
  return saida;
}

// ════════════════════════════════════════════════════════════════════════════
// COMPARACAO. Uma linha por campo divergente, com os DOIS valores.
// ════════════════════════════════════════════════════════════════════════════
const mostrar = (v) => (v === undefined ? "(ausente)" : v === null ? "null" : JSON.stringify(v));

function compararCampos(antes, depois) {
  const achados = [];
  for (const chave of new Set([...Object.keys(antes), ...Object.keys(depois)])) {
    const a = antes[chave];
    const b = depois[chave];
    if (Object.is(a, b)) continue;
    // Numero: mostra a diferenca, que e o que decide se e arredondamento ou
    // dinheiro sumindo. Sem tolerancia embutida — quem decide o que e aceitavel
    // e uma pessoa olhando o delta, nao um epsilon escondido no script.
    const delta = typeof a === "number" && typeof b === "number"
      ? `  (delta ${(b - a) > 0 ? "+" : ""}${+(b - a).toFixed(4)})`
      : "";
    achados.push({ chave, a, b, linha: `${chave}\n      antes:  ${mostrar(a)}\n      depois: ${mostrar(b)}${delta}` });
  }
  return achados;
}

async function comparar(caminhoA, caminhoB) {
  const antes = JSON.parse(await readFile(caminhoA, "utf8"));
  const depois = caminhoB ? JSON.parse(await readFile(caminhoB, "utf8")) : await capturar();

  if (antes.workspace !== depois.workspace) {
    console.error(`REPROVADO: workspaces diferentes (${antes.workspace} vs ${depois.workspace}).`);
    process.exit(1);
  }

  let divergencias = 0;
  let substratoMudou = false;

  for (const rotulo of Object.keys(antes.superficies)) {
    const a = antes.superficies[rotulo];
    const b = depois.superficies[rotulo];
    if (!b) {
      console.error(`\n[${rotulo}] AUSENTE no depois — a captura nao cobriu o mesmo periodo.`);
      divergencias += 1;
      continue;
    }

    // ⚠️ O SUBSTRATO PRIMEIRO. Se o dado de baixo mudou, a comparacao de cima
    // NAO e sobre a otimizacao — e dizer isso e mais util que reprovar.
    const substrato = compararCampos(a.impressaoDigital, b.impressaoDigital);
    if (substrato.length) {
      substratoMudou = true;
      console.error(`\n[${rotulo}] ⚠️  O DADO MUDOU EMBAIXO — esta comparacao nao vale como prova:`);
      for (const s of substrato) console.error(`    ${s.linha}`);
    }

    const achados = compararCampos(a.campos, b.campos);
    if (achados.length) {
      divergencias += achados.length;
      console.error(`\n[${rotulo}] ${achados.length} campo(s) divergente(s):`);
      for (const achado of achados) console.error(`    ${achado.linha}`);
    } else {
      console.log(`[${rotulo}] ${Object.keys(a.campos).length} campos conferem.`);
    }
  }

  if (substratoMudou && !divergencias) {
    console.error("\nINCONCLUSIVO: nenhum campo divergiu, mas o dado de baixo mudou entre as capturas.");
    console.error("Capture o antes de novo com o codigo antigo e repita — antes desatualizado inventa progresso.");
    process.exit(1);
  }
  if (divergencias) {
    console.error(`\nREPROVADO: ${divergencias} campo(s) mudaram de valor.`);
    console.error("Otimizacao que muda numero e defeito com outro nome — nenhum destes pode subir.");
    process.exit(1);
  }
  console.log("\nAPROVADO: todos os campos batem, em todos os periodos.");
}

if (modo === "capturar") {
  if (!arquivoA) throw new Error("informe o arquivo de saida.");
  const foto = await capturar();
  await writeFile(arquivoA, JSON.stringify(foto, null, 2), "utf8");
  const total = Object.values(foto.superficies).reduce((n, s) => n + Object.keys(s.campos).length, 0);
  console.log(`\nfoto salva em ${arquivoA} — ${total} campos em ${Object.keys(foto.superficies).length} periodos.`);
} else {
  if (!arquivoA) throw new Error("informe o arquivo do ANTES.");
  await comparar(arquivoA, arquivoB);
}
process.exit(0);
