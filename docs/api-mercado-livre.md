# Mercado Livre API — endpoints usados e lições aprendidas

Referência interna do SellerCore. Base: `https://api.mercadolibre.com` (`src/lib/integrations/mercadoLivre.ts`). Atualize sempre que um endpoint novo entrar ou uma pegadinha nova for descoberta.

## Auth

- `POST /oauth/token` — `grant_type=refresh_token` com `MELI_CLIENT_ID` / `MELI_CLIENT_SECRET`. ⚠️ O refresh token do ML é **rotativo**: cada refresh devolve um token novo que INVALIDA o anterior — sempre persistir o novo imediatamente (o legado já faz isso).

## Pedidos (a base do faturamento)

| Endpoint | Uso | Observações |
|---|---|---|
| `GET /orders/search?seller={id}&order.date_created.from=...&order.date_created.to=...&sort=date_desc&limit&offset` | Ingestão de pedidos (`mercadoLivreSync.ts`, overview legado) | Paginação por `offset` (máx. 51 pedidos/página na prática com limit=51). Datas em ISO com offset. |
| `GET /shipments/{id}/costs` | Custo real de frete do vendedor | Usado no sync e webhook. `senders[].cost` = frete pago pelo vendedor; `receiver.cost` = frete do comprador. |

### ⚠️ A regra do faturamento (validada ao centavo — Mercado Turbo, conta 648425194)

```
Faturamento BRUTO ML = vendas APROVADAS + CANCELADAS (paid_amount dos itens, SEM frete do comprador)
```

📌 **Incluir canceladas é correto e proposital** — é assim que o painel do ML mostra, e o
bruto existe justamente para a vendedora **conferir** contra a tela que ela conhece.

⚠️ **Não confundir com o faturamento CONCILIADO**, que é outra pergunta e usa
`[paid, shipped, delivered]` (só aprovadas, sem canceladas) em **todos** os canais — é a
base de margem, ROI e lucro. Ver [ADR-020](./adr/ADR-020-definicao-unica-de-faturamento.md).

Em 20/08/2026 esta regra chegou a ser trocada por engano (uniformização mal interpretada)
e foi **revertida no mesmo dia**. Se alguém propuser "uniformizar o faturamento", leia o
ADR-020 antes: bruto e conciliado são indicadores distintos de propósito.

- No canônico: `GROSS_STATUSES = [paid, shipped, delivered, cancelled]` somando `gross` (produto, sem `buyer_shipping`). Implementado em `mercadoLivreOverviewCanonical.ts`.
- `REVENUE_STATUSES = [paid, shipped, delivered]` = só aprovadas (exibida como métrica separada).
- **Não** somar frete do comprador no faturamento. **Não** excluir canceladas do faturamento bruto — o painel do ML conta as duas.
- Painel do ML opera no fuso `America/Sao_Paulo` — todo agrupamento por dia usa `AT TIME ZONE 'America/Sao_Paulo'` no SQL; exibição usa `brTime`/`brDate` (`src/lib/datetime.ts`).
- **"Últimos N dias" = dia-calendário, não janela rolante** (validado 2026-07-22, diferença de R$ 46,99): o painel conta desde **00:00 de N dias atrás** (fuso SP), não `now − N×24h`. Janela rolante descarta o começo do dia-limite e o valor "para de bater". Corrigido em `overview/route.ts`, `mercadoLivreOverviewMaterializer.ts` e no fallback de `mercadoLivre.ts`.

## Anúncios / itens

| Endpoint | Uso | Observações |
|---|---|---|
| `GET /users/{id}/items/search?limit=200` | IDs dos anúncios do vendedor | Também com `status=active&limit=1` para contagem rápida. Paginação `scan` para catálogos grandes. |
| `GET /items?ids=ID1,ID2,...` | Multiget de itens (lote de até 20) | Muito mais eficiente que 1 a 1. |
| `GET /items/{id}` | Detalhe de um item | — |
| `PUT /items/{id}` | Atualizar item (preço, estoque, status) | — |
| `GET /items/{id}/sale_price?context=channel_marketplace` | Preço promocional real | O `price` do item não reflete promoção ativa; este endpoint sim. |
| `GET /users/{id}/shipping_options/free?...` | Custo de frete grátis por item | Estimativa do custo do vendedor para item com frete grátis. |

