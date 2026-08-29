# ADR-033: Estoque desconhecido não é zero

- **Status:** Proposto
- **Data:** 2026-08-29

## Contexto

`workspace_channel_products.available_qty` é `integer NOT NULL`. **A coluna não
consegue dizer "não sei."** Então três estados diferentes chegam a toda leitura
como o mesmo zero — e só o primeiro é um fato:

| Estado | O que significa | É fato? |
|---|---|---|
| **A fonte disse zero** | O marketplace devolveu o anúncio e informou estoque 0 | ✅ sim |
| **A fonte não falou deste anúncio** | A varredura completa não devolveu o anúncio; nosso código escreve `available_qty = 0` | ❌ é ignorância |
| **Nunca sincronizamos este produto** | O SKU vende, mas não existe linha no catálogo | ❌ nem existe |

### Onde o zero é fabricado

`shopeeSync.ts:339` e `tiktokSync.ts:382`, no fecho da varredura de catálogo:

```sql
UPDATE workspace_channel_products
   SET status='closed', provider_status='NOT_PRESENT_IN_COMPLETE_SNAPSHOT',
       available_qty=0, synced_at=now()
 WHERE ... AND synced_at < <início da varredura>
```

⚠️ **O `status='closed'` é a parte honesta**: o anúncio não apareceu, então não
dá para vendê-lo. O `available_qty=0` é a parte inventada — ele afirma uma
QUANTIDADE que ninguém informou.

### Tamanho, medido em 29/08/2026 na conta real

| Canal | Anúncios | Zerados | **Zero por ausência** | Zero reportado | Com estoque |
|---|---:|---:|---:|---:|---:|
| Shopee | 747 | 670 | **435** | 235 | 77 |
| TikTok Shop | 104 | 33 | **30** | 3 | 71 |
| Mercado Livre | 417 | 313 | 0 | 313 | 104 |
| Amazon | 8 | 0 | 0 | 0 | 8 |

- Na Shopee, **58% do catálogo inteiro** está com estoque inventado.
- No TikTok, **30 dos 33 zeros (91%)** são inventados.
- O ML **não fabrica**: os 313 zeros dele são `paused`/`under_review` com
  quantidade realmente informada. É a prova de que dá para não fazer isso.

E o terceiro estado, SKUs que vendem sem linha no catálogo: **Amazon 75**,
Mercado Livre 4, Shopee 4. Para esses a tela não mostra zero — não mostra nada,
que é outro defeito com outro nome.

### Consequência que já aconteceu

Em 29/08/2026 o sinal de ruptura do briefing ia anunciar cinco produtos como
"estoque ZERO e vendeu N vezes no último mês". **Três dos cinco eram zero
fabricado** — anúncios que a Shopee não devolveu no snapshot. O texto já estava
pronto para ser levado à vendedora. Foi barrado por conferência manual, não por
nenhuma defesa do sistema.

### Quem lê o campo

| Superfície | O que o zero fabricado causa |
|---|---|
| **Radar de estoque** (`classificarCobertura`) — dashboards de ML, Shopee, TikTok e Amazon | `disponivel <= 0` ⇒ **`"out"`**, rotulado **"Esgotado"**. Vira alarme de reposição para produto que talvez tenha estoque |
| **Alerta "N produto(s) em estoque crítico"** no topo dos dashboards | Conta itens que não deveriam estar lá |
| **Telas de estoque** dos quatro canais (coluna "Disponível") | Mostra `0` como se fosse leitura da fonte |
| **Tela de produtos/custos** (Shopee, TikTok) | Idem |
| **Custo do estoque no Full** (`mercadoLivreFullStock`) | Filtra `availableQty > 0`: o item **sai silenciosamente** da lista de capital parado |
| **Detector de ruptura do TikTok** (`insights/detectors/tiktokRuptura.ts`) | Gera insight de ruptura sobre ignorância |
| **Sinal de ruptura do briefing** (`centralDiagnostico`) | Já contornado em 29/08 exigindo `status='active'` — contorno, não conserto |

## Decisão

### 1. A coluna passa a poder dizer "não sei"

`available_qty` vira **nullable**. A varredura que não encontra o anúncio grava
`available_qty = NULL` e mantém `status='closed'` + `provider_status`. O status
continua carregando o que é verdade ("não dá para comprar"); a quantidade para de
afirmar o que ninguém informou.

