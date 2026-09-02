# Shopee Open Platform API v2 — mapa da integração

> **IMPLEMENTADA, AGUARDANDO GO LIVE** (05–06/08/2026). Conexão OAuth, dashboard e
> ingestão estão escritos e verdes; a assinatura foi validada com HTTP 200 real no
> sandbox. O que falta **não é código**: o app está em status *Developing*, e só
> depois do Go Live sai a chave de produção que permite uma loja real autorizar —
> passo de retomada em [`estado-atual.md`](./estado-atual.md).
>
> ⚠️ **Ao conectar a primeira loja real, revisar `shopeeCanonical.ts`**: o mapeamento
> de campos foi escrito contra a documentação e ainda não foi confrontado com uma
> resposta de verdade. Está isolado nesse arquivo de propósito.
>
> O canal é agnóstico no schema canônico (ver [`adr/ADR-001-modelo-canonico.md`](./adr/ADR-001-modelo-canonico.md))
> → **não precisou migration**, grava-se com `provider = 'shopee'`.

## Pré-requisito

O OAuth conecta uma *loja* (`shop_id`), então alguém precisa ter loja para autorizar.
A Ana não tem — quem tem é o sócio, e a loja dele será a primeira conexão real.

> **No Brasil o acesso tem portão de aprovação** (verificado 2026-08-04): perfil de
> desenvolvedor aprovado pela Shopee ANTES de criar app. Dois tipos possíveis:
> `Registered Business Seller` (para servir a própria loja; exige PJ com ≥1 pedido
> nos últimos 30 dias) e `Third-party Partner Platform / ISV` (para servir outros
> vendedores; **não exige ter loja**). O SellerCore usa **ISV** — aprovado em
> 05/08/2026. Passo a passo para o dono da loja: PDF
> "Shopee-Conectar-Loja-ao-SellerCore" (fora do repo — pedir à Ana).

## Credenciais e ambiente

- App criado no **Shopee Open Platform** (open.shopee.com) → `partner_id` (numérico) +
  `partner_key` (string, exibida no console como `shpk…`; **usar literal, sem tratar o
  prefixo** — validado em 05/08/2026).
- Env: `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_ENV` (`sandbox` | `live`).
- **Hosts (verificados em 05/08/2026, chamada real):**
  - produção: `https://partner.shopeemobile.com` ✔
  - sandbox: `https://openplatform.sandbox.test-stable.shopee.sg` ✔
  - ⚠️ `partner.test-stable.shopeemobile.com` (host antigo que este doc trazia)
    **não vale mais** — responde `error_sign` para credenciais válidas, o que
    despista o debug: parece chave errada, mas é host errado.
  - Não há host próprio do Brasil: o host é global e a região vem da loja.

## Assinatura (toda chamada é assinada)

- **HMAC-SHA256** com o `partner_key`.
- A *base string* varia por tipo de endpoint:
  - Público (auth): `partner_id + api_path + timestamp`
  - Shop/merchant: `partner_id + api_path + timestamp + access_token + shop_id`
- Query comum: `partner_id`, `timestamp` (epoch em segundos, janela ~5 min), `sign`, e
  (pós-auth) `shop_id`, `access_token`. ⚠️ Confirmar a ordem exata da base string por endpoint.

## OAuth (conecta 1 loja)

1. Redirecionar o vendedor para `/api/v2/shop/auth_partner` (com `partner_id`, `timestamp`,
   `sign`, `redirect` = nosso `.../api/integrations/shopee/callback`).
2. Callback recebe `code` + `shop_id`.
3. Trocar o code por token: `POST /api/v2/auth/token/get` → `access_token` (~4 h) +
   `refresh_token` (~30 dias).
4. Renovar: `POST /api/v2/auth/access_token/get` com o refresh_token.

- ⚠️ **O refresh_token ROTACIONA a cada refresh** (mesma pegadinha do ML — persistir o novo).
- Token é **por loja** → `connection_id = "shopee:<shop_id>"`.

## Pedidos

| Endpoint | Uso | Observações |
|---|---|---|
| `GET /api/v2/order/get_order_list` | lista `order_sn` por janela de tempo + status | paginação por **cursor opaco** (`next_cursor` + `more`); **janela máx 15 dias** e `page_size` de **1 a 100** — ambos confirmados na doc oficial em 05/08/2026 |
| `GET /api/v2/order/get_order_detail` | detalhe de um lote de `order_sn` | **máx 50 `order_sn`** por chamada (confirmado); itens vêm em `item_list` com `model_discounted_price` (cobrado) e `model_original_price` (lista) |

## Itens / anúncios

| Endpoint | Uso |
|---|---|
| `GET /api/v2/product/get_item_list` | lista `item_id` da loja |
| `GET /api/v2/product/get_item_base_info` | infos do item (nome, sku, preço) |