## Catálogo (user products)

| Endpoint | Uso | Observações |
|---|---|---|
| `GET /products/{id}` | Produto de catálogo | — |
| `GET /products/{id}/items?limit=100` | Concorrentes no mesmo catálogo | Quem disputa o buy box do catálogo. |
| `GET /catalog_domains/{domain}/categories` | Categorias do domínio | — |
| `GET /users/{id}/items/search?user_product_id={id}` | Meus itens ligados a um user product | — |

> 📍 **Mapa completo do que dá para puxar:**
> [`api-mercado-livre-superficie.md`](./api-mercado-livre-superficie.md) — os 25
> endpoints que responderam 200 em 14–15/08/2026, com o payload de cada um e a marcação
> de quais servem **anúncio tradicional** (e não só catálogo).

## Endpoints bloqueados pelo ML (verificado em 2026-07-23)

Testado com o token da conexão **e** anonimamente. O ML fechou a busca e a
consulta a itens de terceiros. Apps **certificadas/parceiras** (ex.: Mercado
Turbo) têm acesso elevado que nós não temos. **Não reintroduzir esses caminhos.**

> Evidência de como o Mercado Turbo faz o "sua posição no termo X" (print de
> 03/08/2026): a ferramenta declara varrer "as primeiras 20 páginas (1000
> anúncios)" — 20×50, o teto de paginação do `/sites/MLB/search` — e avisa que "a
> busca direta pelo site pode variar a ordenação (buscas recentes, localização)",
> ou seja, usa a **ordenação canônica da API**, não scraping do site. A feature é
> trivial; o valor está na **certificação**. Destrave: programa de parceiros do ML
> (análogo à candidatura Solution Provider da Amazon, também pendente).

| Endpoint | Resultado |
|---|---|
| `GET /sites/{site}/search?q=...` | ❌ `403 forbidden` |
| `GET /sites/{site}/search?category=...` | ❌ `403 forbidden` |
| `GET /sites/{site}/search?seller_id=...` | ❌ `403 forbidden` |
| `GET /users/{OUTRO_id}/items/search` | ❌ `Searching another user items is restricted.` |
| `GET /items/{id}` de item de **TERCEIRO** | ❌ `403 forbidden` (**apertou em 2026-08-03** — em 23/07 ainda funcionava; para itens **próprios** segue OK) |
| Qualquer chamada **anônima** (sem token) | ❌ `403` — `blocked_by: PolicyAgent` |

Consequências: (1) não dá para descobrir o anúncio de **outro** vendedor a partir
de um `user_product` (MLBU) — `getMercadoLivrePublicListing` devolve título, foto
e categoria (pelo domínio) com **preço em branco**, e a calculadora deixa o campo
editável; (2) inviabiliza ranqueamento por termo de busca; (3) todo fallback
"tenta público sem token" virou código morto — foram removidos.

Continuam funcionando (com token, reverificado em 2026-08-03):
`/users/{me}/items/search`, `/items/{id}` **só de itens próprios**,
`/items/{id}/sale_price`, `/sites/{site}/listing_prices`,
`/catalog_domains/{domain}/categories`, `/users/{id}` (dados públicos de
terceiro), `/highlights/{site}/category/{id}` (top 20 da categoria, com
`position` e ids `PRODUCT`/`ITEM`), `/trends/{site}` (50 termos mais buscados) e
`/products/search?q=` (produtos de catálogo; devolve identidade, sem preço).

**Pesquisa de mercado — o que sobrou de útil (sondado em 2026-08-03):**

- `/products/{id}` → `buy_box_winner` (item, preço, seller, tipo de envio) — pode
  vir `null` mesmo em produto ativo.
- `/products/{id}/items` → **concorrentes do catálogo com preço**, seller_id,
  listing_type, official_store e shipping. **Sem** `sold_quantity` e **sem**
  `available_quantity`.
- Consequência: no ML **não existe** equivalente ao BSR por anúncio nem venda de
  terceiro (`sold_quantity` ficou inacessível). Posição só existe no **top 20 por
  categoria** (highlights). Em compensação, **preço da concorrência de catálogo**
  e **termos mais buscados** são dados que a Amazon não dá.

## Webhooks (`mercadoLivreWebhook.ts`)

