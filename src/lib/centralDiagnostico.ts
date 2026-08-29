import { dbQuery } from "./db";
import { currentWorkspaceId } from "./workspaceScope";

// Os CANDIDATOS A CAUSA que o NEXO precisa para explicar um número, em vez de só
// narrá-lo.
//
// O pedido dela, em 22/08/2026: *"legal que o faturamento do ML caiu, mas ele não
// sabe dizer mt o pq"*. Estava certa — até então o modelo recebia só o resultado
// (caiu X%) e nenhum dado que explicasse.
//
// E a resposta estava no banco o tempo todo: a conta de Mercado Livre dela tem
// **14 anúncios e ZERO ativos**. Não é mistério nenhum; é que ninguém entregava
// esse fato ao modelo.
//
// ⚠️ Isto NÃO é o modelo consultando o banco (isso é o harness do
// docs/ai-agent-harness.md, fase 2). Aqui o servidor busca sinais conhecidos e os
// entrega prontos — sem risco de consulta inventada, e barato.
//
// Regra que atravessa o arquivo: cada sinal é um FATO verificável com números
// próprios. Nada de inferência — quem conecta os pontos é o modelo, e ele só pode
// conectar o que recebeu.

export interface SinalDeCausa {
  canal: string;
  /** Fato pronto para o modelo citar, com os números dentro. */
  fato: string;
}

const NOME_CANAL: Record<string, string> = {
  amazon: "Amazon",
  mercado_livre: "Mercado Livre",
  shopee: "Shopee",
  tiktok_shop: "TikTok Shop",
};

interface LinhaAnuncios {
  provider: string;
  total: string;
  ativos: string;
}
interface LinhaParou {
  provider: string;
  sku: string;
  vendas: string;
  dias: string;
}
interface LinhaRuptura {
  provider: string;
  sku: string;
  vendas: string;
}

/**
 * Cada sinal falha SOZINHO e deixa rastro.
 *
 * ⚠️ Por que isto existe (29/08/2026): os três sinais eram `.catch(() => [])`.
 * Degradar sem derrubar o briefing continua certo — o que estava errado era
 * degradar **sem contar**. Medindo um a um descobrimos que o sinal 3 nunca tinha
 * rodado UMA vez desde que foi escrito, por erro de SQL, e que o sinal 2 morria
 * no teto de tempo quando o banco estava disputado. O briefing vinha narrando
 * com um terço dos sinais e ninguém sabia, porque ninguém podia saber.
 *
 * Mesma família da rede de segurança que não conta quantas vezes salvou.
 */
async function sinalOuVazio<T>(nome: string, consulta: Promise<T[]>): Promise<T[]> {
  try {
    return await consulta;
  } catch (error) {
    console.error("[briefing] sinal de causa indisponível", {
      sinal: nome,
      motivo: error instanceof Error ? error.message.slice(0, 200) : "erro desconhecido",
    });
    return [];
  }
}

/**
 * Coleta os sinais que explicam variação de faturamento. Todos filtrados pelo
 * workspace ativo — nunca mistura conta de terceiro.
 *
 * Falha de um sinal não derruba o briefing: sem diagnóstico o NEXO volta a
 * narrar só os números, que é o comportamento anterior. Mas a falha vai para o
 * log com nome e motivo — ver `sinalOuVazio`.
 */
