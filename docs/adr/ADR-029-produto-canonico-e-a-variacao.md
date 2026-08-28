# ADR-029: O produto canônico é a variação, não o anúncio

- **Status:** Proposto — aguardando revisão de dado do Delta e portão do cérebro
- **Data:** 2026-08-28
- **Relacionado:** [ADR-001](./ADR-001-modelo-canonico.md) ·
  [ADR-026](./ADR-026-camadas-por-ciclo-de-vida.md) ·
  [`estado-atual.md` §17](../estado-atual.md)

## Contexto

A dona abriu `/shopee/produtos` para cadastrar custo e viu duas coisas:

> *"um anúncio que tem duas variações aparece como um produto, com um campo de
> custo — então eu vou pôr o custo, e alguma outra variação dele vai ficar sem
> custo"*
>
> *"a maioria dos anúncios os SKUs não estão sendo puxados"*

Cobertura de custo da página: **0%**.

### A causa, no código

`shopeeCanonical.ts:450`, em `normalizeShopeeProduct`:

```
sku: product.item_sku || null
```

O conserto de 28/08/2026 pela manhã passou as **variações** para essa função e
resolveu **preço e estoque** a partir delas (`precoDoProdutoShopee(product,
models)`) — mas o SKU continuou saindo só do nível do item. E o canônico grava
**uma linha por anúncio**.

Do outro lado, o **pedido já faz certo** (`shopeeCanonical.ts:253`):

```
sku: line.model_sku || line.item_sku || null
```

Na Shopee o `item_sku` (nível anúncio) é opcional e costuma vir vazio; quem
carrega o SKU é o `model_sku` de cada variação.

**Resultado: a venda sabe qual variação vendeu; o catálogo não sabe que a
variação existe.** O custo é chaveado por SKU (`shopeeCostId`), então a junção
não tem como fechar.

### O tamanho do estrago (loja UTILEIRA, medido em 28/08/2026)

| Medida | Valor |
|---|---:|
| Anúncios no catálogo | 372 |
| Com variação (`has_model`) | 98 |
| Sem SKU no nível do item | **286** (77%) |
| SKUs distintos que aparecem **em venda** | 76 |
| **SKUs vendidos que não existem no catálogo** | **71 de 76** (93%) |
| Anúncios que venderam sob mais de um SKU | 21 |
| Pior caso | 1 anúncio, **7 SKUs**, 167 unidades |
| Maior volume | 1 anúncio, 5 SKUs, **1.850 unidades** |
| Custos cadastrados nesta loja | **2** |

E o número que decidiu a ordem de execução das entregas:

| Últimos 30 dias | |
|---|---:|
| Anúncios que venderam | 31 |
| **Desses, multi-variação** | **19** |
| Unidades no período | 10.773 |
| **Unidades em anúncios multi-variação** | **8.010 (74%)** |

Ou seja: ordenar a tela por volume de vendas — pedido legítimo da dona — poria
no **topo** justamente os anúncios onde o campo único de custo mais erra. A tela
diria "comece por aqui" apontando para onde o dado é mais frágil. Por isso a
ordenação sai **junto** com este conserto, nunca antes.

### 📌 Isto não é inventar granularidade: já existe, e está certa no TikTok

`tiktokCanonical.ts:641` faz exatamente o que falta na Shopee:

```
return skus.map((sku, index) => ({
  externalProductId: tiktokVariantProductId(productId, skuId),
  sku: sku.seller_sku || skuId,
  title: skus.length > 1 ? `${product.title} · ${sku.seller_sku ?? ...}` : product.title,
  ...
}))
```

**Uma linha canônica por variação**, com id composto e até o título sufixado pelo
nome da variação. Medido: TikTok tem **0 anúncios multi-SKU mal resolvidos e 0
SKUs órfãos**.

O Mercado Livre **tem o mesmo defeito estrutural da Shopee** — `getMercadoLivreProducts`
monta uma linha por item com `sellerSku(body)` e não expande `variations`. Hoje
não dói (medido: 1 anúncio multi-SKU, 3 SKUs órfãos) porque a dona quase não usa
variação lá. **"Não há estrago mensurável hoje" não é "está certo":** no dia em
que ela criar um anúncio com grade no ML, quebra igual.

## Decisão

**O produto canônico passa a ser a variação.** Onde o canal tem variação, o
canônico grava uma linha por variação, no padrão que o TikTok já usa:

- `external_product_id` composto (anúncio + identificador da variação);
- `sku` vindo do nível da variação (`model_sku` na Shopee), com o do anúncio
  como fallback;
- título com o sufixo da variação quando houver mais de uma, para a linha ser
  distinguível na tela;
- preço e estoque **da variação** (na Shopee já vêm do `get_model_list`).

Anúncio sem variação continua exatamente como está — uma linha, sem sufixo.

### As três perguntas que o cérebro mandou responder

#### 1. O custo já cadastrado num anúncio multi-variação vai para onde?

**Recomendação: (b) vira sugestão a confirmar.** E há um argumento estrutural
além do bom senso — o esquema de chave **já separa os dois mundos**:

```
shopeeCostId(conn, productId, sku) =
  sku ? `shopee:${conn}:sku:${sku}` : `shopee:${conn}:item:${productId}`
```

O custo cadastrado hoje num anúncio sem SKU mora em `item:<productId>`. Quando a
linha virar a variação, a busca passará a usar `sku:<model_sku>` — **namespace
diferente**. Então:

- **não há colisão**: o custo antigo não passa a valer errado para ninguém;
- **não há o que destruir**: ele fica órfão, não fica incorreto;
- **não há o que duplicar**: (a) precisaria escrever N cópias de um número que
  ninguém conferiu.

