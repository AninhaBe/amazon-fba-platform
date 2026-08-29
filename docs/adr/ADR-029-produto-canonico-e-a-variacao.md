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

### 🚨 A mudança é INDIVISÍVEL (condição de atomicidade — achado do Delta)

Hoje, na Shopee, o join catálogo × venda casa **41 de 41** porque **os dois lados
usam o `item_id` base**. Se o catálogo virar id composto e o item de pedido
continuar com o id base, **41/41 vira 0/41** — e o radar de estoque, que já casa
mal (6 de 372), passa a não casar **nada**.

Portanto vão juntos, no mesmo lote:

1. catálogo por variação;
2. `external_product_id` **composto no item de pedido**;
3. backfill dos 22.935 itens.

**Meia entrega aqui é pior que o estado atual.**

Para não nascer um terceiro dialeto de id, o composto sai de um helper único —
`variantProductId(base, variantId)` — com o mesmo separador que o TikTok já usa
(`<base>::sku:<variantId>`). O Delta confirmou por medição que no TikTok os dois
lados gravam o composto (43/43 casando), que era a dúvida que sustentava a
alternativa de PK ampliada.

**Forma da chave: id composto em `external_product_id`, não coluna nova na PK.**
PK ampliada obrigaria propagar `variation_id` na *chave* dos itens, e a ADR-022
registra mexer em PK como o maior risco da camada física.

### As três perguntas que o cérebro mandou responder

#### 1. O custo já cadastrado num anúncio multi-variação vai para onde?

**Decisão: (b) vira sugestão a confirmar — com as duas condições abaixo, que são
parte da decisão e não detalhe de implementação.**

O Delta tentou furar o (b) a pedido do cérebro e achou **duas portas laterais**
que anulariam o argumento inteiro. Nenhuma dispara hoje; as duas estão *a uma
linha de distância*. **Decisão que depende de ninguém escrever essa linha não é
decisão, é sorte** — por isso elas moram aqui.

> **CONDIÇÃO 1 — a chave de custo da variação usa o ID COMPOSTO, nunca o id base
> do anúncio.**
> Se a variação sem `model_sku` cair no fallback `item:<anúncio>`, ela **herda o
> custo do anúncio em silêncio**: o (b) degrada para (a) invisível, e justamente
> nos **77% do catálogo que não têm SKU no nível do item**. Com o id composto, o
> fallback `item:` aponta para a variação, não para o anúncio.

> **CONDIÇÃO 2 — a varredura de resgate por texto de SKU fica dentro do
> sub-namespace `sku:`.**
> `shopeeCostEntry` (e o equivalente do ML), quando a chave exata falha, varre os
> custos procurando `sku` igual. A varredura aceitava qualquer entrada da mesma
> conexão — inclusive uma de `item:` que carregasse o campo `sku`. Seria herança
> de custo sem confirmação **pela porta ao lado da que o argumento tranca**.

✅ As duas foram fechadas em 28/08/2026, antes da implementação do resto, e estão
travadas em `tests/custoDaVariacao.test.mjs` — o teste falha se alguém usar o id
base ou reabrir a varredura entre sub-namespaces. A mudança é neutra hoje (o
Delta mediu: nenhuma das duas dispara), o que a torna barata agora e cara depois.

E há um argumento estrutural além do bom senso — o esquema de chave **já separa
os dois mundos**:

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

### 🗣️ A dona descreveu o mecanismo — e a última frase decide a opção

Em 29/08/2026, olhando a tela, ela explicou o defeito sem conhecer os nomes
técnicos dos campos:

> *"A lixeira que aparece no print, o SKU puxa porque o SKU está cadastrado no
> campo de **SKU Principal** na plataforma da Shopee. Já itens como mesinha, que
> o SKU é cadastrado **dentro de cada campo de variação**, não tá puxando. E
> precisa puxar todos, porque **TEM MUITOS PRODUTOS QUE TÊM CUSTO DIFERENTE POR
> SKU DENTRO DO MESMO ANÚNCIO**."*

"SKU Principal" é o `item_sku`; "dentro de cada campo de variação" é o
`model_sku`. O diagnóstico técnico e a descrição dela são o mesmo fato.