- Tópicos aceitos: `orders_v2`, `items`, `items_prices`, `shipments` (`SUPPORTED_TOPICS`).
- Notificação traz só `resource` (ex.: `/orders/123`) — sempre re-buscar o recurso na API; dedupe por `_id`/chave composta antes de processar.
- Responder 200 rápido e processar depois (fila em banco) — o ML re-tenta e pode desconectar o webhook se demorar.

## Fees e impostos

- Comissão (`sale_fee`) vem em `order_items[].sale_fee` no pedido — por unidade; multiplicar pela quantidade.
- Frete do vendedor via `/shipments/{id}/costs` (não confundir com o do comprador).
- Imposto: percentual configurável do vendedor (`mercadoLivreTaxRate` — não vem da API).
- Taxonomia canônica: `commission`, `shipping_seller`, `fulfillment`, `payment`, `ads`, `taxes_withheld`, `refund`, `other`.

## A declaração de base SOBREVIVE no ML — e isso é correto

⚠️ **Se você chegou aqui porque viu a frase "sobre R$ X apurados de R$ Y" na tela
do Mercado Livre e achou que é conserto que faltou: não é.** O ML é o único dos
quatro canais onde ela continua aparecendo depois da unificação de base de
01/09/2026, e continuar é o comportamento certo.

**O motivo é que o card e a base respondem a perguntas diferentes:**

| o que | o que soma | por quê |
|---|---|---|
| **card de Faturamento** | aprovadas **+ canceladas**, só produto, sem frete | espelha "Vendas brutas" do painel do ML, que é o número que a vendedora confere contra eles (ADR-020) |
| **base do lucro** | todo pedido **não cancelado**, pendente inclusive | venda cancelada **não tem custo nem tarifa**; somá-la à receita inflaria o resultado com dinheiro que não entrou |

Nos outros três canais as duas coincidem depois da mudança e a frase some sozinha
— `declaracaoDeBase` devolve `null` quando o faturamento exibido não é maior que
a base. No ML elas divergem **pelo valor exato das canceladas**, e por isso a
frase fica.

📌 **A distinção que importa, e ela vale além deste caso:** em 31/08/2026 a
Amazon tinha duas bases respondendo à **mesma** pergunta, e uma delas estava
errada — ali a frase era o curativo de um defeito. Aqui são **duas perguntas
diferentes**, cada uma com a resposta certa, e a frase é a informação que liga
uma à outra. Declaração que explica diferença real informa; declaração que
explica defeito esconde.

Medido em 01/09/2026: as canceladas valiam R$ 11.272,10 em 30 dias na conta
`1191100170` e R$ 108,13 na `648425194`.

### E o caminho legado declara que NÃO tem essa base

`getMercadoLivreOverview` (leitura ao vivo da API do ML) não consegue produzir o
faturamento sem uma varredura que a tela não pode pagar — é justamente o custo
que o canônico existe para evitar. Ele devolve **`revenueDoLucro: null`**, e a
tela cai no comportamento anterior.

⚠️ **Preencher esse campo com o apurado seria pior que deixá-lo nulo**: afirmaria
que as duas bases coincidem quando elas não coincidem, e a declaração sumiria da
tela exatamente no caminho onde ela é mais necessária.

### O ABC continua no apurado, e há uma condição escrita para isso mudar

`mercadoLivreAbc.ts` calcula a margem **por produto** sobre a receita apurada, e
foi **revisado e mantido** em 01/09/2026. O ML **não tem tarifa estimada**:
`acc.fees` só existe para pedido com repasse postado. Dividir a contribuição pela
receita total somaria receita sem a tarifa correspondente e **inflaria a margem
por produto** — o defeito que a decisão de 29/08/2026 corrigiu ali.

Medido antes de decidir: **zero pedidos sem repasse** nas duas contas em 30 dias,
então a troca não moveria número nenhum hoje e só criaria risco no dia em que o
ML atrasar o repasse.

**Destravador registrado:** tarifa estimada no ML. No dia em que existir, o ABC
passa a dividir pela total como os outros — e aí é seguro, porque o numerador
também cobre o pendente.


## Changelog observado (mais recente primeiro)

