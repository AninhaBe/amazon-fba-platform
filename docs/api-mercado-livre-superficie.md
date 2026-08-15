# Superfície da API do Mercado Livre — o que dá para puxar hoje

**Levantado em 14–15/08/2026**, com token real da conexão, **somente GETs**, testando
endpoint por endpoint. Não é lista de documentação: é o que **respondeu 200 de verdade**
com as nossas credenciais de app não certificado.

Serve para responder em minutos, não em um dia: *"dá para fazer X no ML?"*.

> **Como ler:** a coluna **Trad.** diz se funciona em **anúncio tradicional**. Muita
> coisa boa do ML só existe para anúncio de **catálogo** — e boa parte da base vende no
> tradicional. Se a ideia depende de algo marcado ❌, ela atende só parte dos vendedores.

**Contas usadas:** `648425194` (NEXAHUBBRASIL, nossa) para os endpoints de site;
`1191100170` (CRYSTALFANCY, do sócio — **leitura autorizada**) para os de anúncio, por
ser a única com catálogo ativo.

---

## Resumo

| | |
|---|---|
| Endpoints testados | 33 |
| **Responderam 200** | **25** |
| Falharam | 8 |
| Bloqueio que mais dói | `GET /sites/MLB/search` → **403** |

---

## 1. Conta e vendedor

| Endpoint | Devolve | Trad. |
|---|---|---|
| `GET /users/{id}` | `nickname`, `registration_date`, reputação embutida, `permalink`, `seller_reputation` | ✅ |
| `GET /users/{id}/items/search` | IDs dos anúncios, com `paging`. Aceita `status=active` | ✅ |
| `GET /users/{id}/brands` | `brands`, `shield_id`, `tags` — marcas ligadas à conta | ✅ |

⚠️ `GET /users/{OUTRO_id}/items/search` é **recusado** — não dá para listar anúncio de
terceiro. E `/users/{id}/reputation` não existe como rota própria (404): a reputação vem
dentro de `/users/{id}`.

---

## 2. Anúncio (só os próprios)

| Endpoint | Devolve | Trad. |
|---|---|---|
| `GET /items/{id}` | o objeto inteiro — ver campos abaixo | ✅ |
| `GET /items/{id}/description` | `text`, `plain_text`, `last_updated`, `date_created` | ✅ |
| `GET /items/{id}/sale_price` | `amount`, `regular_amount`, `reference_date`, `metadata` | ✅ |
| `GET /items/{id}/available_upgrades` | modalidades para as quais dá para subir | ✅ |

### Campos úteis dentro de `/items/{id}`

Medido em três anúncios **tradicionais** do sócio:

```
catalog_listing : false
health          : null          ← NÃO existe score de qualidade no tradicional
status/sub      : active / []
listing_type_id : gold_special  (Clássico)
tags            : ["user_product_listing","good_quality_thumbnail",
                   "immediate_payment","cart_eligible","standard_price_by_quantity"]
shipping        : logistic_type=fulfillment, free_shipping=false, mode=me2
attributes      : 31 preenchidos
pictures        : 3
sold_quantity   : 13     ← disponível para anúncio PRÓPRIO
available_quantity : 111
sale_terms      : garantia (tipo e tempo)
```

- **`tags`** é onde o ML deixa julgamento de qualidade: `good_quality_thumbnail`,
  `cart_eligible`, `immediate_payment`. A ausência de uma tag também informa.
- **`sold_quantity` funciona no anúncio próprio.** O que é inacessível é o de terceiro.
- **`health` é `null`** nos tradicionais — e `GET /items/{id}/health` responde 404
  (*"Items with buying mode 'buy_it_now' are not allowed"*).

### `available_upgrades`

```json
[{ "site_id": "MLB", "id": "gold_pro", "name": "Premium" }]
```

Veio igual nos três: o ML informa que dá para subir de Clássico para Premium.

---

## 3. Visitas — funciona em 100% dos anúncios