export async function coletarSinaisDeCausa(): Promise<SinalDeCausa[]> {
  const ws = currentWorkspaceId();
  const sinais: SinalDeCausa[] = [];

  const [anuncios, pararam, rupturas] = await Promise.all([
    // 1. Canal sem anúncio ativo — a causa mais direta de "parou de vender".
    sinalOuVazio("anuncios-ativos", dbQuery<LinhaAnuncios>(
      `SELECT provider,
              COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE status = 'active')::text AS ativos
         FROM workspace_channel_products
        WHERE workspace_id = $1
        GROUP BY provider`,
      [ws]
    )),

    // 2. Produto que VENDIA e parou. Só entra quem tem histórico relevante (3+
    //    vendas): item de venda única parando não explica queda de faturamento.
    sinalOuVazio("produto-parou-de-vender", dbQuery<LinhaParou>(
      // SKU vazio não é sinal: agrupar por '' junta produtos diferentes e o
      // NEXO acabaria dizendo "o SKU  parou de vender".
      `SELECT o.provider, i.sku,
              COUNT(*)::text AS vendas,
              EXTRACT(DAY FROM now() - MAX(o.occurred_at))::int::text AS dias
         FROM workspace_channel_order_items i
         JOIN workspace_channel_orders o
           ON o.workspace_id = i.workspace_id AND o.provider = i.provider
          AND o.connection_id = i.connection_id
          AND o.external_order_id = i.external_order_id
        WHERE i.workspace_id = $1 AND o.status <> 'cancelled'
          AND o.occurred_at > now() - interval '90 days'
          AND NULLIF(TRIM(i.sku), '') IS NOT NULL
        GROUP BY o.provider, i.sku
       HAVING COUNT(*) >= 3
          AND MAX(o.occurred_at) < now() - interval '5 days'
        ORDER BY COUNT(*) DESC
        LIMIT 6`,
      [ws]
    )),

    // 3. Estoque zerado em produto que vendia — não vende porque não dá para comprar.
    sinalOuVazio("ruptura-de-estoque", dbQuery<LinhaRuptura>(
      // ⚠️ ESTA CONSULTA NUNCA RODOU até 29/08/2026. O `USING` vinha depois de um
      // JOIN que já trazia `workspace_id`, e o Postgres recusava com "common
      // column name workspace_id appears more than once in left table" — erro de
      // PARSE, então nem plano ela chegava a ter. O `.catch(() => [])` engolia,
      // e o sinal simplesmente não existia. Junção explícita agora, e o teste
      // `centralDiagnostico.test.mjs` roda o SQL contra o banco justamente para
      // que um erro de parse não possa mais passar por "sem sinal hoje".
      // Conta a venda PRIMEIRO e só depois olha o estoque. Juntar produto com
      // item por SKU antes de agregar multiplica a venda pelo número de anúncios
      // que compartilham o SKU: medido em 29/08/2026, KIT2-ARR-G-CINZA_ML tem 2
      // anúncios e saía com 1328 vendas quando o real são 664. Número inventado
      // na cara da vendedora é pior que sinal ausente.
      //
      // "Estoque zerado" com vários anúncios no mesmo SKU só é ruptura se TODOS
      // estiverem zerados — se um ainda tem estoque, dá para comprar.
      //
      // ⚠️ E EXIGE ANÚNCIO ATIVO — `p.status = 'active'`. Sem isso o sinal mentiu
      // no mesmo dia em que nasceu (29/08/2026). `available_qty` é `NOT NULL`:
      // a coluna NÃO CONSEGUE dizer "não sei". Então três estados diferentes
      // chegam aqui como o mesmo zero:
      //   · a fonte disse zero            -> fato, e é o único que é ruptura
      //   · a fonte não falou do anúncio  -> `NOT_PRESENT_IN_COMPLETE_SNAPSHOT`,
      //                                      435 dos 739 anúncios da Shopee dela
      //   · nunca sincronizamos o anúncio -> desconhecido também
      // Os dois últimos entram como `closed`, então exigir `active` os corta.
      // Anúncio PAUSADO com zero é dado real, mas não é ruptura: a ação dela é
      // reativar, não repor. Se for para mostrar, é OUTRO sinal com outra frase.
      // O defeito de baixo — desconhecido virando zero no canônico — é ADR.
      `WITH vendas AS (
         SELECT i.provider, i.connection_id, i.sku, COUNT(*)::int AS vendas
           FROM workspace_channel_order_items i
           JOIN workspace_channel_orders o
             ON o.workspace_id = i.workspace_id AND o.provider = i.provider
            AND o.connection_id = i.connection_id
            AND o.external_order_id = i.external_order_id
          WHERE i.workspace_id = $1 AND o.status <> 'cancelled'
            AND o.occurred_at > now() - interval '30 days'
            AND NULLIF(TRIM(i.sku), '') IS NOT NULL
          GROUP BY i.provider, i.connection_id, i.sku
       )
       SELECT v.provider, v.sku, SUM(v.vendas)::text AS vendas
         FROM vendas v
        WHERE EXISTS (
                SELECT 1 FROM workspace_channel_products p
                 WHERE p.workspace_id = $1 AND p.provider = v.provider
                   AND p.connection_id = v.connection_id AND p.sku = v.sku
                   AND p.status = 'active' AND p.available_qty = 0
              )
          AND NOT EXISTS (
                SELECT 1 FROM workspace_channel_products p
                 WHERE p.workspace_id = $1 AND p.provider = v.provider
                   AND p.connection_id = v.connection_id AND p.sku = v.sku
                   AND p.available_qty > 0
              )
        GROUP BY v.provider, v.sku
        ORDER BY SUM(v.vendas) DESC
        LIMIT 5`,
      [ws]
    )),
  ]);

  for (const linha of anuncios) {
    const total = Number(linha.total);
    const ativos = Number(linha.ativos);
    const canal = NOME_CANAL[linha.provider] ?? linha.provider;
    if (total > 0 && ativos === 0) {
      sinais.push({
        canal,
        fato: `${canal}: NENHUM anúncio ativo — ${total} cadastrados, 0 ativos. Sem anúncio ativo não há venda, e esta é a explicação direta para o faturamento do canal ter parado.`,
      });
    } else if (total >= 10 && ativos > 0 && ativos / total < 0.25) {
      sinais.push({
        canal,
        fato: `${canal}: só ${ativos} de ${total} anúncios estão ativos (${Math.round((ativos / total) * 100)}%).`,
      });
    }
  }

  for (const linha of pararam) {
    const canal = NOME_CANAL[linha.provider] ?? linha.provider;
    sinais.push({
      canal,
      fato: `${canal}: o produto ${linha.sku} vendeu ${linha.vendas} vezes nos últimos 90 dias e está há ${linha.dias} dias sem vender.`,
    });
  }

  for (const linha of rupturas) {
    const canal = NOME_CANAL[linha.provider] ?? linha.provider;
    sinais.push({
      canal,
      fato: `${canal}: o produto ${linha.sku} está com estoque ZERO e vendeu ${linha.vendas} vez(es) no último mês — não vende porque não dá para comprar.`,
    });
  }

  return sinais;
}
