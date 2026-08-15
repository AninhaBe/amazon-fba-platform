# Superfície da API do Mercado Livre — o que dá para puxar hoje

**Levantado em 14–15/08/2026**, com token real da conexão, **somente leitura**, testando
um por um. Não é lista de documentação: é o que **respondeu de verdade** com as nossas
credenciais.

Serve para responder em minutos, não em um dia: *"dá para fazer X no ML?"*.

> **Este documento é para quem não programa.** Cada seção diz o que dá para pedir ao
> Mercado Livre e, principalmente, **o que significa cada informação que ele devolve**.
> Onde aparecer `algo_assim`, é o nome técnico do campo — só o rótulo que o ML usa.

> **Como ler a coluna "Tradicional?":** o ML tem dois tipos de anúncio. O **de catálogo**
> é aquele em que vários vendedores disputam a mesma página de produto. O **tradicional**
> é a página só sua. **Boa parte dos vendedores usa tradicional** — então recurso marcado
> com ❌ atende só uma fatia do mercado.

**Contas usadas:** `648425194` (NEXAHUBBRASIL, nossa) para o que é do site;
`1191100170` (CRYSTALFANCY, do sócio — **leitura autorizada**) para o que é de anúncio,
por ser a única com catálogo ativo.

---

## Resumo

| | |
|---|---|
| Endpoints testados | 33 |
| **Funcionaram** | **25** |
| Recusados | 8 |
| A recusa que mais dói | a **busca do site** — é o que impede saber sua posição num termo |

---

## 1. Conta e vendedor

### `GET /users/{id}` — quem é o vendedor

| Campo | O que é |
|---|---|
| `nickname` | o apelido público da loja (ex.: NEXAHUBBRASIL) |
| `registration_date` | quando a conta foi criada no ML |
| `permalink` | o endereço público do perfil |
| `seller_reputation` | a reputação: medalha, nível de cor, e as taxas de reclamação, cancelamento e atraso |

✅ Funciona para tradicional.

### `GET /users/{id}/items/search` — a lista dos seus anúncios

Devolve os **códigos** dos seus anúncios (aqueles `MLB...`), em páginas. Aceita filtrar
por `status=active` para trazer só os que estão no ar.

Serve como ponto de partida: pega a lista aqui, depois pede o detalhe de cada um.

⚠️ **Só funciona para a sua própria conta.** Pedir a lista de anúncios de um concorrente
é recusado.

---

## 2. O anúncio (só os seus)

### `GET /items/{id}` — a ficha completa do anúncio

Os campos que importam, medidos em três anúncios **tradicionais** do sócio:

| Campo | O que é |
|---|---|
| `catalog_listing` | `true` se o anúncio disputa uma página de catálogo; `false` se é página própria |
| `listing_type_id` | a modalidade: `gold_special` é **Clássico**, `gold_pro` é **Premium** |
| `sold_quantity` | **quantas unidades já vendeu** (13, no exemplo) — disponível para anúncio seu |
| `available_quantity` | quantas unidades ainda tem para vender |
| `pictures` | quantas fotos o anúncio tem |
| `attributes` | quantos campos da ficha técnica estão preenchidos |
| `tags` | selos que o ML atribui — ver abaixo |
| `shipping` | como o produto é enviado — ver abaixo |
| `health` | seria uma nota de qualidade do anúncio, mas **vem vazia** no tradicional |

**Os selos (`tags`) são o julgamento do ML sobre o anúncio.** Exemplos reais:

| Selo | O que quer dizer |
|---|---|
| `good_quality_thumbnail` | a foto de capa está boa |
| `cart_eligible` | o produto pode ir para o carrinho junto com outros |
| `immediate_payment` | exige pagamento imediato |
| `user_product_listing` | é anúncio próprio, não de catálogo |

**A ausência de um selo também informa.** Se `good_quality_picture` não aparece, o ML não
considerou as demais fotos boas.

**Dentro de `shipping`:**

| Campo | O que é |
|---|---|
| `logistic_type` | `fulfillment` = está no **FULL** (estoque no armazém do ML). Outros valores significam que você mesma envia |
| `free_shipping` | se você oferece frete grátis |
| `mode` | o modo de envio (`me2` = Mercado Envios) |

### `GET /items/{id}/sale_price` — o preço de agora

Payload real: `{"price_id":"3","amount":34.9,"regular_amount":null,"reference_date":"2026-08-15T16:41:30Z","metadata":{}}`

| Campo | O que é |
|---|---|
| `amount` | **o preço que o comprador paga hoje** — R$ 34,90 no exemplo |
| `regular_amount` | **o preço "de", riscado.** Veio **vazio** aqui porque não há promoção. Quando há, este é o valor cheio antes do desconto — a diferença para o `amount` é o desconto |
| `reference_date` | **o instante da consulta**, não a data em que o preço mudou. Diz a que momento aquele preço se refere |
| `metadata` | detalhes da promoção, quando existe. Veio vazio |
| `price_id` | um identificador interno do preço |

### `GET /items/{id}/available_upgrades` — para qual modalidade dá para subir