## Taxas / repasse (a fonte do lucro real)

| Endpoint | Uso | Observações |
|---|---|---|
| `GET /api/v2/payment/get_escrow_detail` | detalhe de escrow por pedido | **fonte das taxas reais**: comissão, taxa de serviço, taxa de transação, frete real. Responde **a partir de `paid`, no dia do pedido** — não espera a liquidação (medido em 29/08/2026, ver Changelog) |

## Mapeamento canônico (ver [`canonical-schema.md`](./canonical-schema.md))

- **Status** Shopee → canônico (⚠️ confirmar enum): `UNPAID→pending`,
  `READY_TO_SHIP`/`PROCESSED→paid`, `SHIPPED→shipped`, `COMPLETED→delivered`,
  `CANCELLED→cancelled`.
- **Fees** (do escrow) → taxonomia canônica: `commission_fee→commission`,
  `service_fee`/`transaction_fee→commission` (ou `payment`),
  `actual_shipping_fee→shipping_seller`/`fulfillment`. Preservar o código original em
  `provider_fee_code`.

## Account Health: códigos observados (espelho do mapa em código)

O mapa que a tela lê é `src/lib/integrations/shopeeAccountHealthMapa.ts` — este bloco é o
espelho documentado, com as fontes. **Código sem fonte não é mapeado**: a tela mostra
"código N da Shopee" (regra do desenho aprovado em 28/08/2026). Fonte "sonda 28/08/2026" =
observado nas chamadas reais à loja `275804987` (a doc oficial do open.shopee.com não é
acessível fora do console).

| Campo | Valores mapeados | Fonte |
|---|---|---|
| `overall_performance.rating` | 1 Ruim · 2 Precisa melhorar · 3 Boa · 4 Excelente | Tiers do Account Health do Seller Centre; rating 2 conferido contra a loja real com 3 métricas reprovadas |
| `metric_type` | 1 Envio · 2 Anúncios · 3 Atendimento | Sonda 28/08/2026 — agrupamento dos `metric_name` bate com os grupos `*_failed` do `overall_performance` |
| `unit` | 1 número · 2 percentual · 4 dia(s) | Sonda 28/08/2026 — 2 acompanha as taxas, 1 os números puros, 4 o tempo de preparo |
| `punishment_status` (parâmetro **obrigatório** de `get_punishment_history`) | 1 vigentes · 2 encerradas | Sonda 28/08/2026 — status=1 devolveu as vigentes (0), status=2 o histórico (12) |
| `punishment_type` (107, 108, 2008…), `reason`, `violation_type`, `reason` de `get_listings_with_issues` (3, −999) | **sem mapa** | Sem fonte acessível — ao obter a doc oficial, mapear aqui e no código com data |

`order_limit` ("95", "80") é autodescritivo: teto de pedidos em N% — a tela escreve
"Limite de pedidos em N%".

**Definições das métricas (as linhas explicativas da tela):** a fonte é o **Centro de
Educação do Vendedor** (`seller.shopee.com.br/edu`) e a Central de Ajuda
(`help.shopee.com.br`) — a doc do open platform exige login e não serve de fonte citável.
Cada entrada de `EXPLICACAO_DA_METRICA` no mapa carrega a URL do artigo e a data de
leitura. 10 das 17 métricas têm definição oficial citável; as 6 de violação de anúncio
**não** têm definição pública e ficam sem linha na tela (e a própria API as devolve com
`current_period: null`, então aparecem como "—" — ausência coerente). Consequências
detalhadas de pontos de penalidade (faixas, trimestre) só existem em blog de terceiro e
**não** entraram. Próximo a mexer aqui: não refazer a busca — os artigos-chave são
2805 (TEA), 16320/3280 (TNE), 2713 (taxa de resposta), 2787 (classificação), 19542
(tempo de preparo), 18878/3289 (pré-encomenda), 7955/18432 (sistema de pontos).

## Webhooks (opcional na v1)

Shopee tem *Push Mechanism* (partner push) para mudanças de pedido — requer configurar a
Push URL no app + verificar assinatura. Dá para começar **só com polling/cron** e adicionar
webhook depois.

## Roteiro de implementação (arquivos — mesmo padrão do Mercado Livre)

**Fase 1 — canal habilitado e conexão (FEITO em 05/08/2026):**
- ✅ `src/lib/integrations/shopee.ts` — credenciais, assinatura pública e de loja,
  `shopeeFetch` com refresh automático, OAuth (`authorizationUrl`,
  `exchangeShopeeCode`, `refreshShopeeConnection`), `getShopeeShopInfo`.