- **2026-09-06 — TACOS DO ML: o que eu medi ANTES de escrever o produtor.**
  Três perguntas, três respostas, e duas mudaram o desenho.

  **1) A base certa é o NÃO CANCELADO, não a do painel.** O ML tem duas bases de
  propósito: `paid_revenue` (aprovadas + canceladas, que espelha as "Vendas
  brutas" do painel dele, ADR-020) e `faturamento` (todo pedido não cancelado,
  que é a base do lucro). **TACOS usa a segunda** — cancelada no denominador o
  infla, e denominador inflado produz percentual MENOR que a realidade, que é
  exatamente o "mentir para baixo" que a garantia proíbe.

  **2) NÃO existe análogo de "sem repasse postado" neste canal.** Na Amazon a
  recusa existe porque a base do card é o APURADO e ele chega na liquidação. No
  ML a base sai do próprio pedido, no instante em que ele existe. **Implantar a
  recusa da Amazon aqui seria defesa contra um problema que o canal não tem** —
  e foi por isso que a regra da casa manda replicar a garantia, nunca o
  mecanismo. O buraco análogo do ML é outro: pedido não cancelado com
  `gross IS NULL`. Ele ENCOLHE o denominador, o que faz o TACOS subir — lado
  seguro, então é **declarado** (`pedidosSemValor`) em vez de bloquear.

  **3) ⚠️ O GASTO DE ADS VOLTOU A SER CONFIÁVEL — e sem esta medição eu teria
  publicado um número 17× inflado.** Em 30/08/2026 o console do ML mostrava
  R$ 44,00 / 71 cliques e nós tínhamos gravado **R$ 768,86 / 1.228 cliques** (a
  janela de 7 dias do PADS carimbada como UM dia). O agendador foi corrigido —
  um pedido por dia, soma feita por nós — e **medido hoje, o mesmo 30/08 lê
  R$ 46,55 / 84 cliques**, contra os R$ 44,00 do console. Diferença de ~6%, que
  vale registrar e não explicar por chute.

  📌 O gasto do ML mora em `workspace_ad_product_metrics` (por produto), não em
  `workspace_ad_metrics` (por campanha) — o helper `anuncioDoCanal` já cai no
  segundo quando o primeiro não tem linha. E o **dia corrente ainda soma**: o
  payload devolve `tacosAteDia` para a tela poder dizer até quando conta.

  Medido no produtor, conta `1191100170`: **1 dia 2,98% · 7 dias 1,03% ·
  30 dias 0,50%**.

  ⚠️ E TACOS existir aqui **não** contradiz a decisão de 30/08 de tirar o
  anúncio do LUCRO do ML (*"o ads o seller desconta depois, no seu próprio
  fechamento"*). Lucro SUBTRAI; TACOS só DIVIDE. São perguntas diferentes, e
  nenhum número do lucro mudou.


- **2026-08-31** — **As duas visões do PADS consolidam em velocidades
  diferentes, e o dia recente ainda se move.** O `ads/search` (por anúncio) e o
  `campaigns/search` (por campanha) do mesmo advertiser, mesma janela de um dia,
  não devolvem o mesmo total enquanto o dia está fresco:

  | dia | `campaigns/search` | `ads/search` | |
  |---|---|---|---|
  | 29/08 | R$ 69,66 · 95 cliques | R$ 69,66 · 95 cliques | confere na vírgula |
  | 30/08 | R$ 53,05 · 106 cliques | R$ 46,55 · 84 cliques | **não confere** |

  E o mesmo dia encolheu entre duas leituras nossas: uma sonda às ~02h BRT deu
  **R$ 46,78 / 80 cliques** para 30/08, e a coleta minutos depois deu **R$ 46,55
  / 84**. **Dia fechado não encolhe** — então ele não tinha fechado.

  ⚠️ **Consequência prática:** a checagem `conferirContraCampanha` do nosso
  coletor vai acusar divergência no dia corrente e no último dia fechado, e o
  palpite que ela imprime ("provável duplicata não tratada") está **errado**
  nesse caso. Não é duplicata: é a fonte consolidando. Divergência em dia ANTIGO
  continua sendo sinal de verdade.

  Isso é o que torna correto recolher os últimos dias a cada ciclo em vez de uma
  vez só: o upsert reescreve o dia até ele parar de mudar.

- **2026-08-31** — **O PADS aceita janela de um dia (`date_from = date_to`) e
  devolve o AGREGADO da janela pedida.** Óbvio em retrospecto, e custou caro:
  pedíamos oito dias e gravávamos o resultado carimbado como um, então cada
  linha "diária" da nossa tabela era a soma de oito — até **17× o valor real**.
  Medido no mesmo minuto, mesma conta: um dia = R$ 46,78 / 80 cliques (batendo
  com o console de Ads); oito dias = R$ 771,93 / 1.237 cliques (batendo com o
  que estava gravado).

  O que denunciou não foi o dinheiro: foi o **clique errar pelo mesmo fator**.
  Clique não tem moeda, então câmbio e centavos morreram sem outra medição.
  Quando duas grandezas de naturezas diferentes erram pelo mesmo fator, a causa
  está no que elas **compartilham** — e o que elas compartilhavam era a janela.

- **2026-08-27** — **`available_quantity` no Full é POR OFERTA, e várias ofertas
  dividem o mesmo estoque.** No Full o estoque pertence ao produto do vendedor
  (`user_product`), não ao anúncio: o anúncio do catálogo e o próprio apontam
  para o mesmo lote e **cada um reporta a mesma quantidade**. Medido no banco de
  produção: o SKU `AREIA-MAGICA-300G` aparece em 3 ofertas Full com 159 unidades
  cada — somar daria 477 e triplicaria o capital; o estoque real é 159.
  `MESA-INFANTIL-MELI`: 2 ofertas × 213, soma 426. Quem for agregar estoque do
  Full precisa contar por grupo (máximo), nunca `SUM`.

  ⚠️ **A chave certa vem quase sempre `null`.** O identificador bom é o
  `user_product_id`, que `/items` já devolve e o sync já lê
  (`mercadoLivre.ts:216`) — mas só **1 de 29** ofertas Full com estoque tinha o
  campo preenchido; as 3 do AREIA vinham `null`. Sem ele, o desempate possível é
  o SKU do vendedor. Se um dia for preciso precisão maior, a fonte é
  `/user-products/{id}/stock`, que custa uma chamada por produto e não está no
  orçamento do cron hoje.

  ⚠️ **Anúncio `closed` pode ter estoque no Full.** Na conta medida, o ÚNICO
  item com saldo (32 unidades) estava num anúncio fechado. Filtrar a lista por
  status ativo esconderia capital que continua parado no centro de distribuição.

- **2026-08-15** — **A API do Mercado Pago abre com o MESMO token do ML.** Não
  precisa de credencial nova nem de novo OAuth: basta trocar o host para
  `https://api.mercadopago.com`. É a fonte de saldo, retenção e tarifa real.

  | Endpoint | Resposta | Serve para |
  |---|---|---|
  | `GET /v1/payments/{id}` | 200 | liberação, líquido e tarifas do pagamento |
  | `GET /v1/payments/search` | 200 | varredura (226 pagamentos na conta 648425194) |
  | `GET /v1/account/settlement_report/list` | 200 | relatórios de liquidação |
  | `GET /v1/account/release_report/list` | 200 | relatórios de liberação (vazio até gerar) |
  | `GET /users/{id}/mercadopago_account/balance` | **403** | legado — não usar |

  Campos que importam (medidos no pagamento `173015808309`):

  ```
  money_release_date    "2026-09-13T00:42:51.000-04:00"   ← quando o dinheiro cai
  money_release_status  "pending"                          ← retido x liberado
  transaction_amount    35.33                              ← o que o comprador pagou
  transaction_details.net_received_amount  24.62           ← o que sobra de fato
  charges_details  [ shp_fulfillment 6.65 (shipping),
                     ml_sale_fee     4.02 (fee),
                     mp_processing_fee 0.04 (fee) ]        ← tarifa DISCRIMINADA
  ```

  - `money_release_date` é o equivalente do `maturityDate` da Amazon; `pending`
    vs liberado é o equivalente de `DEFERRED`/`RELEASED`.
  - **`net_received_amount` é melhor do que o que calculamos hoje**: é o líquido
    informado pela fonte, não uma estimativa a partir de `sale_fee`.
  - `charges_details` discrimina a tarifa por nome — hoje o painel do ML mostra
    "Tarifa de venda" como um bloco só.
  - Amostra de 30 pagamentos recentes da conta 648425194: **R$ 1.027,50 a
    liberar** e R$ 108,48 já liberado.
  - ⚠️ Pagamento `rejected` vem com `money_release_date: null` — não confundir
    com "retido para sempre".


- **2026-08-15** — **CORREÇÃO da entrada anterior: a API do ML NÃO bloqueia a rede
  de desenvolvimento.** A conclusão de que havia bloqueio por IP estava errada e
  ficou registrada aqui por algumas horas — está desmentida por medição:
  `GET /categories/MLB1051` responde **200** da mesma máquina, e
  `www.mercadolivre.com.br` também. Só `/sites/*` devolve 403, que é a restrição
  **por certificação** já conhecida, não bloqueio de origem.
  - **A causa real dos 403 autenticados:** os tokens são guardados **cifrados**
    (`enc:v1:`, AES-256-GCM, chave `INTEGRATION_TOKEN_KEY`). Mandar o valor do
    banco direto como `Bearer` envia o ciphertext, e o ML responde 403
    `PolicyAgent` — não 401, o que induz ao erro. **Sempre passar por
    `revealSecret()`** (`src/lib/integrations/secrets.ts`) antes de usar. Vale
    igual para TikTok, Amazon e Shopee.
  - Com o token decifrado: `/users/me` → 200 (NEXAHUBBRASIL) e `/orders/search`
    → 200 com 179 pedidos, direto da máquina local.
  - Segue valendo: os segredos são `MELI_CLIENT_ID` / `MELI_CLIENT_SECRET`, e
    **nunca renovar token fora do app** (o ML rotaciona o refresh a cada uso).

- **2026-08-15** — **Data de liberação do dinheiro não vem pela API de pedidos.**
  Os pagamentos em `GET /orders/{id}` trazem `status`, `date_approved`,
  `transaction_amount`, `total_paid_amount`, `coupon_amount`, `marketplace_fee`,
  `taxes_amount`, `shipping_cost`, `deferred_period` — mas **não**
  `money_release_date`. Saldo e retenção ficam do lado do Mercado Pago e exigem
  permissão que a aplicação não tem hoje:
  - `GET /users/{id}/mercadopago_account/balance` → **403 ForbiddenApiError**
  - `GET /v1/payments/{id}` → **404** (namespace do MP, credencial própria)
  - Consequência: o bloco "saldo e retenção" do ML depende de autorização
    adicional no Mercado Pago. O `coupon_amount` do pagamento, porém, está
    acessível e é o candidato para auditar cupom no ML.

- **2026-08-15** — **Pedido real não guarda `raw`.** `workspace_channel_orders.raw`
  está preenchido só nos 186 pedidos da conexão `demo`; nas duas conexões reais
  (36.317 e 192 pedidos) é `NULL`. Auditoria retroativa de desconto, cupom ou
  `full_unit_price` é impossível pelo banco — só relendo a API.

O ML muda regra **sem aviso e sem changelog público** — já aconteceu duas vezes em duas
semanas. Toda mudança de comportamento observada na API entra aqui, com data; o detalhe
fica nas seções acima.

- **2026-08-03** — `GET /items/{id}` de item de **terceiro** passou a retornar `403`
  (em 23/07 ainda funcionava). Itens próprios seguem OK. Na mesma data: re-verificados
  os endpoints que continuam abertos e sondados os `/products/*` (ver seção de pesquisa
  de mercado).
- **2026-07-23** — Verificado o bloqueio de `/sites/{site}/search` (todas as variantes:
  `q`, `category`, `seller_id`), de `/users/{outro}/items/search` e de qualquer chamada
  anônima (`blocked_by: PolicyAgent`). Fallbacks "tenta público sem token" viraram código
  morto e foram removidos.
- **2026-07-22** — Validada a regra **"últimos N dias = dia-calendário"** (fuso SP), não
  janela rolante — diferença de R$ 46,99 contra o painel até corrigir.

## Pegadinhas gerais

- **Status canônicos**: `paid` ← paid/payment_required(pago), `cancelled` ← cancelled, etc. Mapeamento em `mercadoLivreNormalizer`. O ML muda status do pedido sem notificar em alguns fluxos — o sync por janela de datas cobre isso.
- **Rate limit**: multiget e paginação com parcimônia; erro 429 pede backoff.
- **IDs**: seller/account id é numérico; anúncios são `MLB...`; pedidos numéricos; shipments numéricos.
