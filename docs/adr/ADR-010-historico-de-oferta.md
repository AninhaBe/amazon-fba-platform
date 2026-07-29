# ADR-010: Histórico de oferta (estoque, preço e disponibilidade)

- **Status:** Aceito (v1 em implementação)
- **Data:** 2026-07-28

## Contexto

O objetivo de produto é um **assistente**: a pessoa abre o app e ele diz o que está
acontecendo — *"o clips parou de vender: o estoque zerou há 2 dias"*.

Para isso são necessárias duas informações. A **primeira já existe**: a linha de base
de venda de cada anúncio ("vende ~2/dia") sai do histórico de pedidos no canônico
(`workspace_channel_orders` + `_order_items`).

A **segunda não existe**: o *estado da oferta ao longo do tempo*. Hoje
`workspace_channel_products` guarda `price` e `available_qty`, mas o sync **sobrescreve**
a linha a cada passagem. Sabemos o estoque de agora; não sabemos como estava ontem.

Isso é exatamente o que falta para responder **por que** a venda parou. Saber que o
estoque está zerado hoje não explica nada — o que explica é que ele **zerou anteontem**,
e a venda parou junto. Sem série temporal, o app consegue detectar a anomalia mas não
atribuir causa.

Mesma natureza do problema do [ADR-009](./ADR-009-historico-de-ranking.md): o passado não
é recuperável de nenhuma API, só pode ser **capturado por nós daqui pra frente**.

## Decisão

### 1. Tabela `workspace_channel_offer_history` (workspace-scoped, em `db.ts`)

Uma linha por anúncio **por dia**, por canal — o mesmo formato de "foto diária" do
`workspace_rank_history`, que já está em produção e funciona.

```
workspace_id        TEXT
provider            TEXT           -- 'amazon' | 'mercado_livre' | futuros
connection_id       TEXT
external_product_id TEXT
captured_on         DATE           -- 1 linha por dia (upsert: a última foto do dia vence)
sku                 TEXT
status              TEXT           -- canônico: active | paused | closed
price               NUMERIC(14,2)
currency            TEXT
available_qty       INTEGER
buy_box_owned       BOOLEAN        -- NULL quando o canal não expõe / não coletado
updated_at          TIMESTAMPTZ
PRIMARY KEY (workspace_id, provider, connection_id, external_product_id, captured_on)
```

`buy_box_owned` é **nullable de propósito**: no Mercado Livre o conceito não se aplica do
mesmo jeito, e na Amazon depende de uma chamada extra com cota apertada (ver §3). NULL
significa "não sabemos", nunca "não é sua".

### 2. Captura de custo zero — mas o ponto de captura difere por canal

Princípio comum: gravar o dado que **já veio** numa chamada que já acontece. É o mesmo
truque do ADR-009 (persistir o rank que já vinha na resposta da busca). O que muda é
onde cada canal já busca esse dado.

**Mercado Livre** — `syncProducts` já traz preço e estoque a cada 6h e grava no
canônico. A foto entra no mesmo ponto: `recordOfferSnapshot(scope, products)` dentro de
`saveCanonicalProducts`. Os chamadores já envolvem isso em `canonicalBestEffort`, então
**uma falha na foto nunca derruba o sync** — e os produtos já foram gravados antes.

**Amazon** — o sync **não persiste produtos**, só pedidos; estoque é sempre lido ao vivo.
Então a captura é um job próprio (`amazonOfferSnapshot.ts`) no cron, usando
`getInventory()` — **uma** chamada paginada que devolve todos os SKUs, com cache SWR de
10 min. Como o snapshot de ranking já chama `getInventory()` na mesma passada, na prática
não há chamada nova.

### 2.1 Chave: por SKU na Amazon, por anúncio no ML

Na Amazon o estoque é **por SKU**, e a mesma ASIN pode ter vários SKUs — na conta da
usuária, quatro SKUs dividem a ASIN `B0H9R1888D`. Usar ASIN como chave faria as quatro
variações colidirem na mesma linha do dia. Por isso `external_product_id = sellerSku`
na Amazon, e o `id` do anúncio no ML. O `sku` também é o que liga com os itens de
pedido, que é o join de que o detector vai precisar.