> Isto é a primeira regra da casa aplicada onde ela estava sendo violada:
> **`null` ≠ `0`. Zero é o fato "não há"; `null` é "não sei".**

### 2. O vocabulário de cobertura ganha um estado, e ele não é adjetivo

`StockStatus` recebe **`"desconhecido"`**, e `classificarCobertura` devolve esse
estado quando `disponivel` é `null` — antes de qualquer outra classificação.
Ele **não entra** na contagem de "estoque crítico" nem no alarme de reposição.

No radar, a ordem passa a ser: `out` → `critical` → `low` → `ok` → `overstock` →
`idle` → `desconhecido`. Desconhecido vai para o fim porque não é urgência: é
lacuna.

### 3. O que a tela mostra — o que falta, com número e link

⚠️ **Nada de "parcial", "incompleto" ou qualquer adjetivo que se desculpe.** A
regra da casa é dizer **o que falta, com número e link**.

- **Na linha do produto**, a coluna "Disponível" mostra `—` (não `0`).
- **Na tela de estoque**, uma linha acima da lista:
  > `435 anúncios sem estoque confirmado pela Shopee — não vieram na última varredura de catálogo (11:35 de hoje). Ver lista →`
- **No radar do dashboard**, o item não vira "Esgotado": ele sai do radar, e o
  contador do radar diz quantos ficaram de fora e por quê.
- **Para o terceiro estado** (SKU que vende e não tem anúncio), a frase é outra
  porque a ação é outra:
  > `75 SKUs venderam na Amazon e não estão no catálogo importado. Ver lista →`

### 4. Nenhuma varredura pode inventar quantidade

Regra geral, para os quatro canais e para os próximos: **uma varredura que não
encontra um item pode mudar o STATUS dele, nunca os NÚMEROS dele.** Status é
conclusão nossa sobre disponibilidade; quantidade é dado da fonte.

## Alternativas consideradas

- **Deixar como está e filtrar `status='active'` em cada leitura.** É o contorno
  que o briefing recebeu hoje. Não serve como decisão: transfere para cada
  consulta futura a obrigação de lembrar — a mesma fragilidade das oito rotas com
  `after()` e das 273 consultas com `workspace_id`. A 274ª esquece.
- **Manter a última quantidade conhecida em vez de zerar.** Piora: afirma um
  número que pode ter meses, com a mesma cara de leitura fresca. Dado velho sem
  rótulo é pior que dado ausente.
- **Deduzir a quantidade do que sobrou de vendas.** É extrapolação, proibida pela
  regra da casa e sem exceção nomeada aqui (a exceção do ADR-027 vale para número
  **publicado pela própria fonte**, que não é o caso).
- **Não classificar produto sem estoque conhecido em nenhum lugar.** Esconderia a
  lacuna. A vendedora precisa saber que 58% do catálogo dela está sem leitura de
  estoque — esconder é a versão confortável do desconhecido.

## Consequências

- **Migração**: `ALTER TABLE workspace_channel_products ALTER COLUMN
  available_qty DROP NOT NULL`. Não converte dado existente — o `0` fabricado que
  já está gravado só vira `NULL` na próxima varredura de cada canal, que é o
  momento em que a fonte volta a falar (ou a não falar). **Backfill imediato é
  possível** (`available_qty = NULL WHERE provider_status =
  'NOT_PRESENT_IN_COMPLETE_SNAPSHOT'`) e deve ser decidido junto: são 465 linhas
  nos dois canais.
- **Toda leitura precisa tratar `null`.** São 7 superfícies mapeadas acima. Um
  leitor esquecido volta a mostrar zero ou quebra — por isso a migração e os
  leitores sobem no mesmo lote, com teste que exige o tratamento.
- **Ganha-se** a distinção entre "esgotou" e "não sei", que é a diferença entre
  um alarme de reposição legítimo e um alarme sobre ignorância.
- **Perde-se** a simplicidade de um campo que nunca é nulo. É o custo de dizer a
  verdade, e é o mesmo custo que `gross` já pagou na migration 0008.
- **Fica em aberto**: a Amazon tem 75 SKUs vendendo sem linha no catálogo — o
  terceiro estado é maior lá do que nos outros canais, e a causa é diferente (o
  catálogo canônico da Amazon quase não é populado: 8 anúncios). Frente própria.
