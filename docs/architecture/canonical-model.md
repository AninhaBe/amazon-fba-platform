# Modelo canônico

> Conceito e decisões. Para o **esquema de tabelas em detalhe** (colunas, PKs,
> exemplos de mapeamento por canal), veja [`../canonical-schema.md`](../canonical-schema.md).
> Decisão de projeto: [`../adr/ADR-001-modelo-canonico.md`](../adr/ADR-001-modelo-canonico.md).

O centro de tudo. Tabelas *provider-agnostic* — a coluna `provider` (`amazon`,
`mercado_livre`, …) distingue o canal; `workspace_id` isola o cliente; `connection_id`
isola a conta dentro do canal (ex.: `amazon:<sellerId>`). **Adicionar um canal não
cria tabela nova nem migration** — grava-se com `provider = '<novo>'`.

| Tabela | Papel |
|---|---|
| `workspace_channel_orders` | Cabeçalho do pedido: status canônico, `occurred_at`, `gross`, `currency`, `buyer_shipping`, `fulfillment`. |
| `workspace_channel_order_items` | Linhas do pedido: `sku`, `external_product_id`, `qty`, `unit_price` (líquido de promoção). |
| `workspace_channel_order_fees` | Taxas por pedido, agregadas por categoria canônica. |
| `workspace_marketplace_syncs` | Estado do sync por conta (janela, cursor, cobertura, lease). |
| `workspace_marketplace_products` | Catálogo/anúncios (payload pequeno, ainda por canal). |
| `workspace_product_costs` | Custo do produto **com histórico de vigência**. |
| `workspace_persistent_cache` | Cache stale-while-revalidate em produção. |

### O que NÃO entra no canônico — e por quê

O canônico modela **venda**. Nem todo dado do produto é venda, e forçar tudo aqui
custa caro: cria `provider` fantasma que sync, overview e dashboard teriam de
aprender a ignorar em todo lugar.

| Fora do canônico | Motivo |
|---|---|
| `workspace_ad_metrics` · `workspace_ad_reports` | **Publicidade não é canal de venda**: não tem pedido, item nem comprador. [ADR-025](../adr/ADR-025-anuncio-entra-no-lucro.md) |
| `workspace_settings` (tokens de Ads) | Credencial de API de anúncio, não de canal de venda |

⚠️ Estar fora do canônico **não** dispensa a disciplina: `workspace_ad_metrics`
tem `workspace_id`, `provider` e `connection_id` na chave primária pelos mesmos
motivos de sempre — isolamento de cliente e canal novo sendo `INSERT`, não
tabela nova.

**Status canônico** (único para todos): `pending`, `paid`, `shipped`, `delivered`,
`cancelled`. Cada canal mapeia o seu (ex.: Amazon `Unshipped → paid`, `Shipped → shipped`).

**Taxonomia de fees** (única e fechada): `commission`, `fulfillment` (ex.: taxas FBA),
`shipping_seller`, `taxes_withheld`, `refund`, `other`. Sinal positivo = debitado do
vendedor. O código original da fee fica preservado em `provider_fee_code`.

**Decisões-chave:**
- O **custo do produto é resolvido na consulta** (por vigência), não na ingestão —
  ver [`ADR-004`](../adr/ADR-004-custo-por-vigencia.md).
- Taxas são agregadas por pedido; a alocação por SKU (rateio) é feita em SQL, por
  peso de receita da linha.
- A escrita canônica é *best-effort* e **atômica** (um statement com CTEs).