Isso torna (b) quase gratuito: o registro antigo **fica onde está** e a tela o
oferece — *"você cadastrou R$ X para este anúncio; aplicar a quais variações?"* —
até alguém confirmar. Nada é afirmado sem confirmação, nada é perdido.

Por que não as outras:

- **(a) replicar para todas** afirma um custo que ninguém conferiu, e num anúncio
  de grade (tamanho, cor) as variações frequentemente **têm** custos diferentes.
  Seria fabricar fato — a mesma família de erro de `null` virando `0`. Pior: a
  replicação atingiria os anúncios de maior volume (74% das unidades), então o
  erro entraria direto na margem do que mais vende.
- **(c) descartar com pendência** joga fora trabalho dela sem necessidade. Só
  faria sentido se o custo antigo pudesse ser lido errado — e pelo namespace
  acima, não pode.

⚠️ **Escopo real da migração nesta loja: 2 registros.** O problema é **pequeno em
dado e grande em regra** — a regra precisa estar certa antes de haver volume, não
depois. É por isso que este item está no ADR e não num script.

#### 2. `order_items` só tem o SKU textual, não o `model_id`

Verificado: as colunas são `workspace_id, provider, connection_id,
external_order_id, line_no, external_product_id, sku, title, qty, unit_price,
list_price, promotion_discount, promotion_ids`. **Não há `model_id`.** A
identidade da variação viaja hoje **só pelo texto do SKU**.

Medido: **9 itens de 22.500** (1 anúncio) têm SKU vazio — 0,04%. Então amarrar
por texto funciona para 99,96% do histórico.

Proposta:

- **Daqui para frente**, gravar também o identificador da variação
  (`model_id` na Shopee, `sku.id` no TikTok) numa coluna própria, porque é a
  chave estável: o vendedor pode **renomear** um `model_sku` e, no dia em que
  fizer isso, o histórico amarrado por texto se parte em silêncio.
- **Para o histórico**, a amarração continua por SKU textual — é o que existe.
- Os 9 itens sem SKU ficam **sem variação atribuída**, e a linha do anúncio os
  mostra como o que são. **Nunca vão para uma variação escolhida por proximidade**
  e nunca viram zero.

Esta é a parte que mais precisa da revisão do Delta: coluna nova em tabela
grande, e a decisão entre coluna e chave composta.

#### 3. Impacto em quem hoje conta "produto"

| Onde | O que acontece |
|---|---|
| **Curva ABC** | **Já está certa e melhora sozinha.** `readShopeeAbc` agrupa por `i.external_product_id, i.sku` — lê dos *itens de pedido*, que já têm o `model_sku`. Ela é, hoje, o único lugar que enxerga a variação. |
| **Radar de estoque / inventário** | **É o segundo defeito grave, e ninguém tinha visto.** `readShopeeInventory` casa catálogo com vendas pela chave `productId + "\0" + sku`. Como o catálogo tem SKU vazio e a venda tem `model_sku`, **a junção falha**. Medido: só **6 das 372** linhas do catálogo casam com alguma venda, e **32 anúncios que venderam** aparecem com `unitsSold = 0` → "Sem base de venda". O aviso que hoje está na tela (*"estoque por variação/modelo não está disponível"*) descreve o sintoma; este ADR remove a causa. |
| **Custo / margem / lucro** | É o motivo do ADR. Passa a existir custo por variação. |
| **Full / fulfillment** | `fulfillment` é coluna da linha de produto. Se a linha vira a variação, o valor precisa ser resolvido **por variação**. Na Shopee ele é `null` hoje. **Não afirmo o caso do ML** — é um dos pontos que quero que o Delta confirme antes de eu implementar. |
| **Contagens de catálogo na tela** | "372 anúncios" passa a ser "N variações". O número **cresce** e a comparação com o painel do marketplace muda. A tela precisa dizer qual dos dois está contando, senão a dona vê um número novo sem explicação. |

## Consequências

**A favor:**

- O custo passa a se prender onde a venda acontece — é o conserto do defeito.
- O radar de estoque volta a ter base de venda em 32 anúncios que hoje mentem
  "sem base".
- A granularidade fica **uniforme** entre canais, com o TikTok deixando de ser a
  exceção certa e passando a ser o padrão.
- Destrava a ordenação por volume que a dona pediu, sem a armadilha.

**Contra, e assumido:**

- O catálogo cresce em número de linhas (98 anúncios viram N variações na Shopee).
  Volume ainda pequeno, mas o custo de escrita do sync sobe.
- A tela muda de forma: onde havia um anúncio, aparecem várias linhas. É o que a
  dona pediu, mas é mudança visível e precisa de aviso.
- O `get_model_list` da Shopee já é chamado no sync (uma chamada por anúncio com
  variação) — **não há chamada nova**, só uso do que já vem.
- Enquanto o ML não expandir variações, ele fica com a granularidade antiga.
  Precisa entrar na mesma frente ou ficar registrado como pendência explícita.

## Pendente antes de implementar

1. Revisão do Delta: coluna de `model_id` em `order_items`, forma da chave
   composta em `workspace_channel_products`, e o caso `fulfillment`/Full do ML.
2. Portão do cérebro sobre a resposta (b) para o custo existente.
3. Definição da Vitrine para a linha da variação na tela (sufixo, agrupamento
   visual sob o anúncio pai).
4. A ordenação por volume de vendas sai **junto**, nunca antes — ver a tabela dos
   74% acima.