| Endpoint | Devolve | Trad. |
|---|---|---|
| `GET /items/{id}/visits/time_window?last=30&unit=day` | série **diária** de visitas do anúncio | ✅ |
| `GET /users/{id}/items_visits/time_window?last=30&unit=day` | mesma série, agregada por vendedor | ✅ |

⚠️ `GET /visits/items?ids=` (em lote) responde **400 — "maximum amount of items to query
is 1"**. É uma chamada por anúncio. Medido: ~188 ms cada, 12 de 12 responderam 200.

---

## 4. Catálogo — rico, mas **não** serve anúncio tradicional

| Endpoint | Devolve | Trad. |
|---|---|---|
| `GET /items/{id}/price_to_win` | preço para ganhar + alavancas + fatia de visitas | ❌ |
| `GET /products/{id}` | `buy_box_winner`, `pdp_types`, `permalink`, `name` | ❌ |
| `GET /products/{id}/items` | **todos os concorrentes com preço e logística** | ❌ |
| `GET /products/search?q=` | produtos de catálogo por termo | ❌ |
| `GET /catalog_quality/status?item_id=` | `status`, `domains`, `group_members` | ❌ |

### Payload de `price_to_win`

```json
{
  "current_price": 29.9,
  "price_to_win": 29.9,
  "status": "winning",
  "visit_share": "maximum",
  "competitors_sharing_first_place": 0,
  "winner": { "item_id": "MLB3617500999", "price": 29.9 },
  "boosts": {
    "fulfillment": true,       "free_shipping": true,
    "same_day_shipping": true, "free_installments": false,
    "cross_docking": false,    "drop_off": false
  },
  "reason": []
}
```

Em anúncio tradicional devolve `status: "not_listed"` e `price_to_win: null`.
Na varredura dos 17 ativos do sócio: **11 catálogo, 6 tradicionais** (35% fora).

### `/products/{id}/items`

Por oferta: `item_id`, `price`, `original_price`, `seller_id`, `listing_type_id`,
`official_store_id`, `shipping.logistic_type`, `tags`, `deal_ids`.
**Não** traz `sold_quantity` nem `available_quantity` de terceiro.

⚠️ `buy_box_winner` veio **`null` em 20 de 20** consultas — não dá para afirmar quem
ganha o catálogo por essa via.

---

## 5. Nicho e categoria

| Endpoint | Devolve | Trad. |
|---|---|---|
| `GET /trends/MLB` | 50 termos mais buscados do site — `{keyword, url}`, **sem volume** | ✅ |
| `GET /trends/MLB/{categoria}` | mesma coisa **por categoria** (8–12 termos) | ✅ |
| `GET /categories/{id}` | `total_items_in_this_category`, `path_from_root`, `settings` | ✅ |
| `GET /categories/{id}/attributes` | todos os atributos possíveis, com `tags.required` | ✅ |
| `GET /sites/MLB/domain_discovery/search?q=` | mapeia um termo para domínio/categoria | ✅ |
| `GET /highlights/MLB/category/{id}` | top da categoria, **com `position`** | ⚠️ |

⚠️ **`/highlights` mistura três tipos:** `PRODUCT` (catálogo), `ITEM` (anúncio avulso) e
`USER_PRODUCT` (agrupamento do vendedor). Só os `PRODUCT` encadeiam com
`/products/{id}/items` — cerca de **40%**. E não são 20 fixos: medido 11, 20 e 18 em três
categorias.

**Exemplo de tamanho de nicho:** categoria `MLB85861` tem **63 atributos possíveis**,
3 obrigatórios; o anúncio testado preenchia 31.

---

## 6. Tarifa e modalidade

| Endpoint | Devolve | Trad. |
|---|---|---|
| `GET /sites/MLB/listing_prices?price=&category_id=&listing_type_id=` | comissão exata daquele preço, categoria e modalidade | ✅ |
| `GET /sites/MLB/listing_types` | as 7 modalidades do site | ✅ |

