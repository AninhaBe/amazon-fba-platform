# Leitura e cache

> Como os dados **saem** do modelo canônico para a tela, e por que a segunda visita
> é instantânea. Decisão de cache: [`../adr/ADR-002-cache-swr.md`](../adr/ADR-002-cache-swr.md).
> Orçamento de leitura: [`../adr/ADR-017`](../adr/ADR-017-orcamento-de-1s-e-leitura-agregada.md).

## 1. Leitura — overview canônico

Em vez de N rotas batendo em N endpoints da SP-API, a leitura vira **agregação SQL**
sobre as tabelas canônicas (`mercadoLivreOverviewCanonical.ts`,
`amazonOverviewCanonical.ts`, `tiktokOverviewCanonical.ts`,
`shopeeOverviewCanonical.ts`): totais do período, série diária, top produtos,
rentabilidade por venda (com rateio de taxa/frete por peso de receita) e radar —
tudo com colunas indexadas, sem trafegar `jsonb`.

- **Mercado Livre:** 100% canônico.
- **Amazon:** híbrida por decisão, não por atraso — cada dado usa a fonte que
  reconcilia com o Seller Central:

| Dado | Fonte | Motivo |
|---|---|---|
| Faturamento + série diária | **Sales API** (`orderMetrics`) | Bate ao centavo com o Seller Central |
| KPI de Lucro | **Transactions API** (agregado) | Fonte reconciliada; mantida até validar o canônico |
| Lucro **por dia**, top produtos (margem real), rentabilidade, radar, estorno | **Canônico** (v3, com tarifa estimada da ADR-027/030 quando a oficial não chegou) | SQL rápido; `null` nos dias que a fonte ainda não publicou |

O selo `covered` é o interruptor: período coberto pelo sync → lê do canônico; ainda
não coberto → cai no caminho ao vivo. Assim a troca é gradual e reversível.

### 1.1 Agregação por produto em SQL — LATERAL por pedido, medido

Regra do ADR-017 que virou padrão em 20–21/09: **total por produto se agrega no
banco, nunca somando o detalhe no Node** — o detalhe tem teto (1000 pedidos) e o
teto matava a margem do Top do ML em contas que passam de 1000 pedidos/janela.

E a forma do SQL importa, medida com `EXPLAIN (ANALYZE, BUFFERS)` na conta real
antes de commitar (CRYSTALFANCY, 30 dias):

| forma | buffers | tempo quente |
|---|---:|---:|
| join-aggregate de fees da conexão inteira | ~100k (81.697 linhas de fee varridas) | 3,3 s |
| **LATERAL por pedido** (fees só dos pedidos do período) | **~53k** | **187 ms** |

O denominador do rateio por linha usa window function
(`SUM(qty*unit_price) OVER (PARTITION BY external_order_id)`), e a completude
por produto usa `BOOL_AND` — linha sem custo ou sem tarifa marca o agregado como
incompleto em vez de fingir zero.

### 1.2 Prévia de 5 linhas — o payload magro (20/09)

O dashboard não precisa das até 1000 linhas de rentabilidade que o monitor
pagina. O produtor do overview aceita `detalhe: "completo" | "previa"`
(`LINHAS_DA_PREVIA = 5`):

- **`previa`** (view `dashboard`): busca só os pedidos das 5 primeiras linhas da
  ordenação vigente (tie-break estável por `external_order_id`), e o **escopo**
  ("Exibindo os N") vem de um `COUNT` separado sobre o conjunto **inteiro** —
  o número não mente por causa do corte;
- **`completo`** (view `monitor`): comportamento anterior.

Medido na conta real: payload da troca de período de **595 KB → ~28 KB**, com
diff ao centavo entre as duas formas provado por script antes do deploy. A rota
emite `Server-Timing` — foi ele que fechou o diagnóstico da lentidão restante
por eliminação (servidor ~1 s, rede em brotli pequena → o custo é renderização
no cliente).

### 1.3 Índices e autovacuum (migration 0032, aplicada em 12/09)

As consultas quentes têm índices parciais dedicados (pendentes por canal,
eventos presos) e as seis tabelas quentes têm
`autovacuum_*_scale_factor = 0.05` — a régua padrão de 20% deixava o planner
com estatística velha entre um ciclo e outro nas tabelas que crescem o dia todo.

### 1.4 Tarifa: lista positiva, nunca lista negra

Toda soma de tarifa filtra por **lista positiva** de `fee_type`
(`SQL_TARIFAS_QUE_CUSTAM`) — a lista negra (`fee_type NOT IN (...)`) morreu em
31/08, porque nela o desconhecido entra por padrão. O vocabulário é o CHECK da
migration 0028 ([canonical-model](./canonical-model.md)), e **real e estimada
nunca se somam cruas**: a leitura passa pela view
`workspace_channel_order_fees_efetivas`, que entrega a efetiva por
`fee_type` (a oficial quando existe, senão a estimativa não-substituída).

### Anúncio (Ads) — leitura nunca toca a API

`workspace_ad_metrics` guarda **uma linha por dia × campanha**, e a tela lê só
dali. Não há fallback ao vivo, e não pode haver: o relatório da Ads API é
assíncrono e leva de 105 s a ~11 min ([sync-engine](./sync-engine.md#4-ingestão-assíncrona--o-padrão-do-relatório)).
Ligar "abrir a aba dispara o relatório" faria a pessoa olhar um esqueleto por
minutos.

O consumidor de dashboard é `anuncioDoCanal.ts` (`gastoDeAnuncioPorDia`), que
devolve `{gastoPorDia, ateDia, primeiroDia}` — o lucro por dia da Amazon
(`lucroPorDiaDaAmazon.ts`) anula o dia cujo gasto ainda é desconhecido
(`date > ateDia`), em vez de somar zero.

⚠️ **A janela tem de ser a mesma do financeiro.** Se o gasto fosse fixo em 30
dias, o filtro de 7 dividiria gasto de 30 por faturamento de 7 e o TACOS sairia
~4× maior. Medido em 25/08/2026: 7 dias → R$ 193,93 · 15 e 30 dias → R$ 312,98.

As bordas viram dia-calendário de Brasília
(`AT TIME ZONE 'America/Sao_Paulo'`), como o resto da apuração — a Amazon reporta
anúncio por dia do perfil, não em UTC.

**Sem linha nenhuma, as funções devolvem `null`, não zero.** É o `null ≠ 0` do
AGENTS.md: "não sincronizou" e "não gastou" não podem virar o mesmo `R$ 0,00`.
Ver [ADR-025](../adr/ADR-025-anuncio-entra-no-lucro.md).

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
> e as seguintes são instantâneas. O aquecimento (ver [`sync-engine.md`](./sync-engine.md#4-ingestão-assíncrona--o-padrão-do-relatório))
> existe justamente para o usuário nunca pagar esse custo frio.

---

## Changelog

- **26/09/2026** — Atualização medida contra o código: agregação por produto em
  SQL com LATERAL (números do EXPLAIN de 20/09), prévia de 5 linhas por view e o
  payload de 595 KB → ~28 KB, `Server-Timing`, índices/autovacuum da 0032,
  lista positiva de `fee_type` + view efetiva, lucro por dia canônico da Amazon
  e o consumo de Ads por `anuncioDoCanal.ts`.
- **25/08/2026** — Versão anterior.
