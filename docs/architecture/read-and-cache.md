# Leitura e cache

> Como os dados **saem** do modelo canônico para a tela, e por que a segunda visita
> é instantânea. Decisão de cache: [`../adr/ADR-002-cache-swr.md`](../adr/ADR-002-cache-swr.md).

## 1. Leitura — overview canônico

Em vez de N rotas batendo em N endpoints da SP-API, a leitura vira **agregação SQL**
sobre as tabelas canônicas (`mercadoLivreOverviewCanonical.ts`,
`amazonOverviewCanonical.ts`): totais do período, série diária, top produtos,
rentabilidade por venda (com rateio de taxa/frete por peso de receita) e radar —
tudo com colunas indexadas, sem trafegar `jsonb`.

- **Mercado Livre:** já é **100% canônico**.
- **Amazon:** em migração (fase 5). Estratégia **híbrida** para não quebrar a
  reconciliação com o Seller Central enquanto o backfill amadurece:

| Dado | Fonte | Motivo |
|---|---|---|
| Faturamento + série diária | **Sales API** (`orderMetrics`) | Bate ao centavo com o Seller Central |
| KPI de Lucro | **Transactions API** (agregado) | Fonte reconciliada; mantida até validar o canônico |
| Rentabilidade por venda, radar, top produtos | **Canônico** quando `covered=true`, senão **fallback** à SP-API | SQL rápido; sem regressão durante o backfill |

O selo `covered` é o interruptor: período coberto pelo sync → lê do canônico; ainda
não coberto → cai no caminho ao vivo. Assim a troca é gradual e reversível.

### Workspace sem conta SP-API

Há um segundo interruptor, independente do `covered`: **não existir nenhuma conta
SP-API no workspace**. Antes isso devolvia `409` e o canal aparecia "Ativo" e
"Indisponível" ao mesmo tempo. Hoje `/api/sales` e `/api/order-profitability`
caem no canônico (`onMissingAccount` em `withAccount.ts`), porque ler o canônico
não exige credencial — a chave é workspace + provider + conexão.

O faturamento servido por esse caminho **não é o oficial**: a resposta vem com
`source: "canonical"` e a tela é obrigada a dizer de onde veio. Com duas ou mais
contas o `409` continua — a escolha é do usuário, não do fallback.

Casos que dependem disso: o workspace de demonstração (avaliação de marketplace)
e qualquer conta cuja autorização Amazon tenha sido revogada.

## 2. Cache — stale-while-revalidate

Três camadas que se complementam (`cache.ts`, `swr.ts`, `persistentCache.ts`):

1. **`cached()`** — cache em memória com **dedupe**: várias rotas pedindo o mesmo dado
   no mesmo instante compartilham uma única chamada (não estoura o rate limit).
   Namespaced por `workspace | conta`.
2. **`swr()`** — *stale-while-revalidate* persistido no **PostgreSQL**
   (`workspace_persistent_cache`): fresco → devolve na hora; vencido → devolve o velho
   e revalida em segundo plano; sem cache + `awaitIfEmpty` → aguarda a busca real.
3. **`persistentCache`** — em produção grava no Postgres (sobrevive a restart); no dev,
   em arquivo.

> É por isso que a **primeira** carga de um período é lenta (cache frio → chamada real)
> e as seguintes são instantâneas. O aquecimento (ver [`sync-engine.md`](./sync-engine.md#2-agendamento--o-cron))
> existe justamente para o usuário nunca pagar esse custo frio.
