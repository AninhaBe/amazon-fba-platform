// Uso: node --env-file=.env.local --experimental-strip-types \
//        --import ./scripts/ts-resolver.mjs scripts/overview-timing-probe.mjs
//
// SOMENTE LEITURA. Mede o custo da rota de overview NAS CONEXOES REAIS da Ana
// (UTILEIRA/Shopee, Amazon, Mercado Livre) nos 4 periodos do seletor.
//
// ⚠️ POR QUE ESTE SCRIPT EXISTE (licao de 28/08/2026): todas as medicoes
// anteriores de troca de periodo foram na conta DEMO — poucos pedidos. A conta
// real tem 22 mil pedidos so na Shopee. Numero de conta demo NAO representa a
// experiencia dela. Toda medicao de performance daqui pra frente diz em qual
// conta foi feita.
//
// Rodadas ALTERNADAS (ADR-017): frio e quente medidos separados, e os periodos
// intercalados entre rodadas — medir A tres vezes e depois B tres vezes compara
// cache frio com cache quente e mente a favor de quem mede.
// ⚠️ REGRA DE HIGIENE (28/08/2026): SCRIPT LOCAL CONTRA PRODUCAO NAO ABRE POOL
// DE 10. O pooler do Supabase tem pool_size 15 compartilhado com o app e os
// crons; duas sondas minhas com o max de 10 do db.ts derrubaram uma a outra com
// EMAXCONNSESSION. Ver ADR-028.
//
// Funciona apesar de os imports do ESM subirem para o topo porque o pool do
// db.ts e criado PREGUICOSAMENTE, na primeira consulta — e nenhuma consulta
// acontece antes desta linha.
process.env.DB_POOL_MAX = "3";

import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import { runWithAccount } from "../src/lib/accountContext.ts";
import { dbQuery } from "../src/lib/db.ts";

const WORKSPACE = process.env.PROBE_WORKSPACE_ID;
if (!WORKSPACE) throw new Error("PROBE_WORKSPACE_ID ausente.");

const RODADAS = Number(process.env.PROBE_RODADAS ?? 3);

function periodos() {
  const fim = new Date();
  const dias = [
    ["hoje", 0],
    ["7 dias", 7],
    ["15 dias", 15],
    ["30 dias", 30],
  ];
  return dias.map(([rotulo, n]) => {
    const inicio = new Date(fim);
    if (n === 0) inicio.setHours(0, 0, 0, 0);
    else inicio.setDate(inicio.getDate() - n);
    return { rotulo, from: inicio, to: fim };
  });
}

function mediana(valores) {
  const ordenado = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  return ordenado.length % 2 ? ordenado[meio] : (ordenado[meio - 1] + ordenado[meio]) / 2;
}

async function conexoesReais() {
  const rows = await dbQuery(
    `SELECT id, provider, display_name, status, metadata
       FROM workspace_integrations
      WHERE workspace_id = $1 AND status = 'connected'
        AND provider = ANY($2::text[])
      ORDER BY provider, connected_at`,
    [WORKSPACE, ["shopee", "amazon", "mercado_livre"]]
  );
  return rows;
}

const alvos = [];

async function carregarAlvos(conexoes) {
  const { getShopeeOverviewFromCanonical } = await import("../src/lib/integrations/shopeeOverviewCanonical.ts");
  const { getMercadoLivreOverviewFromCanonical } = await import("../src/lib/integrations/mercadoLivreOverviewCanonical.ts");
  const { getAmazonOverviewFromCanonical } = await import("../src/lib/integrations/amazonOverviewCanonical.ts");

  // A Amazon nao tem linha em `workspace_integrations` em nenhum workspace real
  // (token revogado), mas os pedidos dela ESTAO no canonico. Para medir o custo
  // de leitura desse volume, injetamos o sellerId pelo contexto de conta — o
  // mesmo caminho que a rota usa quando ha conta ativa. Nao chama a Amazon: a
  // leitura de overview e 100% banco.
  const sellerAmazon = process.env.PROBE_AMAZON_SELLER_ID;
  if (sellerAmazon) {
    const { getAmazonOverviewFromCanonical } = await import("../src/lib/integrations/amazonOverviewCanonical.ts");
    alvos.push({
      nome: `amazon · ${sellerAmazon}`,
      executar: (p) => runWithAccount({ sellerId: sellerAmazon, refreshToken: "" }, () =>
        getAmazonOverviewFromCanonical({ startISO: p.from.toISOString(), endISO: p.to.toISOString() })),
    });
  }

  for (const row of conexoes) {
    // `metadata` importa: o ML lê a alíquota de lá. Sem ele a sonda mede um
    // caminho que estoura antes das consultas — mediria zero e pareceria rápido.
    const conexao = {
      id: row.id,
      provider: row.provider,
      status: row.status,
      accountLabel: row.display_name,
      metadata: row.metadata ?? {},
    };
    const nome = `${row.provider} · ${row.display_name ?? row.id}`;
    if (row.provider === "shopee") {
      alvos.push({ nome, executar: (p) => getShopeeOverviewFromCanonical(conexao, { from: p.from, to: p.to }) });
    } else if (row.provider === "mercado_livre") {
      alvos.push({ nome, executar: (p) => getMercadoLivreOverviewFromCanonical(conexao, { from: p.from, to: p.to }) });
    } else if (row.provider === "amazon") {
      alvos.push({
        nome,
        executar: (p) => getAmazonOverviewFromCanonical({ startISO: p.from.toISOString(), endISO: p.to.toISOString() }),
      });
    }
  }
}

