// Participação orgânica por produto — o indicador que autoriza cortar Ads.
//
// TACOS diz quanto o anúncio custa; NÃO diz se o produto já anda sozinho. O que
// autoriza pisar no freio é outra conta:
//
//     vendas reais (banco)  −  vendas atribuídas ao Ads  =  vendas orgânicas
//
// Enquanto o orgânico for pequeno, cortar Ads é cortar a venda. Quando passar de
// ~60%, o produto tem tração própria e o corte vira decisão com base.
//
// ⚠️ A Ads API ainda não foi aprovada, então as vendas atribuídas NÃO estão no
// banco — entram por parâmetro, lidas do console na leitura diária.
//
//   node scripts/organico.mjs --de=2026-08-12 --ate=2026-08-18 \
//        --ads="martelo-borracha=5,kit-clips-320=2"
//
// Só leitura. Credenciais do .env.local do NEXO.
// `pg` vive no node_modules do NEXO — a skill mora fora do repo, então a
// resolução precisa ser explícita. `--repo=` muda o caminho.
import { createRequire } from "node:module";
const repo = (process.argv.find((a) => a.startsWith("--repo=")) || "--repo=G:/amazon-fba-platform").slice(7);
let pg;
try {
  pg = createRequire(`${repo}/package.json`)("pg");
} catch {
  console.error(`Nao achei o pacote 'pg' em ${repo}. Rode com --repo=<caminho do NEXO>.`);
  process.exit(1);
}

const args = process.argv.slice(2);
const opt = (n, d) => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : d;
};

const hoje = new Date();
const iso = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
// Padrão: janela de 7 dias que termina 3 dias atrás — a atribuição do Ads leva
// até 7 dias para fechar, então incluir ontem faz o orgânico parecer maior do
// que é. Este erro (concluir sobre janela ainda aberta) já custou caro três vezes.
const ate = opt("ate", iso(new Date(hoje.getTime() - 3 * 86_400_000)));
const de = opt("de", iso(new Date(hoje.getTime() - 10 * 86_400_000)));
const workspace = opt("ws", "1803d1fe-2bf3-4b72-bed1-c79d8b0e640e");
const conexao = opt("conn", "amazon:AO62LVXJMX3AA");
const LIMIAR = Number(opt("limiar", "60"));

// --ads="sku=n,sku=n" — vendas ATRIBUÍDAS ao Ads, do console.
const atribuidas = new Map(
  (opt("ads", "") || "")
    .split(",")
    .filter(Boolean)
    .map((par) => {
      const [sku, n] = par.split("=");
      return [sku.trim(), Number(n)];
    })
);

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const linhas = (
  await c.query(
    `SELECT i.sku,
            SUM(i.qty)::int AS unidades,
            COUNT(DISTINCT o.external_order_id)::int AS pedidos,
            SUM(i.qty * i.unit_price)::numeric(12,2) AS receita
       FROM workspace_channel_orders o
       JOIN workspace_channel_order_items i
         ON i.workspace_id = o.workspace_id
        AND i.connection_id = o.connection_id
        AND i.external_order_id = o.external_order_id
      WHERE o.workspace_id = $1 AND o.connection_id = $2
        AND o.status IN ('paid','shipped','delivered')
        AND (o.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $3::date AND $4::date
      GROUP BY i.sku
      ORDER BY 2 DESC`,
    [workspace, conexao, de, ate]
  )
).rows;

const brl = (v) => `R$ ${Number(v).toFixed(2).replace(".", ",")}`;
const diasAtras = Math.round((hoje - new Date(ate + "T12:00:00-03:00")) / 86_400_000);

console.log(`\nPARTICIPAÇÃO ORGÂNICA · ${de} a ${ate}`);
console.log(`janela fecha há ${diasAtras} dia(s)${diasAtras < 3 ? "  ⚠️ ATRIBUIÇÃO AINDA ABERTA — orgânico vai parecer maior do que é" : "  (atribuição madura)"}`);

if (!linhas.length) {
  console.log("\nNenhuma venda no período.");
  await c.end();
  process.exit(0);
}

console.log(`\n${"produto".padEnd(20)}${"reais".padStart(6)}${"ads".padStart(6)}${"orgânico".padStart(10)}${"%".padStart(8)}   veredito`);
let totReal = 0, totAds = 0;
for (const l of linhas) {
  const reais = l.unidades;
  const ads = atribuidas.get(l.sku);
  totReal += reais;
  if (ads != null) totAds += ads;

  if (ads == null) {
    console.log(`${l.sku.padEnd(20)}${String(reais).padStart(6)}${"—".padStart(6)}${"—".padStart(10)}${"—".padStart(8)}   informe --ads=${l.sku}=N`);
    continue;
  }
  const organico = reais - ads;
  const pct = reais > 0 ? (organico / reais) * 100 : 0;
  // Atribuído acima do real acontece: o Ads credita venda de OUTRO SKU da conta
  // (halo) na campanha que recebeu o clique. Dizer isso é melhor que mostrar
  // orgânico negativo como se fosse fato.
  const veredito = organico < 0
    ? "atribuído > real — halo de outro SKU"
    : pct >= LIMIAR
      ? `ANDA SOZINHO (≥${LIMIAR}%) — corte pode ser avaliado`
      : "ainda depende do Ads";
  console.log(`${l.sku.padEnd(20)}${String(reais).padStart(6)}${String(ads).padStart(6)}${String(organico).padStart(10)}${(pct.toFixed(0) + "%").padStart(8)}   ${veredito}`);
}

if (totAds > 0) {
  const pctGeral = ((totReal - totAds) / totReal) * 100;
  console.log(`\nCONTA: ${totReal} unidades reais · ${totAds} atribuídas ao Ads · orgânico ${pctGeral.toFixed(0)}%`);
}

console.log(`\nreceita do período: ${brl(linhas.reduce((s, l) => s + Number(l.receita), 0))}`);
console.log("\nCOMO LER");
console.log("• 'reais' vem do banco (pedidos aprovados); 'ads' você informa da leitura do console.");
console.log("• Só produto com orgânico acima do limiar é candidato a corte — e mesmo assim,");
console.log("  cortar a zero costuma derrubar o orgânico junto: concorrente anuncia na sua página.");
console.log("• Um período só não decide. Duas ou três janelas seguidas acima do limiar, sim.");

await c.end();