⚠️ **A última frase é a prova de que a opção (a) estava errada.** Se o custo
difere por SKU dentro do mesmo anúncio, **replicar** o custo do anúncio para
todas as variações fabricaria número errado em massa — e justamente nos anúncios
de maior volume (74% das unidades de 30 dias estão em multi-variação). Não é
teoria nossa: é a operação dela descrita por ela.

Fica registrado aqui para proteger a decisão de quem, no futuro, achar que
"replicar é mais simples".

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
depois.

📌 **E os 2 registros não são teoria.** Um deles é um custo de **R$ 2,40** num
anúncio com **2.631 vendas**. É o caso que decide entre as três opções: (c)
jogaria fora um número que ela cadastrou à mão e que vale para o produto que mais
vende; (a) o replicaria para todas as variações daquele anúncio sem ninguém
conferir se as variações custam o mesmo. **(b) preserva o trabalho e não afirma
nada** — a tela pergunta a quais variações ele se aplica. É por isso que este item está no ADR e não num script.

#### 2. `order_items` só tem o SKU textual, não o `model_id`

Verificado: as colunas são `workspace_id, provider, connection_id,
external_order_id, line_no, external_product_id, sku, title, qty, unit_price,
list_price, promotion_discount, promotion_ids`. **Não há `model_id`.** A
identidade da variação viaja hoje **só pelo texto do SKU**.

Medido: **9 itens de 22.500** (1 anúncio) têm SKU vazio — 0,04%. Então amarrar
por texto funciona para 99,96% do histórico.

Decisão, com o parecer do Delta já incorporado:

- **Coluna `model_id` nova**, `nullable` sem default — no Postgres isso é
  **metadata-only**: instantâneo, sem reescrita da tabela e sem bloat. Custo de
  armazenamento medido: ~12 bytes por linha preenchida, ~430 KB somando Shopee e
  TikTok. É a chave **estável**: o vendedor pode **renomear** um `model_sku`, e
  nesse dia o histórico amarrado por texto se parte em silêncio.
- **Sem índice em `model_id`** — manter os updates elegíveis a HOT.
- **O custo real não é a coluna, é o backfill**: 22.935 linhas, numa tabela com
  `fillfactor 100` (não pegou o 90 da 0015) e 21,5 MB de índices — a mesma
  receita do backfill da R2, que inflou 37 MB. Plano: `SET fillfactor=90`
  **antes**, backfill em lotes com contagem, re-medição depois.
- **O backfill é possível, medido:** o `raw` do pedido Shopee traz `model_id` no
  `item_list` em **22.314 de 22.738** pedidos. Os 424 sem `item_list` ficam
  `null` — honesto, não zero.
- **Impacto em particionamento e índices (ADR-022): zero.** `model_id` não entra
  na PK — a identidade da linha segue sendo `line_no`.
- Os 9 itens sem SKU ficam **sem variação atribuída**. **Nunca vão para uma
  variação escolhida por proximidade** e nunca viram zero.

⚠️ **PRAZO (ADR-026): o backfill precisa acontecer ANTES de qualquer retenção de
bronze da Shopee.** A fonte do backfill é o `raw`, que é bronze descartável — se
o expurgo passar primeiro, o dado que permite reconstruir a variação some. É a
mesma classe do achado da NF-e.

#### 3. Impacto em quem hoje conta "produto"