### 2.2 O que cada canal preenche hoje

| Coluna | ML | Amazon (v1) |
|---|---|---|
| `available_qty` | ✅ | ✅ (`fulfillable`) |
| `price` / `currency` | ✅ | ❌ NULL — não vem no FBA Inventory |
| `status` | ✅ | ❌ NULL |
| `buy_box_owned` | — | ❌ NULL (ver §3) |

As colunas são nullable de propósito: **NULL significa "não coletado", nunca zero ou
inativo**. Qualquer leitor precisa tratar isso — um NULL lido como zero viraria um
"estoque acabou" falso.

### 3. Buy box e preço na Amazon ficam para o v1.1

O `getItemOffers` (Product Pricing v0) devolve `IsBuyBoxWinner`, preço do concorrente,
se é FBA e a reputação do vendedor — resolveria buy box **e** preço de uma vez. Mas:

- é **1 chamada por ASIN** (não vem em nenhuma chamada que já façamos), e
- a cota é apertada — na verificação de 28/07 tomamos **429 QuotaExceeded na segunda
  chamada seguida**.

Então não entram no v1. Quando entrarem, será em lote, espaçado, no cron, com cap por
passagem — **nunca por request de tela**. Até lá as colunas ficam `NULL`.

> Nota de verificação (28/07): nos ASINs da conta o endpoint respondeu
> `status: "NoBuyableOffers"` com zero ofertas — porque a conta está sem estoque, não
> por limitação da API. O teste de buy box precisa ser refeito quando houver oferta viva.

### 4. Retenção

Foto diária, poucas colunas, poucos anúncios por conta: o volume é desprezível
(1 linha × nº de anúncios × dias). Sem expurgo no v1; reavaliar se passar de ~1 ano.

## Honestidade

- **Sem retroativo.** A série começa no dia em que isto subir. O detector de causa só
  fica útil depois de acumular alguns dias — como no ADR-009.
- **Granularidade diária.** Uma queda de estoque que aconteça e se resolva no mesmo dia
  não aparece. Aceitável: o alvo é explicar dias parados, não minutos.
- **Não substitui o canônico.** `workspace_channel_products` continua sendo o estado
  atual; esta tabela é só a série temporal.
- **A conta Amazon da usuária está zerada** (13 SKUs, 0 vendável, verificado em 28/07),
  então lá a série nasce vazia até haver reposição. O ML tem dois workspaces ativos e
  começa a acumular imediatamente.

## O que esta ADR NÃO decide

Deliberadamente fora de escopo, para não misturar decisões:

- **O detector de anomalia** (limiar que escala com a velocidade de venda, tratamento de
  falso positivo). Vem depois, com a série já acumulando.
- **O uso de LLM no assistente.** Fica para uma ADR própria. Princípio que já vale desde
  já: **o modelo nunca calcula nem busca número** — recebe fatos prontos e só prioriza e
  redige.

## Alternativas consideradas

- **Derivar o passado de `synced_at`:** não funciona — a linha é sobrescrita, o valor
  anterior não fica em lugar nenhum.
- **Log de toda mudança (event sourcing):** granularidade maior, custo e complexidade
  maiores, e não é preciso para explicar "parou há 2 dias". Foto diária basta.
- **Serviço externo de histórico (Keepa etc.):** teria retroativo na hora, mas é pago e
  cria dependência externa — mesmo motivo da rejeição no ADR-009.

## Consequências

- ➕ **Custo zero:** sem chamada de API nova; aproveita sync que já roda.
- ➕ Destrava a pergunta *"por que parou de vender?"*, que é o núcleo do assistente.
- ➕ Valor imediato sem IA: viabiliza gráfico de estoque e preço no tempo, que hoje não
  existe.
- ➕ Vale para **os dois canais** no mesmo formato (regra do projeto de replicar tudo).
- ➖ Só serve depois de acumular dias; não há passado.
- ➖ Buy box adiada para o v1.1 por limite de cota.