Devolveu `[{ "id": "gold_pro", "name": "Premium" }]` nos três anúncios: **o ML está
dizendo que dá para subir de Clássico para Premium.**

Premium cobra mais comissão e oferece parcelamento sem juros.

---

## 3. Visitas — funciona em 100% dos anúncios

### `GET /items/{id}/visits/time_window?last=30&unit=day`

**Quantas pessoas abriram o anúncio, dia a dia.** É a única medida de comportamento do
comprador que temos.

| Campo | O que é |
|---|---|
| `total_visits` | total de visitas no período (92 em 3 dias, no exemplo) |
| `results` | uma entrada por dia, com `date` e `total` |
| `visits_detail` | de onde veio a visita (`company: mercadolibre`) |
| `last` / `unit` | o tamanho da janela pedida (3 dias) |

⚠️ **Os dias vêm fora de ordem.** No teste voltou 12, 13, 15, 14 — quem consumir precisa
ordenar, e não confiar na sequência.

⚠️ **É uma consulta por anúncio.** Pedir vários de uma vez é recusado
(*"maximum amount of items to query is 1"*). Medido: ~188 ms cada; 12 de 12 responderam.

Existe também a versão da conta inteira: `GET /users/{id}/items_visits/time_window`.

---

## 4. Catálogo — informação rica, mas **não serve anúncio tradicional**

### `GET /items/{id}/price_to_win` — quanto cobrar para ganhar a disputa

| Campo | O que é |
|---|---|
| `price_to_win` | **o preço necessário para ganhar aquela página de catálogo** |
| `current_price` | quanto você cobra hoje |
| `status` | `winning` = você está ganhando; `not_listed` = o anúncio não é de catálogo |
| `visit_share` | **que fatia das visitas daquela página é sua** (`maximum` no exemplo) |
| `competitors_sharing_first_place` | quantos concorrentes dividem o primeiro lugar com você |
| `winner` | quem está ganhando e por quanto |
| `boosts` | **as alavancas que não são preço** — ver abaixo |
| `reason` | por que você não está ganhando (vazio quando está) |

**`boosts` é a parte que quase ninguém olha.** São seis coisas que ajudam a ganhar sem
baixar o preço, cada uma ligada ou desligada:

| Alavanca | O que é |
|---|---|
| `fulfillment` | estar no FULL |
| `free_shipping` | oferecer frete grátis |
| `same_day_shipping` | entrega no mesmo dia |
| `free_installments` | parcelamento sem juros |
| `cross_docking` / `drop_off` | formas de envio mais rápidas |

Em anúncio tradicional devolve `status: "not_listed"` e nenhum preço. Na varredura dos 17
anúncios ativos do sócio: **11 de catálogo, 6 tradicionais** — 35% ficam de fora.

### `GET /products/{id}/items` — todos os concorrentes daquela página

Para cada oferta concorrente:

| Campo | O que é |
|---|---|
| `price` | por quanto ele vende |
| `original_price` | o preço cheio, se ele estiver em promoção (`null` = sem desconto) |
| `seller_id` | qual vendedor é |
| `official_store_id` | se é loja oficial de uma marca |
| `listing_type_id` | se o anúncio dele é Clássico ou Premium |
| `shipping.logistic_type` | **se ele está no FULL** ou envia por conta própria |
| `shipping.free_shipping` | se ele dá frete grátis |
| `seller_address` | **de qual cidade e estado ele envia** |
| `sale_terms` | a garantia que ele oferece |
| `tags` / `deal_ids` | selos e promoções em que ele entrou |

**Não vem** quanto ele já vendeu nem quanto tem em estoque.

⚠️ `buy_box_winner` (que diria quem ganha a página) veio **vazio em 20 de 20** consultas.

---

## 5. Nicho e categoria

### `GET /trends/MLB` e `GET /trends/MLB/{categoria}` — o que as pessoas estão buscando

Uma lista de termos, do mais buscado para o menos. Exemplo real da categoria de cantis:
*"cantil personalizado"*, *"cantil whisky"*, *"cantil whiskey personalizado"*.

| Campo | O que é |
|---|---|
| `keyword` | o termo que as pessoas digitam |
| `url` | o link da busca daquele termo |

⚠️ **Não vem o volume.** Você sabe a ordem, não quantas pessoas buscaram.

### `GET /categories/{id}` — o tamanho e o lugar do nicho

| Campo | O que é |
|---|---|
| `name` | o nome da categoria ("Cantis de Bolso") |
| `total_items_in_this_category` | **quantos anúncios existem competindo ali** (5.452 no exemplo) |
| `path_from_root` | o caminho completo da categoria, do geral ao específico |
| `children_categories` | as subcategorias, quando existem |

📌 **Exemplo de uso real:** o cantil do sócio está em
*Antiguidades e Coleções → Antiguidades → Cantis de Bolso*. Um cantil novo classificado
como antiguidade provavelmente está na categoria errada — e categoria errada esconde o
anúncio de quem procura.

### `GET /categories/{id}/attributes` — o que a ficha técnica pede