- ✅ `src/app/api/integrations/shopee/{connect,callback}/route.ts`
- ✅ UI: `src/app/(app)/shopee/page.tsx` + `components/ShopeeWorkspace.tsx`
- ✅ Registro: `registry.ts` (`available` + `connectHref`), `api/integrations/route.ts`
  (`shopeeConfigured()`), `ChannelRail.tsx`, `ChannelSwitcher.tsx`, `workspaces.ts`
  (`WorkspaceId` + rota), `AppShell.tsx`, `Nav.tsx`, `PageHeader.tsx`, `globals.css`.

**Fase 2 — dashboard e ingestão (FEITO em 05/08/2026):**
- ✅ `shopeeOverviewCanonical.ts` + rota `overview` — dashboard no padrão dos
  outros canais, lendo do modelo canônico.
- ✅ `shopeeCanonical.ts` (normalizer, com 8 testes em `tests/shopeeCanonical.test.mjs`)
- ✅ `shopeeSync.ts` (janela de 15 dias, lote de 50 no detail, escrow como
  conciliação complementar), `shopeeScheduler.ts`,
  `src/app/api/cron/shopee-sync/route.ts` e step no `.github/workflows/cron.yml`.
- ✅ Transporte HTTP fail-closed: HTTP não-ok, corpo não-JSON e envelope
  inválido não viram lista vazia nem sucesso aparente.
- ✅ Catálogo multi-status em sweep paginado e retomável; checkpoint inválido
  ou falha parcial não avança cobertura nem remove itens ausentes.
- ✅ Seleção multi-loja por `connection_id` no dashboard e módulos, com
  alíquota de imposto persistida por workspace + loja.
- ✅ Remoção em `/integracoes` apaga somente credenciais e dados locais
  exatamente escopados. Não chama endpoint externo e não revoga o acesso no
  painel da Shopee.

**Fase 3 — BLOCKED, o que falta para dados reais (não é código):** Go Live no console →
partner key de produção → `SHOPEE_*` no Render → loja autoriza. Só então o
mapeamento de campos encontra a realidade; revisar `shopeeCanonical.ts` nesse dia.

O dashboard consolidado já consulta cada loja Shopee com `connection_id`
explícito. Ainda não houve validação Live, visual ou autenticada desse fluxo,
nem observação de payload real Shopee.

**Sem mudança (agnósticos):** schema canônico, `canonicalStore.ts`, `canonical.ts`,
`integrationStore.ts`, `secrets.ts` — reaproveitados com `provider: "shopee"`.

**Assets:** conferir `public/brands/shopee.svg` e `public/brands/app/shopee.svg`
(os caminhos já estão referenciados em `MarketplaceIcon.tsx`).

## Changelog observado (mais recente primeiro)

Mesma convenção dos docs da Amazon e do ML: mudanças de comportamento da API observadas
na prática entram aqui, com data. Enquanto o canal não for implementado, a lista fica
vazia — ao implementar, re-validar tudo marcado com ⚠️ e registrar o que divergir.

- **2026-09-02 — `UNPAID` traz o valor desde a criação, e por isso o faturamento
  da Shopee passa a ser o pedido PAGO.** Decisão da dona do produto, verbatim:

  > *"vai aparecer o que realmente entrou como venda na api da shopee, boleto em
  > algum momento entraria, mas é diferente da amazon"*

  **A medição que sustenta a decisão** (conexão real `shopee:275804987`, 60 dias):

  | `order_status` | status canônico | pedidos | com valor | sem valor |
  |---|---|---|---|---|
  | COMPLETED | `delivered` | 15.755 | 15.755 | 0 |
  | CANCELLED | `cancelled` | 2.550 | 2.550 | 0 |
  | SHIPPED | `shipped` | 1.582 | 1.582 | 0 |
  | PROCESSED | `paid` | 1.251 | 1.251 | 0 |
  | TO_CONFIRM_RECEIVE | `shipped` | 1.121 | 1.121 | 0 |
  | **UNPAID** | **`pending`** | **63** | **63** | **0** |
  | TO_RETURN | `refunded` | 44 | 44 | 0 |
  | READY_TO_SHIP | `paid` | 23 | 23 | 0 |

  **A Shopee publica o valor na criação do pedido, em todos os status** — inclusive
  no `UNPAID`, que é o boleto ainda não pago. Não há um só pedido sem valor.

  ⚠️ **E É POR ISSO QUE A REGRA DA AMAZON NÃO VALE AQUI — mesma palavra,
  semântica oposta.** Na Amazon, `Pending` é venda **feita** com o valor
  **oculto**: a chave `ItemPrice` sequer vem no payload até o pedido avançar, e
  tirar o pendente do faturamento apagaria receita que existe. Na Shopee o valor
  está lá desde o começo; o que pode não acontecer é o **pagamento**.

  | | Amazon `Pending` | Shopee `UNPAID` |
  |---|---|---|
  | a venda aconteceu? | **sim** | **talvez** |
  | o valor está publicado? | **não** (`ItemPrice` ausente) | **sim** |
  | entra no faturamento? | **sim** | **não, até pagar** |

  📌 **Verificação da regra nova contra outra ferramenta**, medida em 02/09/2026
  na conta UTILEIRA: cortando em `pay_time < 10:19` (o instante do print da
  vendedora), o universo pago dá **R$ 3.131,26 em 87 unidades — o mesmo número
  que o Mercado Turbo mostra**. Os 4 pedidos que faltavam para os R$ 3.476,16
  (R$ 262,50) pagaram entre 10:24 e 10:31, **depois** do print; os 11 `UNPAID`
  restantes o Mercado Turbo também já excluía. A regra reproduz a ferramenta que
  ela usa para conferir, ao centavo.

  **O que muda no produto:** o card de Faturamento e tudo que deriva dele (lucro,
  margem, ticket, unidades, ROI) contam só o pago. `UNPAID` que paga entra
  normalmente **na data do pedido** — o sync troca o status e `occurred_at` não
  muda. `UNPAID` que cancela nunca entra. O valor que ficou de fora aparece na
  legenda da tela, com quantidade **e** valor: número que some sem deixar rastro é
  o que faz a vendedora conferir à mão.

