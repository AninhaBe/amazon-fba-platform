# ADR-001: Modelo canônico único (provider-agnostic)

- **Status:** Aceito
- **Data:** 2026-07 (retroativo — decisão da migração canônica, fases 1–5)

## Contexto

Cada marketplace (Amazon, Mercado Livre, e futuros Shopee/TikTok) tem uma API com
semântica própria de pedido, taxa e frete. Precisávamos decidir como armazenar isso
para que dashboard, monitor, radar e lucro funcionassem igual para todo canal, e para
que **adicionar um canal novo** não fosse um projeto do zero.

## Decisão

Um **modelo canônico único**: tabelas `workspace_channel_*` *provider-agnostic*, onde
a coluna **`provider`** distingue o canal (faz parte da PK composta junto de
`workspace_id`, `connection_id`, `external_id`). Todos os marketplaces são
**normalizados uma vez, na ingestão**, para esse formato comum. A leitura é agregação
SQL sobre ele.

## Alternativas consideradas

- **Uma tabela por canal** (`amazon_orders`, `mercado_livre_orders`, …). Rejeitada:
  cada relatório teria N caminhos, cada canal novo criaria tabelas + migrations + query
  duplicada, e cruzar canais (dashboard consolidado) ficaria custoso. A própria usuária
  levantou essa dúvida ("um pra cada canal?") e concluiu, pensando nas queries, que o
  canônico faz mais sentido.
- **Guardar só o `jsonb` cru e interpretar na leitura.** Rejeitada: leitura lenta,
  sem índices, regra de negócio espalhada.

## Consequências

- ➕ Relatórios são **uma** query SQL, iguais para todo canal; dashboard consolidado é trivial.
- ➕ **Canal novo não cria tabela nem migration** — grava-se com `provider = '<novo>'`.
  Vários enums já preveem `shopee`/`tiktok_shop`.
- ➖ Exige um **adaptador/normalizador por canal** na ingestão (mapear status e fees).
- ➖ A **taxonomia é fechada**: `status` (`pending`/`paid`/`shipped`/`delivered`/`cancelled`)
  e `fee_type` (`commission`/`fulfillment`/`shipping_seller`/`taxes_withheld`/`refund`/`other`).
  O código original da fee é preservado em `provider_fee_code` para não perder informação.

Detalhe do esquema: [`../canonical-schema.md`](../canonical-schema.md) e
[`../architecture/canonical-model.md`](../architecture/canonical-model.md).
