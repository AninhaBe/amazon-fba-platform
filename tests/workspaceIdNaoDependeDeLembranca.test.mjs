import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// 29/08/2026 — a cerca que faltava, e ela e a mais grave da fila.
//
// A regra "toda leitura passa pelo escopo do workspace" depende hoje de cada
// consulta LEMBRAR do WHERE workspace_id. E a mesma fragilidade das oito rotas
// com after() que ninguem marcou como fundo — so que aqui o preco de esquecer
// nao e lentidao: e VAZAMENTO ENTRE INQUILINOS. after() esquecido derruba a tela
// e a gente descobre em horas; workspace_id esquecido mostra o dado de um
// cliente para outro e pode nunca ser descoberto.
//
// Medido no dia: 282 consultas com SQL literal, 273 com o filtro, 9 sem — e as
// nove legitimas, uma a uma. O risco nao era o presente: era a 274a, escrita
// amanha por alguem que nao sabe da regra. A cerca existe para ela.

const RAIZ = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/**
 * Consultas que legitimamente NAO filtram por workspace, com o MOTIVO de cada
 * uma. Allowlist sem motivo vira o lugar onde se joga o que incomoda — e a
 * proxima pessoa nao tem como saber se a linha ali e uma decisao ou um descuido.
 */
const SEM_ESCOPO_PERMITIDO = [
  {
    arquivo: "lib/db.ts",
    motivo: "to_regclass: checa se a TABELA existe, nao le dado de ninguem.",
  },
  {
    arquivo: "lib/metricas.ts",
    motivo:
      "Agregado operacional ENTRE inquilinos por desenho (ADR-024): é o que /admin usa, e a rota tem allowlist de e-mail no servidor. Nenhum dado identificavel sai daqui.",
  },
  {
    arquivo: "lib/retencao.ts",
    motivo:
      "Expurgo por IDADE (ADR-016). Retencao e global por natureza: apagar so o do inquilino da vez deixaria a tabela crescendo para todos os outros.",
  },
  {
    arquivo: "lib/integrations/silencioDoWebhook.ts",
    motivo:
      "Pergunta de PLATAFORMA, nao de inquilino: 'o webhook do ML esta entregando?'. Le so max(received_at) — um TIMESTAMP agregado, sem id, sem valor, sem pedido. E o /api/health nao tem workspace autenticado para filtrar, por construcao. Escopar por inquilino aqui nao tornaria nada mais seguro e tornaria o alarme cego ao que ele existe para ver: o canal parou para TODO MUNDO. Justificativa medida em 01/09/2026 — cinco silencios acima de 60h em 41 dias, o maior de 236h, que custou 7 pedidos.",
  },
  {
    arquivo: "lib/watchlist.ts",
    motivo: "Calculo de datas de corte no banco (CURRENT_DATE). Nao toca tabela nenhuma.",
  },
  {
    arquivo: "lib/billing/runtime.ts",
    motivo:
      "Evento da Stripe, chaveado por event_id — a identidade e do EVENTO, nao do inquilino. O vinculo com workspace acontece depois, ja dentro do escopo.",
  },
];

const TABELA_DE_INQUILINO = /\b(FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+(workspace_\w+)/i;

async function arquivosTs(dir) {
  const encontrados = [];
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) encontrados.push(...(await arquivosTs(caminho)));
    else if (/\.tsx?$/.test(entrada.name)) encontrados.push(caminho);
  }
  return encontrados;
}

test("toda consulta a tabela de inquilino filtra por workspace_id", async () => {
  const permitidos = new Set(SEM_ESCOPO_PERMITIDO.map((e) => e.arquivo.replaceAll("/", path.sep)));
  const semEscopo = [];

  for (const arquivo of await arquivosTs(RAIZ)) {
    const relativo = path.relative(RAIZ, arquivo);
    if (permitidos.has(relativo)) continue;
    const fonte = await readFile(arquivo, "utf8");
    for (const bruto of fonte.match(/`[^`]*`/g) ?? []) {
      const sql = bruto.slice(1, -1);
      if (!TABELA_DE_INQUILINO.test(sql)) continue;
      if (/workspace_id/i.test(sql)) continue;
      // Fragmento reaproveitado (constante montada e interpolada noutra consulta)
      // nao carrega o filtro sozinho — quem filtra e a consulta que o usa.
      if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)) continue;
      semEscopo.push(`${relativo}: ${sql.replace(/\s+/g, " ").trim().slice(0, 90)}…`);
    }
  }

  assert.deepEqual(
    semEscopo,
    [],
    "consulta a tabela de inquilino sem WHERE workspace_id — isto vaza dado entre clientes:\n" +
      semEscopo.join("\n") +
      "\n\nSe for legitima, acrescente em SEM_ESCOPO_PERMITIDO COM O MOTIVO escrito."
  );
});

test("cada excecao da allowlist tem motivo escrito", () => {
  for (const entrada of SEM_ESCOPO_PERMITIDO) {
    assert.ok(entrada.motivo && entrada.motivo.length > 40, `"${entrada.arquivo}" na allowlist sem motivo de verdade`);
  }
});