Todos os campos que aquela categoria aceita, e quais são obrigatórios. Medido: a
categoria do arranhador tem **63 campos possíveis**, 3 obrigatórios; o anúncio testado
preenchia 31.

### `GET /highlights/MLB/category/{id}` — os mais vendidos da categoria

O `query_data` confirma o que é: `highlight_type: "BEST_SELLER"`.

| Campo | O que é |
|---|---|
| `position` | a colocação (1 = mais vendido) |
| `id` | o código do que está naquela posição |
| `type` | **o tipo do que está ali** — e isso muda tudo |

⚠️ **Vêm três tipos misturados**, e só um deles se conecta com a lista de concorrentes:

| Tipo | O que é | Dá para aprofundar? |
|---|---|---|
| `PRODUCT` | uma página de catálogo | ✅ sim |
| `ITEM` | um anúncio avulso | ❌ não |
| `USER_PRODUCT` | um agrupamento do próprio vendedor | ❌ não |

Cerca de **40%** são `PRODUCT`. E não são 20 fixos: medido 11, 20 e 18 em três categorias.

---

## 6. Tarifa e modalidade

### `GET /sites/MLB/listing_prices` — quanto o ML cobra

Você informa preço, categoria e modalidade; ele devolve a tarifa exata.

| Campo | O que é |
|---|---|
| `sale_fee_amount` | **a comissão em reais** sobre aquele preço (R$ 11,50 sobre R$ 100) |
| `sale_fee_details.percentage_fee` | o percentual da comissão (11,5%) |
| `sale_fee_details.fixed_fee` | a parte fixa da tarifa, se houver (zero neste caso) |
| `listing_fee_amount` | quanto custa publicar (zero) |
| `listing_type_name` | o nome da modalidade em português ("Clássico") |
| `listing_exposure` | o nível de exposição da modalidade (`highest`) |
| `requires_picture` | se a modalidade exige foto |

📌 **Medido:** a comissão foi **linear em 11,5%** de R$ 29,90 a R$ 149,90, sem parte fixa.
Ou seja, **não há um degrau de custo** nessa faixa — a descontinuidade que existe no ML é
de frete, não de comissão.

---

## 7. Promoções — funciona nos dois tipos de anúncio

### `GET /seller-promotions/items/{id}` — o que o ML está te oferecendo

Um anúncio **tradicional** devolveu **8 promoções ao mesmo tempo**. Para cada uma:

| Campo | O que é |
|---|---|
| `name` | o nome da campanha ("PROMO PET JUL-AGO/26") |
| `type` | o tipo (`SMART`, `LIGHTNING` = relâmpago…) |
| `original_price` | seu preço hoje |
| `price` | o preço que você teria que praticar para entrar |
| `meli_percentage` | **quanto do desconto o Mercado Livre banca** |
| `seller_percentage` | **quanto do desconto sai do seu bolso** |
| `status` | `candidate` = oferecida, ainda não aceita |

📌 **A divisão do desconto é o campo que quase ninguém olha.** Uma promoção em que o ML
banca metade é uma decisão completamente diferente de outra em que você paga tudo — e as
duas aparecem lado a lado na mesma lista.

---

## 8. Perguntas

`GET /questions/search?seller_id=` e `GET /my/received_questions/search` devolvem as
perguntas recebidas, com filtros e ordenações disponíveis.

---

## 9. O que o ML **não** deixa fazer

| O que se queria | O que impede |
|---|---|
| **Saber sua posição num termo de busca** | a busca do site é recusada para o nosso app |
| Ver preço e dados de um concorrente fora do catálogo | consultar anúncio de terceiro é recusado |
| Listar os anúncios de um concorrente | recusado |
| Preço sugerido para anúncio tradicional | não existe |
| Ver anúncios parecidos com o seu | não existe |
| Nota de qualidade do anúncio | não existe no tradicional |
| Ver infrações da conta | não existe |

**A busca é o divisor.** Aplicativos **certificados** pelo ML (o Mercado Turbo é um
*Certified Platinum*) têm acesso a ela; nós não. É o que separa "mostrar a posição do
anúncio no termo X" de "impossível sem certificação".

---

## Como reconferir

```
node --env-file=.env.local scripts/ml-endpoints-probe.mjs
```

Testa os principais e diz o estado de cada um.

⚠️ O ML **muda regra sem avisar e sem changelog público**. Esta é uma foto de
14–15/08/2026 — reconfira antes de apostar numa ideia.

---

## Onde procurar oportunidade

Três perguntas que descartam ideia rápido:

1. **Serve anúncio tradicional?** Boa parte da base não usa catálogo. Ideia marcada ❌
   atende só uma fatia.
2. **O ML já mostra isso na tela dele?** Se mostra, o valor tem que estar em juntar,
   comparar ao longo do tempo, ou cruzar com custo — não em exibir.
3. **O que só nós temos?** O custo real por SKU, com histórico de quando mudou, e a
   tarifa efetivamente paga em cada pedido. Nenhum endpoint acima sabe disso.
