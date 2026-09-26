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
| `workspace_channel_order_items` | Linhas do pedido: `sku`, `external_product_id`, `qty`, `unit_price` (líquido de promoção), `list_price`/`promotion_discount` (0009), `model_id` (0018). |
| `workspace_channel_order_fees` | Taxas **reais** por pedido, agregadas por categoria canônica; `posted_at` (0029) guarda a data do lançamento na fonte. |
| `workspace_channel_order_fee_estimates` | Estimativas (ADR-027), **separadas do real desde a 0022**: `basis`, procedência, `superseded_at` quando a oficial chega. |
| `workspace_channel_order_fees_efetivas` (view) | A tarifa **efetiva** por `fee_type`: a real quando existe, senão a estimativa não-substituída. É por ela que toda leitura soma — somar as duas tabelas cruas é dupla contagem por construção. ⚠️ View **não herda coluna** de tabela (`posted_at` precisou da 0030; incidente de 02/09 no `AGENTS.md`). |
| `workspace_marketplace_syncs` | Estado do sync por conta (janela, cursor, cobertura, lease); `last_push_at` (0031) separa o carimbo do push do da varredura. |
| `workspace_channel_products` / `workspace_marketplace_products` | Catálogo/anúncios. O `price` do canônico ganhou leitores novos em 09/2026: o custo/venda do estoque no **Full** do ML e a valorização em tempo real do pedido **pendente** da Amazon (que chega sem `ItemPrice`). |
| `workspace_product_costs` | Custo do produto **com histórico de vigência** (ADR-004). |
| `workspace_marketplace_events` | Fila dos eventos de webhook/push (ML), com status e tentativas. |
| `workspace_persistent_cache` | Cache stale-while-revalidate em produção. |

**Escritas e leituras fora de `runWithWorkspace` quebram** — `currentWorkspaceId()`
lança, sem default (ver `AGENTS.md`, isolamento entre inquilinos).

### O que NÃO entra no canônico — e por quê

O canônico modela **venda**. Nem todo dado do produto é venda, e forçar tudo aqui
custa caro: cria `provider` fantasma que sync, overview e dashboard teriam de
aprender a ignorar em todo lugar.

| Fora do canônico | Motivo |
|---|---|
| `workspace_ad_metrics` · `workspace_ad_reports` | **Publicidade não é canal de venda**: não tem pedido, item nem comprador. [ADR-025](../adr/ADR-025-anuncio-entra-no-lucro.md) |
| `workspace_settings` (tokens de Ads) | Credencial de API de anúncio, não de canal de venda |
| `workspace_tiktok_shops` | Vínculo de loja↔app do TikTok. A coluna `app` (0033, `CHECK (app IN ('custom','publico'))`) diz **por qual app a conexão nasceu** — é ela que decide qual par de credenciais assina e renova |

⚠️ Estar fora do canônico **não** dispensa a disciplina: `workspace_ad_metrics`
tem `workspace_id`, `provider` e `connection_id` na chave primária pelos mesmos
motivos de sempre — isolamento de cliente e canal novo sendo `INSERT`, não
tabela nova.

**Status canônico** (único para todos): `pending`, `paid`, `shipped`, `delivered`,
`cancelled`. Cada canal mapeia o seu (ex.: Amazon `Unshipped → paid`, `Shipped → shipped`).

**Taxonomia de fees — fechada NO BANCO desde a 0028** (01/09/2026). O CHECK
`channel_order_fees_vocabulario_canonico` só aceita:

```
commission · shipping_seller · fulfillment · payment · ads
taxes_withheld · refund · other
```

Sinal positivo = debitado do vendedor; o código original fica em
`provider_fee_code`. Duas decisões dentro do vocabulário:

- **`estimated` não é `fee_type`** — procedência não é natureza (ADR-027,
  Emenda II). Estimativa mora em `workspace_channel_order_fee_estimates`, e o
  banco recusa o valor na tabela real;
- **`other` é permitido aqui — e só aqui** — descartar fato do extrato é pior
  que rotulá-lo grosseiramente; a dívida declarada é que `other` crescendo não
  alarma (nota na própria 0028);
- e toda **leitura** filtra por lista positiva (`SQL_TARIFAS_QUE_CUSTAM`) —
  a lista negra morreu em 31/08 ([read-and-cache](./read-and-cache.md#14-tarifa-lista-positiva-nunca-lista-negra)).

**Decisões-chave:**
- O **custo do produto é resolvido na consulta** (por vigência), não na ingestão —
  ver [`ADR-004`](../adr/ADR-004-custo-por-vigencia.md).
- Taxas são agregadas por pedido; a alocação por SKU (rateio) é feita em SQL, por
  peso de receita da linha.
- A escrita canônica é *best-effort* e **atômica** (um statement com CTEs).
- Migration que **move** dado responde "quem lê isso agora?" antes do apply —
  incluindo as **views** no caminho (0022 e 0029 já cobraram esse pedágio;
  `AGENTS.md`).

### Migrations escritas e ainda NÃO aplicadas (26/09/2026)

| Migration | O que cria | Estado |
|---|---|---|
| `0034_solicitacao_de_avaliacao_por_pedido` | `workspace_review_solicitations` — registro durável por pedido (`estado` em `pode_solicitar` / `ja_solicitada` / `fora_da_janela`, carimbo de envio, RLS) para a feature "Solicitar avaliação" já validada em produção | **commitada, aguarda janela de apply** (Ana assina o plano) |
| `0035_o_indice_do_frete_para_de_ler_o_payload` | troca do índice de shipment (`DROP` + `CREATE`, **não aditiva** — atenção à janela) | **commitada, aguarda a mesma janela** |

---

## Changelog

- **26/09/2026** — Atualização medida contra `migrations/` e o código: separação
  real × estimativa (0022) com a view efetiva e o aviso de view congelada
  (0029/0030), vocabulário de `fee_type` fechado por CHECK (0028) com as
  decisões `estimated`/`other`, `last_push_at` (0031), `app` da conexão TikTok
  (0033), leitores novos do `price` (Full do ML, pendente da Amazon), fila de
  eventos, e a tabela de 0034/0035 commitadas e não aplicadas.
- **25/08/2026** — Versão anterior (taxonomia de seis tipos, sem a tabela de
  estimativas).