- **2026-08-29 — `get_escrow_detail` RESPONDE NO DIA DO PEDIDO, com a comissão.**
  Medido contra a loja real (UTILEIRA, 275804987), **20 pedidos em quatro faixas de
  idade — 0, 3, 10 e 25 dias**. Os 20 devolveram `order_income` **com valor**,
  inclusive os cinco do **próprio dia**, ainda em `paid` e sem um centavo repassado.

  | Idade | Bruto | `commission_fee` | `service_fee` | `escrow_amount` |
  |---|---|---|---|---|
  | **0 dias** (`paid`) | 33,90 | **6,10** | 4,68 | 23,12 |
  | **0 dias** (`paid`) | 69,90 | **12,58** | 5,40 | 51,92 |
  | 25 dias (`delivered`) | 279,60 | 50,33 | 21,59 | 207,19 |

  A comissão saiu **18% cravado** em todas as amostras conferidas, e a conta fecha:
  `33,90 − 6,10 − 4,68 = 23,12`.

  ⚠️ **O QUE ISTO DESMENTE.** Este doc dizia "só disponível após o pedido
  pago/concluído", e a frase foi lida como *"só depois da liquidação"*. São coisas
  diferentes, e a confusão custou caro: o diagnóstico corrente era *"a Shopee só
  libera depois de ~40 dias, logo a margem de hoje não existe"*, o que misturava
  **LIQUIDAÇÃO** (o dinheiro cair na conta da vendedora) com **VISIBILIDADE DA TAXA**
  (a Shopee dizer quanto vai cobrar). Só a segunda importa para a margem, e ela
  existe desde o dia zero.

  O efeito prático era nosso, não da Shopee: a fila do escrow perguntava do pedido
  **mais antigo para o mais novo**, então o pedido de hoje esperava ~2,8 dias no fim
  de 16.700 — e ao chegar a vez dele já havia mais 2,8 dias de pedidos novos atrás.
  A janela recente não estava atrasada, estava **faminta por construção**. Corrigido
  na v196 (`occurred_at DESC`).

  ⚠️ **PENDÊNCIA COM MEDIÇÃO AGENDADA** (formato exigido pela lição 17 do
  [ADR-017](./adr/ADR-017-orcamento-de-1s-e-leitura-agregada.md) — pendência sem
  medição ao lado é arquivo morto):

  - **Não sabemos se** o `commission_fee` do dia zero é **definitivo** ou se muda
    na liquidação.
  - **Pista, que aponta mas não prova:** não há campo dizendo "estimado"; há
    fatias com prefixo `final_` (`final_shipping_fee`, `final_escrow_product_gst`,
    `final_product_vat_tax`, …) **todas zeradas** hoje, e
    `commission_fee`/`service_fee` **não têm par `final_`**. Aponta para
    definitivo. Apontar não é provar.
  - **Qual chamada:** `get_escrow_detail` para ~20 pedidos que já estavam
    liquidados **antes** desta verificação.
  - **Contra o quê:** o `commission_fee` que a resposta devolve agora, comparado
    com o valor que já gravamos em `workspace_channel_order_fees` para o mesmo
    pedido, na época em que ele foi conciliado.
  - **O que decide:** se os dois baterem em todos, a taxa é **definitiva desde o
    dia do pedido** e a margem da tela não precisa de aviso nenhum. Se divergirem
    em qualquer um, a taxa **se move**, a margem recente é **provisória**, e a
    tela precisa dizer isso com a mesma honestidade do resto (regra da casa:
    nomear o que é, não se desculpar com adjetivo).
  - **Quando:** assim que a fila nova (v196, recente-primeiro) tiver drenado
    pedidos suficientes para haver amostra com as duas leituras — gatilho
    observável: **≥ 200 pedidos com menos de 30 dias e `financial_settled = true`**.
    Não é "quando der".