async function cronometrar(alvo, periodo) {
  const inicio = process.hrtime.bigint();
  let erro = null;
  try {
    await alvo.executar(periodo);
  } catch (err) {
    erro = err instanceof Error ? err.message : String(err);
  }
  const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
  return { ms, erro };
}

await runWithWorkspace(WORKSPACE, async () => {
  // Calibragem: quanto custa UM round-trip daqui ate o banco. A rota roda no
  // Fly (gru) e o banco esta em sa-east-1 — mesma metropole. Desta maquina o
  // caminho e mais longo, entao todo numero abaixo tem esta gordura embutida
  // por consulta, e o reporte precisa dizer isso.
  const rtt = [];
  for (let i = 0; i < 10; i += 1) {
    const t = process.hrtime.bigint();
    await dbQuery("SELECT 1", []);
    rtt.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  console.log(`RTT desta maquina ate o banco: mediana ${mediana(rtt).toFixed(1)}ms (min ${Math.min(...rtt).toFixed(1)}ms)`);

  const conexoes = await conexoesReais();
  console.log(`\nconexoes reais no workspace: ${conexoes.map((c) => `${c.provider}=${c.display_name ?? c.id}`).join(", ")}\n`);
  await carregarAlvos(conexoes);

  const lista = periodos();
  const frio = new Map();
  const quente = new Map();

  // FRIO: primeira visita de cada (alvo, periodo) — e o que a Ana sente ao abrir.
  for (const alvo of alvos) {
    for (const periodo of lista) {
      const { ms, erro } = await cronometrar(alvo, periodo);
      frio.set(`${alvo.nome}\0${periodo.rotulo}`, { ms, erro });
      console.log(`frio   ${alvo.nome.padEnd(34)} ${periodo.rotulo.padEnd(8)} ${ms.toFixed(0).padStart(6)}ms${erro ? `  ERRO: ${erro}` : ""}`);
    }
  }

  // QUENTE: rodadas alternando periodo a periodo, nunca o mesmo N vezes seguidas.
  for (let rodada = 1; rodada <= RODADAS; rodada += 1) {
    for (const periodo of lista) {
      for (const alvo of alvos) {
        const chave = `${alvo.nome}\0${periodo.rotulo}`;
        const { ms, erro } = await cronometrar(alvo, periodo);
        if (!quente.has(chave)) quente.set(chave, []);
        quente.get(chave).push({ ms, erro });
      }
    }
    console.log(`rodada quente ${rodada}/${RODADAS} concluida`);
  }

  console.log("\n== MEDIANA POR (CONEXAO, PERIODO) ==");
  for (const alvo of alvos) {
    for (const periodo of lista) {
      const chave = `${alvo.nome}\0${periodo.rotulo}`;
      const amostras = quente.get(chave) ?? [];
      const validas = amostras.filter((a) => !a.erro).map((a) => a.ms);
      const f = frio.get(chave);
      console.log(
        `${alvo.nome.padEnd(34)} ${periodo.rotulo.padEnd(8)} frio ${f.ms.toFixed(0).padStart(6)}ms  quente ${validas.length ? mediana(validas).toFixed(0).padStart(6) : "   n/a"}ms  (n=${validas.length}${amostras.some((a) => a.erro) ? `, ${amostras.filter((a) => a.erro).length} com erro` : ""})`
      );
    }
  }

  // O aquecimento sequencial: depois da primeira pintura, a tela busca os OUTROS
  // tres periodos em fila. O custo do aquecimento e a SOMA, nao a media.
  console.log("\n== AQUECIMENTO SEQUENCIAL (3 periodos em fila apos a primeira pintura) ==");
  for (const alvo of alvos) {
    for (const primeiro of lista) {
      const outros = lista.filter((p) => p.rotulo !== primeiro.rotulo);
      const soma = outros.reduce((acc, p) => {
        const amostras = (quente.get(`${alvo.nome}\0${p.rotulo}`) ?? []).filter((a) => !a.erro).map((a) => a.ms);
        return acc + (amostras.length ? mediana(amostras) : 0);
      }, 0);
      console.log(`${alvo.nome.padEnd(34)} abrindo em ${primeiro.rotulo.padEnd(8)} aquecimento leva ${(soma / 1000).toFixed(1)}s`);
    }
  }
});

process.exit(0);