Medido em `MLB388338`, Clássico: comissão **linear de 11,5%** de R$ 29,90 a R$ 149,90,
com `fixed_fee: 0`. **Não há degrau de custo fixo nessa faixa** — a descontinuidade que
existe no ML é de frete, não de comissão.

---

## 7. Promoções — funciona nos dois tipos

| Endpoint | Devolve | Trad. |
|---|---|---|
| `GET /seller-promotions/users/{id}?app_version=v2` | campanhas em que a conta pode entrar | ✅ |
| `GET /seller-promotions/items/{id}?app_version=v2` | **as promoções oferecidas para aquele anúncio** | ✅ |

Um anúncio **tradicional** devolveu **8 promoções simultâneas**:

```json
{ "id": "P-MLB17693006", "type": "SMART", "status": "candidate",
  "name": "PROMO PET JUL-AGO/26",
  "original_price": 39.90, "price": 38.70,
  "meli_percentage": 0.4,      // quanto o ML banca
  "seller_percentage": 2.7 }   // quanto o vendedor banca

{ "id": "LGH-MLB1000", "type": "LIGHTNING",
  "original_price": 39.90, "price": 37.90, "min_discounted_price": 7... }
```

O campo que quase ninguém olha é a **divisão do desconto**: há promoção co-financiada
pelo ML e promoção 100% paga pelo vendedor, e elas aparecem lado a lado.

---

## 8. Perguntas

| Endpoint | Devolve | Trad. |
|---|---|---|
| `GET /questions/search?seller_id=` | perguntas com filtros e ordenações disponíveis | ✅ |
| `GET /my/received_questions/search` | as recebidas pela conta autenticada | ✅ |

---

## 9. O que NÃO funciona

| Endpoint | Resposta | O que isso impede |
|---|---|---|
| `GET /sites/MLB/search?q=` | **403 forbidden** | **posição por termo de busca** — é o que o Mercado Turbo usa |
| `GET /sites/MLB/search?category=` / `?seller_id=` | 403 | qualquer varredura de resultado |
| `GET /items/{id}` de **terceiro** | 403 | ver preço/dados de concorrente fora do catálogo |
| `GET /users/{outro}/items/search` | recusado | listar anúncios de concorrente |
| `GET /suggestions/items/{id}/details` | 404 *"Price suggestion not found"* | preço sugerido para tradicional |
| `GET /items/{id}/similar` | 404 | anúncios parecidos |
| `GET /items/{id}/health` | 404 | score de qualidade do anúncio |
| `GET /items/{id}/competition` | 404 | concorrência fora do catálogo |
| `GET /items/{id}/shipping_options` | 400 *Invalid destination* | precisa de CEP de destino |
| `GET /moderations/infractions/users/{id}` | 404 | infrações da conta |
| Qualquer chamada **anônima** | 403 `PolicyAgent` | tudo sem token |

**O 403 da busca é o divisor.** Apps **certificados** (o Mercado Turbo é *Certified
Platinum*) têm acesso; nós não. É o que separa "posição do anúncio no termo X" de
"impossível sem certificação".

---

## Como reconferir

```
node --env-file=.env.local scripts/ml-endpoints-probe.mjs
```

Testa os principais e imprime o status de cada um. Preso na conta `648425194`; outra
exige `ML_SELLER_ID` explícito.

⚠️ O ML **muda regra sem aviso e sem changelog público**. Esta lista é foto de
14–15/08/2026 — reconfira antes de apostar numa ideia.

---

## Onde procurar oportunidade

Três filtros que ajudam a descartar rápido:

1. **Serve anúncio tradicional?** Boa parte da base não usa catálogo. Ideia marcada ❌
   atende só uma fatia.
2. **O ML já mostra isso na tela dele?** Se mostra, o valor tem que estar em juntar,
   comparar no tempo, ou cruzar com custo — não em exibir.
3. **O que só nós temos?** Custo real por SKU, com vigência, e a taxa efetiva paga em
   cada pedido. Nenhum endpoint acima sabe disso.