- **2026-08-29 — `get_order_detail` NÃO carrega comissão, por mais campos que se peça.**
  Chamado com **28 `response_optional_fields`** (todos os documentados que fazem
  sentido para pedido): as 40 chaves da resposta trazem só frete —
  `estimated_shipping_fee`, `actual_shipping_fee`, `actual_shipping_fee_confirmed`,
  `reverse_shipping_fee`. **Nenhum campo de comissão, taxa de serviço ou escrow.**
  Ou seja: `get_escrow_detail` é o **único** caminho para a taxa, e a ausência no
  `get_order_detail` não é efeito da nossa lista curta de campos — foi testada a
  lista larga.

- **2026-08-28 — account_health sondado na loja real (base da tela Saúde da conta).**
  Seis chamadas reais, dentro do runtime de produção:
  - `get_shop_performance` → **200**: `overall_performance` (rating 1–4 + contadores
    `*_failed` por grupo) e `metric_list` com 17 métricas, cada uma com
    `current_period`/`last_period`/`target{value, comparator}` — a situação é calculável
    pelo comparador da própria API. Métricas de violação vieram com `current_period: null`
    (null de verdade, não zero).
  - `shop_penalty` → **403 `api_suspended`** ("Permission denied. This API is currently
    offline or the request path is incorrect"): o snapshot consolidado de pontos/punições
    vigentes NÃO está disponível à categoria ERP. O total vigente de pontos não é afirmável.
  - `get_punishment_history` → **exige `punishment_status`** (400 PARAMS_ERROR sem ele);
    com 1 devolve vigentes, com 2 o histórico (12 punições na loja, `order_limit` "95"/"80").
  - `get_penalty_point_history` → 200 (2 lançamentos, `violation_type` 5 e 8).
  - `get_late_orders` → 200 (`total_count` 0).
  - `get_listings_with_issues` → 200 (4 itens, `reason` 3 e −999 — códigos sem mapa).

- **2026-08-28 — [BR] `invoice_data` só vem se PEDIDO em `response_optional_fields`.**
  Confirmado na prática ao implementar a faixa de NF-e: o campo anunciado em 29/07 não
  chega por padrão — entrou na lista de campos opcionais do nosso `get_order_detail` e
  passou a vir (1.750 pedidos com o campo nas primeiras horas). O `sanitizeShopeeOrder`
  guarda só `{status, pending_reason}` (sub-allowlist; condição de retenção registrada no
  ADR-026).

- **2026-08-27 — primeira loja real conectada: duas divergências no catálogo, ambas
  medidas em produção.** A loja `275804987` autorizou o app e a primeira varredura
  parou duas vezes. As duas eram o mesmo defeito nosso — **escopo de canal para o que
  é problema de um item**:
  - **Preço e estoque não estão no item quando ele tem variação.** Em
    `get_item_base_info`, item com `has_model: true` volta com **`price_info` e
    `stock_info_v2.summary_info` ausentes** (`undefined`, não vazio). Medido no item
    `44862300302`: os valores moram em **`get_model_list` → `model[].price_info[]`**
    (`current_price: 42.9`, `currency: "BRL"`) e `model[].stock_info_v2.summary_info`
    (`total_available_stock: 913` por variação). Decisão: **menor `current_price`
    entre as variações** ("a partir de"), **estoque somado**, moeda da variação.
  - **`item_status` tem DOIS valores não documentados, e o documentado não aparece.**
    Pedindo a lista com `item_status=DELETED`, o detalhe volta com **`SHOPEE_DELETE`**
    (removido pela plataforma) ou **`SELLER_DELETE`** (removido pelo vendedor) — o
    `DELETED` que pedimos não veio nenhuma vez. Nenhum dos dois consta da documentação
    deles. Ambos mapeados para `closed`; o valor cru fica preservado em
    `provider_status`, que é o que distingue quem removeu. Na loja `275804987`:
    1 item `SHOPEE_DELETE` e **10 `SELLER_DELETE`**.
  - ⚠️ **A lição, que vale para os próximos valores que eles inventarem:** item que a
    Shopee manda fora do contrato **fica de fora do snapshot e é contado**, com o
    valor cru registrado — nunca derruba a sincronização inteira. As duas paradas
    zeraram o canal (0 pedidos, 0 produtos, `covered_to` nulo) por causa de um item.

- **2026-08-14 — cadeia pública revalidada no sandbox; nenhuma loja autorizada.**
  `scripts/shopee-sandbox-probe.mjs` (novo) devolveu **HTTP 200** em
  `get_shops_by_partner` e `get_merchants_by_partner` — a **assinatura HMAC continua
  correta** (sign errado devolveria `error_sign`), confirmando a validação de 05/08.
  Mas ambos vieram com **lista vazia: zero lojas e zero merchants autorizados**.
  Consequência: `signPublic` está exercitado, e **`signShop` segue sem prova** — é o
  mesmo aviso que já está no código. Sem uma loja de teste autorizando o app no
  sandbox, não há payload real para conferir o `shopeeCanonical.ts`, que continua
  escrito somente contra a documentação.

- **2026-08-14 — três mudanças anunciadas por e-mail (`info@shopee.sg`), nenhuma nos
  atinge hoje.** Registradas porque atingem quando o canal escrever ou ler devoluções:
  - `v2.returns.get_return_list` / `get_return_detail` ganham
    `is_partial_quantity_return` e `is_refund_amount_adjusted` (vigência **17/08/2026**).
    Não chamamos APIs de devolução.
  - **`condition` vira OBRIGATÓRIO no BR** em `v2.product.add_item`,
    `v2.product.update_item` e `v2.global_product.add_global_item` (vigência
    **17/08/2026**). Ausente/vazio/null → request **rejeitado**; só aceita `NEW` ou
    `USED` (case-insensitive). `get_item_base_info` passa a devolver o valor correto.
    ⚠️ **Só lemos** (`get_item_list`, `get_item_base_info`) e não parseamos `condition`
    — mas no dia em que o canal criar ou editar anúncio no BR, isto quebra na primeira
    chamada se o campo não for enviado.
  - Nova `v2.sbs.get_fulfillment_mapping_inventory_list` (vigência 12/08/2026), aditiva.

- **2026-08-14 — ⚠️ a Partner Key expira em 180 dias e NÃO é renovada sozinha.**
  Do guia oficial para novos desenvolvedores (e-mail `info@shopee.sg` de 13/08): passada
  a validade, *"a plataforma não irá gerar uma nova chave automaticamente. A chave será
  marcada como inválida e as chamadas de API que a utilizarem serão bloqueadas"*. O reset
  é manual, no Console (App List), e a chave nova vale na hora; dá para manter a antiga
  por até **72h** de transição. **O reset não invalida a autorização das lojas.**
  Esse relógio é **independente** do da autorização da loja (7/30/90/180/365 dias, à
  escolha do vendedor) — ver [`conexoes-que-expiram.md`](./conexoes-que-expiram.md).

- **2026-08-14 — permissão de app é imutável.** As capacidades vêm **exclusivamente da
  categoria escolhida na criação do App**. A Shopee **não** libera API nem escopo
  individualmente, e **não dá para adicionar permissão a um app existente** — precisa
  criar um app novo com outra categoria. Vale lembrar antes de prometer qualquer feature
  que dependa de endpoint fora da nossa categoria.

- **2026-08-11 — hardening local, sem evidência Live:** transporte HTTP passou a
  falhar fechado; o catálogo percorre todos os status com checkpoint retomável;
  dashboard/settings isolam múltiplas lojas; e a gestão de integrações oferece
  remoção somente local, sem revogação externa. Go Live, credenciais de
  produção, autorização de loja real e payload Live permanecem **BLOCKED**.

- **2026-07-29 (anúncio oficial, lido em 07/08)** — **[BR] status de NF-e entra
  nos detalhes de pedido/pacote e passa a BLOQUEAR envio.** Vale só para o
  Brasil e já está em vigor.
  - `v2.order.get_order_detail` ganha `invoice_data.status` (`pending` | `valid`)
    e `invoice_data.pending_reason`.
  - `v2.order.get_package_detail` ganha a mesma informação, mas sob outro nome:
    **`invoice_pending.status`** / `.pending_reason`. ⚠️ Os dois endpoints usam
    chaves diferentes para o mesmo dado — não dá para reaproveitar o mesmo
    parser cegamente.
  - `valid` = passou na validação **ou o pedido não exige NF-e**. `pending` = o
    sistema ainda espera ou está validando a nota; **envio não pode ser
    agendado**.
  - `v2.logistics.ship_order` e `v2.logistics.batch_ship_order` passam a validar
    isso em tempo real e **recusam** o envio com `error_pending_invoice` (texto
    cita o SEFAZ marcando o documento como inválido).
  - `pending_reason` só vem quando o pedido está em status de "pronto para
    enviar" **e** a nota está pendente; fora disso o campo pode vir vazio. O
    conteúdo é o texto cru do erro do sistema.
  - **Impacto no SellerCore hoje: nenhum quebra.** A integração é somente
    leitura — não chamamos `ship_order` nem `batch_ship_order`. E
    `ShopeeOrder.invoice_data` já existe em `shopeeCanonical.ts` (tipado como
    `unknown`, ainda não usado), com `INVOICE_PENDING` já mapeado para `paid`.
  - **O que muda de valor**: hoje sabemos *que* a nota está pendente (pelo
    `order_status`), mas não **por quê**. O `pending_reason` é o que permitiria a
    tela dizer o que corrigir. Decisão em aberto — ver `estado-atual.md`.
  - ⚠️ **Sobe o custo de não ter IP Whitelist**: sem ele o dado do comprador vem
    mascarado → NF-e inviável → `invoice.status` fica `pending` → **a Shopee
    recusa o envio**. Antes era "inviabiliza NF-e"; agora trava a operação.

- **2026-08-07** — **Formulário de Go Live percorrido campo a campo** (console →
  App List → SellerCore → Go Live, `/console/app/live/238101`). O que só se
  descobre abrindo:
  - **O formulário NÃO guarda rascunho.** Sair da tela apaga tudo (foi assim que
    o preenchimento de 06/08 se perdeu). Preencher e submeter na mesma sessão.
  - **IP Whitelist está dentro deste formulário**, não no Security Dashboard.
  - **CIDR é rejeitado**: `74.220.49.0/24` dá *"Please provide 4-digit IP
    addresses with each segment ranging from 0 to 255"*. Só aceita endereço
    avulso — e 256 endereços de um /24 não cabem no limite de 2000 caracteres.
  - **IP de saída real do Render: `74.220.49.18`**, medido de dentro do próprio
    servidor (endpoint temporário consultando ipify/ifconfig/icanhazip, 9
    leituras idênticas). Fica dentro do bloco `74.220.49.0/24` publicado pelo
    Render. ⚠️ Declarar só esse endereço funciona hoje, mas se o Render migrar
    dentro da faixa as chamadas passam a ser **bloqueadas em silêncio** — vale
    reconferir o IP depois de qualquer mudança de plano/região.
  - **Campos além do esperado**: `Test Redirect URL Domain` e `Live Redirect URL
    Domain` (o live precisa bater com `APP_BASE_URL`, senão o OAuth quebra
    depois da aprovação) e `Other IT assets Declaration` (Database Servers e
    Other Servers, cada um com opção "IP address(es) unavailable" + justificativa
    de até 200 caracteres).
  - ⚠️ **O toggle "Enable IP Address Whitelist" não liga** nem por clique nem por
    evento sintético, mesmo com o campo de IP já válido e sem `disabled` no DOM.
    Hipótese não confirmada: só habilita depois do app sair de "Developing".

- **2026-08-05** — **Ingestão implementada** (`shopeeCanonical.ts` + `shopeeSync.ts` +
  `shopeeScheduler.ts` + cron). Escrita contra a doc oficial, ainda **não exercitada
  contra loja real** — todo o mapeamento de campo está isolado em `shopeeCanonical.ts`
  de propósito: quando a primeira loja conectar, o ajuste é lá, não no sync.
  Campos confirmados na doc de `get_escrow_detail` e `get_order_detail`:
  - **Estrutura do escrow**: `response.order_income` com `commission_fee`,
    `service_fee`, `seller_transaction_fee`, `actual_shipping_fee`,
    `reverse_shipping_fee`, `campaign_fee`, `order_ams_commission_fee`,
    `escrow_tax`, `seller_return_refund`, `buyer_paid_shipping_fee`. A doc
    publica a fórmula completa do `escrow_amount` (~40 parcelas).
  - **Itens do pedido**: `model_discounted_price` é o preço cobrado e
    `model_original_price` o de lista — usar o primeiro no `unitPrice`, senão a
    receita infla. `model_sku` (variação) tem precedência sobre `item_sku`.
  - **`INVOICE_PENDING` conta como receita** (pago, só falta NF-e) — status
    específico do Brasil.
  - Produtos: `item_status` usa `NORMAL`/`UNLIST`/`BANNED`/`DELETED` **e também
    `SHOPEE_DELETE` e `SELLER_DELETE`, que a documentação não lista** (medidos em
    27/08/2026 — ver o Changelog; o `DELETED` documentado não apareceu na loja real). O estoque vem aninhado em
    `stock_info_v2.summary_info.total_available_stock` — **exceto em item com
    variação, onde ele e o preço só existem em `get_model_list`**.
  - ⚠️ **Cursor é opaco e não é estável entre execuções** (diferente do offset do
    ML): o sync percorre a janela inteira num passo só, em vez de guardar posição.

- **2026-08-05** — **Primeira chamada assinada com sucesso no sandbox** (app
  "SellerCore", ERP System, status Developing). `GET
  /api/v2/public/get_shops_by_partner` → HTTP 200 com `authed_shop_list: []`
  (vazio porque nenhuma loja autorizou ainda). Confirmado na prática:
  - **Base string pública = `partner_id + api_path + timestamp`**, HMAC-SHA256
    com a partner key **literal** (incluindo o prefixo `shpk`), hex minúsculo.
  - **O host do sandbox mudou**: `openplatform.sandbox.test-stable.shopee.sg`.
    O antigo `partner.test-stable.shopeemobile.com` responde `error_sign` mesmo
    com assinatura correta — o sintoma aponta para a chave, a causa é o host.
    Custou 3 rodadas de teste de variantes de chave até perceber.
  - O host de produção `partner.shopeemobile.com` responde `invalid_partner_id`
    para credenciais de sandbox — bom sinal de que os ambientes são separados.
  - `/api/v2/public/get_token_by_resend_code` → `api_suspended` ("No permission
    to this API"): endpoint fora da categoria ERP System.
  - ⚠️ A **URL de autorização do sandbox** tem formato próprio e não é o
    `/api/v2/shop/auth_partner` assinado:
    `https://open.sandbox.test-stable.shopee.com/auth?auth_type=seller&partner_id=…&redirect_uri=…&response_type=code`,
    e exige login com **conta de teste do sandbox** (criada no console, aba Test
    Account), não com conta real — conta real dá "Account/Password Verification Failed".

- **2026-08-05** — **Perfil de desenvolvedor ISV APROVADO** (conta
  `consultor.masterseller@gmail.com`, CNPJ 66.106.202/0001-20). O caminho é
  **Third-party Partner Platform (ISV)**, não vendedor: o critério "loja PJ com
  ≥1 pedido/30d" vale só para contas do tipo *Shopee Seller*. ISV é literalmente
  o tipo para quem **não** tem loja (tabela de elegibilidade: *"Are you a Shopee
  seller? No → Third-party Partner Platform"*); exige produto live com
  integrações verificáveis por conta trial, HTTPS/TLS 1.2+ e rating "A".
  - **App Type é imutável e define os endpoints** — não existe liberação avulsa.
    Uma conta ISV pode criar: ERP System, Product Management, Order Management,
    Accounting and Finance, Marketing. Permissões: **ERP System = todas as APIs
    exceto Chat API e Ads API** (Seller In-house System teria Chat, mas é
    indisponível para ISV). → **SellerCore usa ERP System**; dados de Shopee Ads
    exigiriam um segundo app do tipo Ads Service.
  - Criar o app gera **Test Partner ID + Test Key** (só sandbox). As chaves de
    produção saem depois do Go Live.
  - **IP Whitelist é obrigatório para todos** (não só para quem envia pentest):
    sem ele, dados do comprador voltam mascarados e a NF-e fica inviável.
  - Pegadinhas do formulário do console: CNPJ só dígitos (`66106202000120`) e
    CEP sem hífen; voltar um passo reseta upload de arquivo e checkbox de aceite.

- **2026-08-04** — Fluxo de onboarding verificado na doc oficial (seção "BRASIL |
  Jornada do Desenvolvedor", páginas atualizadas em jul/2026) — o que este doc não
  tinha:
  - **Perfil de desenvolvedor precisa ser APROVADO pela Shopee antes de criar app.**
    Brasil só aceita `Registered Business Seller` (PJ, docs válidos, **≥1 pedido nos
    últimos 30 dias**; Individual Seller/CPF fechado para BR) e `Third-party Partner`
    (ISV: exige produto live com integrações e-commerce existentes verificáveis por
    conta trial, HTTPS/TLS 1.2+, security rating "A" — caminho futuro do SellerCore).
  - **Categoria do app é imutável** e delimita os endpoints (Seller In-House System
    para vendedor próprio; ERP System para ISV). Sem liberação avulsa de endpoint.
  - **Partner key é DUPLA**: sandbox (app "Developing") ≠ live (pós Go Live).
  - **Go Live tem análise** e exige Product Brief (URL live + usuário de teste +
    screenshot), Redirect URL domains (test e live), **IP Whitelist** e declaração de
    infraestrutura. Sem IP Whitelist habilitado, dados do comprador voltam
    **mascarados** (Sensitive Data) — inviabiliza NF-e.
  - **Autorização de loja expira em ≤365 dias** (além da rotação do refresh_token).
    Seller In-House System autoriza pelo botão do console; redirect_uri deve bater
    exatamente com o domínio cadastrado.
  - Dados do comprador p/ NF-e só nos status `INVOICE_PENDING`, `READY_TO_SHIP`,
    `PROCESSED`, `RETURN/REFUND` (`get_order_list`/`get_order_detail`).

## Referências

- Adapter de referência (mesmo desenho): `src/lib/integrations/mercadoLivre.ts`,
  `mercadoLivreSync.ts`, `mercadoLivreOverviewCanonical.ts`.
- Doc oficial: https://open.shopee.com (Developer Guide / API v2).
