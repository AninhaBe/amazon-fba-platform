# ADR-002: Cache stale-while-revalidate + aquecimento

- **Status:** Aceito
- **Data:** 2026-07 (retroativo)

## Contexto

As chamadas aos marketplaces são **lentas e rate-limited**. Sem cache, cada visita ao
dashboard refazia as mesmas chamadas caras, e várias rotas simultâneas (KPIs, gráfico,
radar) podiam estourar o limite pedindo o mesmo dado. A **primeira** carga de um
período sempre paga o custo frio.

## Decisão

Três camadas complementares (`cache.ts`, `swr.ts`, `persistentCache.ts`):

1. **`cached()`** — memória com **dedupe** (chamadas concorrentes iguais compartilham
   uma só), namespaced por `workspace | conta`.
2. **`swr()`** — *stale-while-revalidate* persistido no **PostgreSQL**: fresco devolve
   na hora; vencido devolve o velho e revalida em background.
3. **Aquecimento** via cron: pré-carrega os períodos do filtro (Hoje/7/15/30) para
   **todas** as contas ativas, para a primeira visita já vir quente.

## Alternativas consideradas

- **Sem cache, sempre ao vivo.** Rejeitada: lento e fura rate limit.
- **Cache só em memória.** Rejeitada: o Render reinicia e o cache some; a segunda
  visita pós-deploy voltaria a ser fria. Por isso a camada persistida no Postgres.

## Consequências

- ➕ Segunda visita é **instantânea**; com aquecimento, até a primeira vem quente.
- ➕ Sobrevive a restart/deploy (camada Postgres).
- ➖ Dado pode estar **stale por um ciclo** (aceitável para métricas de vendas).
- ➖ Complexidade de invalidação e de chaves de cache (namespacing por workspace/conta
  é obrigatório — nunca vazar dado entre contas).

Detalhe: [`../architecture/read-and-cache.md`](../architecture/read-and-cache.md).