| Onde | O que acontece |
|---|---|
| **Curva ABC** | **Já está certa e melhora sozinha.** `readShopeeAbc` agrupa por `i.external_product_id, i.sku` — lê dos *itens de pedido*, que já têm o `model_sku`. Ela é, hoje, o único lugar que enxerga a variação. |
| **Radar de estoque / inventário** | **É o segundo defeito grave, e ninguém tinha visto.** `readShopeeInventory` casa catálogo com vendas pela chave `productId + "\0" + sku`. Como o catálogo tem SKU vazio e a venda tem `model_sku`, **a junção falha**. Medido: só **6 das 372** linhas do catálogo casam com alguma venda, e **32 anúncios que venderam** aparecem com `unitsSold = 0` → "Sem base de venda". O aviso que hoje está na tela (*"estoque por variação/modelo não está disponível"*) descreve o sintoma; este ADR remove a causa. |
| **Custo / margem / lucro** | É o motivo do ADR. Passa a existir custo por variação. |
| **Full / fulfillment** | **Respondido pelo Delta, com medição:** no ML o Full é **do anúncio, não da variação** — `shipping.logistic_type` vem no nível do item (medido em 6 de 11 anúncios da conta: 3 `drop_off`, 3 `fulfillment`), e a variação carrega quantidade e `seller_custom_field`, não tipo logístico. Então a variação **herda** o fulfillment do anúncio, e isso é fiel, não é fabricar dado. *Ressalva do próprio Delta, que fica registrada: ele não observou um objeto `variations` real — os 11 anúncios dela têm `variations = 0` —, então a afirmação vem da estrutura observada + doc interna. A certeza total custa uma chamada num anúncio com grade, que hoje não existe na conta.* |
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
- ⚠️ **Correção factual do Delta a uma afirmação minha:** eu escrevi que "não há
  chamada nova". Isso vale para o **sync corrente** (o `get_model_list` já é
  chamado por anúncio com variação), mas **não** para a população inicial: o
  `raw` do catálogo Shopee **não guarda as variações** — as chaves reais são
  `has_model, image, item_id, item_name, item_sku, item_status, price_info,
  stock_info_v2`. Popular o catálogo exige varrer os **98 anúncios com
  `has_model`** chamando `get_model_list`. **Barato, não gratuito** — entra no
  plano para não virar surpresa.
- Enquanto o ML não expandir variações, ele fica com a granularidade antiga.
  Precisa entrar na mesma frente ou ficar registrado como pendência explícita.

## ⚠️ O que o `fillfactor` protege — e o que ele NÃO protege

Registrado antes de aplicar, para ninguém depois concluir que o backfill foi HOT:

`ALTER TABLE ... SET (fillfactor = 90)` **não libera espaço nas páginas que já
estão cheias.** Ele vale para páginas novas. Como a tabela está hoje em
`fillfactor` 100 (medido: `reloptions = NULL`) com as páginas antigas cheias,
**boa parte das escritas deste backfill não conseguirá ser HOT** — as versões
novas vão para páginas novas, e essas sim nascem com a folga.

Ou seja: o `fillfactor` aqui **protege os updates seguintes**, não acelera este
backfill. Ele entra mesmo assim porque a tabela vai continuar recebendo escrita
depois; o que não se deve é atribuir a ele um ganho que ele não entrega agora.

Obter o ganho também neste backfill exigiria `VACUUM FULL` depois — **decisão
recusada** em 29/08/2026: tem lock, e o ganho não justifica no meio de um lote.

📌 Custo físico projetado do backfill, com esse desenho: ~22.965 linhas ×
~295 bytes = **~6,8 MB de heap novo**, mais ~5,2 MB de entradas de índice
(escrita não-HOT) = **~12 MB de inchaço temporário**, recuperável no autovacuum.
Cerca de **um terço** dos 37 MB que o backfill da R2 inflou.

## Ordem de execução (indivisível — ver a condição de atomicidade)

1. `SET fillfactor=90` em `workspace_channel_order_items` **antes** do backfill.
2. `ADD COLUMN model_id` nullable, sem default, sem índice.
3. Varrer os 98 anúncios com `has_model` (`get_model_list`) e popular o catálogo
   por variação, com `external_product_id` composto via `variantProductId()`.
4. Passar o item de pedido a gravar o composto, e **backfillar os 22.935 itens**
   a partir do `raw` — **antes de qualquer retenção de bronze da Shopee**.
5. Re-medição do Delta (bloat, buffers, o join catálogo × venda voltando a casar).
6. A ordenação por volume de vendas entra **neste mesmo lote**, nunca antes — ver
   a tabela dos 74% acima.

## Pendente antes de implementar

1. ✅ Revisão do Delta — recebida e incorporada (parecer em
   `G:/sc-temp/frente-L-parecer-adr029.md`).
2. Portão final do cérebro.
3. Definição da Vitrine para a linha da variação na tela (sufixo, agrupamento
   visual sob o anúncio pai).

## Lateral, para ficha própria

O Delta registrou de passagem: **a Amazon tem a mesma classe de furo por outra
causa** — 79 ids vendidos, dos quais só 4 existem no catálogo (que tem 8 linhas).
Não é variação; é catálogo incompleto. Não entra neste ADR, mas não pode se
perder: é a terceira vez em dois dias que um número da Amazon vem de um lugar que
não é o que se supunha.
