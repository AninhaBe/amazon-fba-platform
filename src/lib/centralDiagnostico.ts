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
 * Coleta os sinais que explicam variação de faturamento. Todos filtrados pelo
 * workspace ativo — nunca mistura conta de terceiro.
 *
 * Falha aqui é silenciosa por desenho: sem diagnóstico o NEXO volta a narrar só
 * os números, que é o comportamento anterior. Nunca derruba o briefing.
 */
export async function coletarSinaisDeCausa(): Promise<SinalDeCausa[]> {
  const ws = currentWorkspaceId();
  const sinais: SinalDeCausa[] = [];

  const [anuncios, pararam, rupturas] = await Promise.all([
    // 1. Canal sem anúncio ativo — a causa mais direta de "parou de vender".
    dbQuery<LinhaAnuncios>(
      `SELECT provider,
              COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE status = 'active')::text AS ativos
         FROM workspace_channel_products
        WHERE workspace_id = $1
        GROUP BY provider`,
      [ws]
    ).catch(() => []),

    // 2. Produto que VENDIA e parou. Só entra quem tem histórico relevante (3+
    //    vendas): item de venda única parando não explica queda de faturamento.
    dbQuery<LinhaParou>(
      `SELECT o.provider, i.sku,
              COUNT(*)::text AS vendas,
              EXTRACT(DAY FROM now() - MAX(o.occurred_at))::int::text AS dias
         FROM workspace_channel_order_items i
         JOIN workspace_channel_orders o
           USING (workspace_id, provider, connection_id, external_order_id)
        WHERE o.workspace_id = $1 AND o.status <> 'cancelled'
          AND o.occurred_at > now() - interval '90 days'
        GROUP BY o.provider, i.sku
       HAVING COUNT(*) >= 3
          AND MAX(o.occurred_at) < now() - interval '5 days'
        ORDER BY COUNT(*) DESC
        LIMIT 6`,
      [ws]
    ).catch(() => []),

    // 3. Estoque zerado em produto que vendia — não vende porque não dá para comprar.
    dbQuery<LinhaRuptura>(
      `SELECT p.provider, p.sku, COUNT(i.*)::text AS vendas
         FROM workspace_channel_products p
         JOIN workspace_channel_order_items i
           ON i.workspace_id = p.workspace_id AND i.provider = p.provider
          AND i.connection_id = p.connection_id AND i.sku = p.sku
         JOIN workspace_channel_orders o
           USING (workspace_id, provider, connection_id, external_order_id)
        WHERE p.workspace_id = $1 AND p.available_qty = 0
          AND o.occurred_at > now() - interval '30 days' AND o.status <> 'cancelled'
        GROUP BY p.provider, p.sku
        ORDER BY COUNT(i.*) DESC
        LIMIT 5`,
      [ws]
    ).catch(() => []),
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
