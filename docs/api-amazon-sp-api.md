# Amazon SP-API — endpoints usados e lições aprendidas

Referência interna do SellerCore. Tudo aqui foi validado em produção (conta BR, marketplace `A2Q3Y263D00KWC`). Atualize este arquivo sempre que um endpoint novo entrar ou uma pegadinha nova for descoberta.

## Infra (`src/lib/spapi.ts`)

- Hosts: `https://sellingpartnerapi-na.amazon.com` (Brasil fica na região **NA**), `-eu`, `-fe`; sandbox em `https://sandbox.sellingpartnerapi-*.amazon.com`.
- Auth LWA: `POST https://api.amazon.com/auth/o2/token` com `grant_type=refresh_token`. O refresh token é emitido pelo app OAuth de produção — scripts locais precisam do `OAUTH_CLIENT_ID/SECRET` e `INTEGRATION_TOKEN_KEY` **de produção** no `.env.local`, senão o decrypt do token falha.
- `spapiFetch(path, { query, method, body })` cuida de token, host e erros (`SpApiError` com `technicalDetail` e `amazonRequestId` — sempre logar esses dois ao debugar).
- Scripts de sondagem: `node --experimental-transform-types --import ./scripts/ts-resolver.mjs --env-file=.env.local <script>` + `runWithWorkspace`/`runWithAccount`.

## Vendas e pedidos

| Endpoint | Uso no projeto | Observações |
|---|---|---|
| `GET /sales/v1/orderMetrics` | **"Pedidos feitos"** (`src/lib/sales.ts`) | O número do Seller Central "vendas de produtos **pedidos**". Granularidade via `granularity` + `granularityTimeZone`. **Não é reproduzível pelo canônico** (ver abaixo) — e **não é o faturamento em caixa**: valoriza a preço de tabela, antes do cupom. ⚠️ Esta linha dizia "faturamento oficial / fonte da verdade para faturamento" até 28/08/2026, o que contradiz o changelog medido de 22/08 no fim deste doc. Corrigido para o que a medição mostrou. |

### Por que `orderMetrics` não sai do nosso canônico (28/08/2026)

A pergunta apareceu assim: *"por que a rota chama a Amazon ao vivo se já temos os
22 mil pedidos no banco?"*. A resposta é que **o dado não está lá para ser
somado** — e as duas razões já estavam medidas neste doc:

1. **Pedido `Pending` não tem valor.** A Amazon **omite `OrderTotal`** enquanto o
   pedido está `Pending`, e pedido FBA fica `Pending` mesmo depois do pagamento
   confirmado. Esses pedidos entram no canônico **sem valor** — não é falha de
   sync, é ausência na origem. Medido em 21/08/2026: R$ 360,99 conciliado contra
   R$ 516,27 no Seller Central; a diferença eram **4 pedidos sem valor**.
2. **`orderMetrics` valoriza a preço de tabela, antes do cupom**; `OrderTotal` é
   o preço praticado. Medido em 22/08/2026: R$ 449,94 = `360,99` pago + `16,83`
   de cupom + `72,12` de 3 pendentes.

Ou seja: **são dois números diferentes por construção** — um é tabela e
"solicitado", o outro é caixa e "capturado". Somar ou trocar um pelo outro
produz número que não bate com nada.

📌 O que **não** justifica é **bloquear a resposta** esperando por ele. A própria
rota já trata a falha com `.catch(() => null)` e degrada limpo; se ausência é
aceitável no erro, ausência temporária também é. Custo medido em 28/08/2026 na
conta real: **252ms com cache frio, 38ms quente** — real, mas longe de explicar
qualquer lentidão percebida.
| `GET /orders/v0/orders` | Lista de pedidos (`src/lib/orders.ts`) | Paginação por `NextToken`. Filtros `CreatedAfter/Before`, `OrderStatuses`. |
| `GET /orders/v0/orders/{id}/orderItems` | Itens do pedido | — |

### `Pending` no FBA não é "não pagou" (2026-08-08)

Pedido FBA fica em `OrderStatus: Pending` **mesmo depois do pagamento confirmado** —
sai de `Pending` na expedição, não na aprovação do cartão. Observado ao vivo no
pedido `702-2192919-5915420`: comprador recebeu "Confirmação de pagamento" às 14:06,
`LastUpdateDate` 14:09, e 7 horas depois ainda `Pending`, dentro do prazo
(`EarliestShipDate` = `LatestShipDate` = dia seguinte 23:59).

Consequência para o cálculo: enquanto está `Pending`, a Amazon **omite `OrderTotal`
no pedido e `ItemPrice` nos itens**. Não é falha de sync — o pedido entra no modelo
canônico com `gross` 0 e sem fees porque não há valor a capturar. Como não há
expedição, também não existe transação financeira, e o lucro conciliado fica
**vazio (desconhecido), nunca zero** — ver o card em `src/app/(app)/amazon/page.tsx`.

## Financeiro

| Endpoint | Uso no projeto | Observações |
|---|---|---|
| `GET /finances/2024-06-19/transactions` | **Fees e lucro** (`src/lib/transactions.ts`) | API atual (Transactions). Estrutura em árvore: `Sales → ProductCharges`, `Expenses → AmazonFees → {Commission, FBAPerUnitFulfillmentFee, …} → {Base, Tax}` (somar só as FOLHAS Base/Tax, senão duplica). |
| `GET /finances/v0/financialEvents` | Legado (`src/lib/finances.ts`) | ⚠️ **Retorna valores ZERADOS nesta conta** (comportamento deprecado). Não confiar; migrar tudo para Transactions (item no TODO.md). |
| `GET /finances/v0/financialEventGroups` | **Saldo disponível** (`getAmazonBalance`) | O `OriginalTotal` do grupo `Open` é o "Fundos disponíveis agora" do Seller Central. `FinancialEventGroupStart` é o início do extrato. Este endpoint **não** foi afetado pela depreciação acima. |

### Saldo e retenção (medido em 2026-08-15)

Responde "o que tenho hoje e o que vai ser descontado" — a pergunta que lucro
sozinho não responde. Duas fontes:

- **`financialEventGroups`** dá o saldo. A conta BR tem **mais de um grupo `Open`
  ao mesmo tempo**, um por meio de pagamento do comprador (`accountType`
  `"Mastercard Credit & Other"` e `"Boleto"`) — o saldo é a **soma** deles.
  Somar só o primeiro dá número errado.
- **`transactions`** dá o cronograma. Toda transação `DEFERRED` traz
  `contexts[]` com `{contextType: "DeferredContext", maturityDate, deferralReason}`.
  `maturityDate` é a **data exata de liberação**; `DD7` = entrega + 7 dias.

⚠️ `contexts` fica no **nível da transação**, não dentro de `items[]` — o código
já lia `items[].contexts` (para SKU) e por isso o `DeferredContext` passou
despercebido até agora.

Por que importa: as vendas ficam `DEFERRED` até depois da entrega, enquanto as
despesas (anúncios) entram `RELEASED` na hora. Resultado observado: painel com
lucro de R$ 20,04 e saldo de **−R$ 6,12**, os dois corretos.

### Pegadinhas do Transactions (aprendidas na prática)

- **Não usar como faturamento**: soma por *posted date* e inclui eventos não-venda → dá até 49% acima do Seller Central. Faturamento é `orderMetrics`.
- **Status**: `RELEASED`, `DEFERRED`, `DEFERRED_RELEASED`. Excluir `DEFERRED_RELEASED` das somas (é a re-postagem do DEFERRED — contar os dois duplica).
- **`transactionType: "Transfer"`** = repasse bancário, não é venda/fee. Excluir sempre.

## Listings (a saga do FBA — 2026-07-22)

| Endpoint | Uso | Observações |
|---|---|---|
| `GET /listings/2021-08-01/items/{sellerId}/{sku}` | Ler anúncio | `includedData=attributes,issues,offers,fulfillmentAvailability,summaries`. |
| `PATCH /listings/2021-08-01/items/{sellerId}/{sku}` | Editar anúncio | Body: `{ productType, patches: [...] }`. Ver semântica de selectors abaixo. |
| `PUT /listings/2021-08-01/items/...` | Criar anúncio (`src/lib/amazonListingBuilder.ts`) | — |
| `GET /listings/2021-08-01/restrictions` | Restrições de venda por ASIN | — |
| `GET /definitions/2020-09-01/productTypes[/{type}]` | Schema do product type | É aqui que os **selectors** de cada atributo são definidos. |

### ⚠️ Semântica de PATCH com selectors (a lição mais cara)

Atributos-lista (ex.: `fulfillment_availability`) têm um **selector** — para fulfillment é `fulfillment_channel_code`. Consequências:

1. **`replace` NÃO sobrescreve o array.** Só atualiza/cria a entrada com o MESMO selector. `replace` com `[{AMAZON_NA}]` deixa uma entrada `DEFAULT` existente **intocada** (retorna ACCEPTED e "nada muda").
2. **Remover uma entrada = `delete` com o selector no `value`:**
   ```json
   { "op": "delete", "path": "/attributes/fulfillment_availability",
     "value": [{ "fulfillment_channel_code": "DEFAULT" }] }
   ```
3. `delete` sem `value` → erro "Invalid empty value". `delete` por índice (`/attributes/x/1`) → "Invalid path". A API não trabalha com índices.
4. Pode combinar `replace` + `delete` no mesmo PATCH (suportado desde 2022).
5. Fonte: github.com/amzn/selling-partner-api-models issue **#2061** (resposta oficial do time SP-API).

### Fees API devolve zero — e o zero pode ser verdadeiro (2026-08-09)

`POST /products/fees/v0/items/{asin}/feesEstimate` responde `Status: "Success"`
com **todas as tarifas zeradas**: `ReferralFee = 0`, `FBAFees = 0`,
`TotalFeesEstimate = 0`. Testado com ASIN próprio (`B0HBGLBL6Y`) e de terceiro
(`B0H42G9TGW`), `IsAmazonFulfilled` true e false, preços de R$ 15,90 a R$ 99,00.

⚠️ **Primeira leitura estava errada.** Registramos como "a API mente, igual à
Finances v0". A vendedora informou depois que **está isenta de tarifas por ser
seller nova (benefício de entrada)** — então o zero reflete a conta, não um
defeito. A Fees API estima o que **o seller autenticado** pagaria, não o dono do
ASIN; por isso devolve zero até em ASIN de terceiro, e isso é coerente.

O que isso exige do código:

1. **Zero da Fees API é um valor plausível, não lixo** — mas continua
   indistinguível de "não sei", porque a API não informa isenção nem prazo.
2. **A isenção é temporária.** Projetar margem futura com tarifa zero engana tão
   feio quanto tratar desconhecido como zero. Quem decide compra de estoque
   precisa ver os dois cenários: com benefício e sem.
3. A tarifa **real** aparece em `GET /finances/2024-06-19/transactions` quando o
   pedido é postado (`Commission`, `FBAPerUnitFulfillmentFee` separados). É a
   única fonte que confirma se a isenção valeu e em quanto.

`POST /products/fees/v0/feesEstimate` (lote) rejeita com `Missing objects
[PriceToEstimateFees]` mesmo com o campo presente no item da lista; não
investigado a fundo porque a versão por ASIN já resolve.

### `mode=VALIDATION_PREVIEW` — testar um anúncio sem criar (2026-08-08)

`PUT /listings/2021-08-01/items/{sellerId}/{sku}?mode=VALIDATION_PREVIEW` valida o
payload e devolve `status` + `issues` **sem gravar nada**. É o equivalente por API a
"começar a criar um anúncio para ver o que a Amazon aceita", sem sujar o catálogo
com rascunho.

Usado em 08/08 para provar que a logística da Amazon está disponível em anúncio
novo: com `fulfillment_availability: [{ fulfillment_channel_code: "AMAZON_NA" }]`
o retorno foi `VALID`, 0 issues. Sem os atributos de compliance do productType
(`batteries_required`, `supplier_declared_dg_hz_regulation`) o retorno é `INVALID`
com dois erros `90220` — que são do tipo de produto, **não** do canal de envio.

### Caso real: FNSKU travado por offer FBA+FBM duplo

O Seller Central remove FBM quando você ativa FBA — **a API não**. Anúncio criado via API pode ficar com `fulfillment_availability = [{AMAZON_NA}, {DEFAULT, quantity: 0}]`. Esse conflito **impede o registro do FNSKU** e a variação não aparece no "Enviar para a Amazon". Correção: `delete` da entrada `DEFAULT` (receita acima). FNSKU aparece ~1h após a conversão limpa.

## Catálogo, preço, estoque

| Endpoint | Uso | Observações |
|---|---|---|
| `GET /catalog/2022-04-01/items[/{asin}]` | Busca/detalhe de catálogo (`src/lib/catalog.ts`, `search.ts`) | `includedData=attributes,images,salesRanks,summaries`. ⚠️ Em lote (`identifiers`), o `pageSize` **padrão é 10** — um lote de 20 ASINs volta pela metade em silêncio. Sempre passar `pageSize` explícito (máx. 20). |
| `GET /products/pricing/v0/competitivePrice` | Preço competitivo (`src/lib/pricing.ts`) | — |
| `GET /products/pricing/v0/items/{asin}/offers` | Ofertas do ASIN | — |
| `GET /products/fees/v0/items/{asin}/feesEstimate` | Estimativa de tarifas (`src/lib/fees.ts`) | POST na prática (body com preço). ⚠️ **Retorna ZERADO nesta conta** — ver abaixo. |
| `GET /fba/inventory/v1/summaries` | Estoque FBA (`src/lib/inventory.ts`) | `details=true` traz **`fnSku`** — é aqui que se verifica se a variação registrou no FBA. |
| `GET /fba/inbound/v1/eligibility/itemPreview` | Elegibilidade FBA por ASIN | `program=INBOUND`. Usado no diagnóstico do caso FNSKU. |

## FBA Inbound — envio e agendamento de entrega (2024-03-20)

Usada para o envio self-ship (a própria vendedora entrega no CD). Operações da API
Fulfillment Inbound `2024-03-20` sobre `inboundPlans/{id}/shipments/{id}`:

- `generateSelfShipAppointmentSlots` → gerar janelas de entrega. **Sem esse passo o
  calendário do Seller Central abre mas não mostra botão de confirmar** — os slots não
  existem até serem gerados (pegadinha de 2026-08-04).
- `getSelfShipAppointmentSlots` → listar as janelas geradas.
- `scheduleSelfShipAppointment` → confirmar a janela (retorna o `appointmentId`).

## Relatórios e conta

| Endpoint | Uso | Observações |
|---|---|---|
| `POST /reports/2021-06-30/reports` → `GET .../reports/{id}` → `GET .../documents/{docId}` | Relatórios (`src/lib/reports.ts`) | Fluxo assíncrono: criar, poll até DONE, baixar documento (pode vir gzip). `GET_MERCHANT_LISTINGS_ALL_DATA` lista todos os SKUs. |
| `GET /sellers/v1/marketplaceParticipations` | Marketplaces da conta (`src/lib/sellers.ts`) | Bom "ping" para validar credenciais. |

### Transportadora do inbound: sem caminho por API hoje (2026-08-08)

Para saber qual transportadora a Amazon oferece num envio (a "parceira da Amazon"
/ TEXBR), as duas portas estão fechadas para este app:

- `GET /inbound/fba/2024-03-20/inboundPlans/{id}/shipments` → **403 Unauthorized**.
  Falta papel na aplicação SP-API (mesmo padrão do relatório de tráfego, que exige
  Brand Analytics). `GET .../inboundPlans/{id}` sozinho responde 200 — o bloqueio é
  só no nível de shipments.
- `GET /fba/inbound/v0/shipments/{id}/transport` → **400: "This API is deprecated.
  Please migrate to the new Fulfillment Inbound v2024-03-20 APIs."** A listagem
  `v0/shipments` ainda responde 200 (exige `ShipmentStatusList` ou `ShipmentIdList`),
  mas o transporte não.

Conclusão: a escolha de transportadora só é verificável na tela *Enviar para a
Amazon*. Se o papel for concedido, o caminho é `transportationOptions` da 2024-03-20.

## Changelog observado (mais recente primeiro)

- **2026-09-06 — O `orderMetrics` EXCLUI pedido cancelado. Medido 7 de 7 dias.**
  Comparação dia a dia entre o `orderMetrics` e o nosso canônico, na conta
  `AO62LVXJMX3AA`:

  | dia | orderMetrics | não-cancelados | cancelados | total |
  |---|---|---|---|---|
  | 29/08 | 4 | **4** | 1 | 5 |
  | 30/08 | 3 | **3** | 0 | 3 |
  | 31/08 | 3 | **3** | 0 | 3 |
  | 01/09 | 4 | **4** | 0 | 4 |
  | 03/09 | 2 | **2** | 2 | 4 |
  | 04/09 | 2 | **2** | 1 | 3 |
  | 05/09 | 3 | **3** | 1 | 4 |

  **7 de 7 batem com os não-cancelados; zero batem com o total.** Ou seja: o
  cancelamento sai do faturamento da própria Amazon, e o nosso produtor (que
  filtra `status <> 'cancelled'`) está de acordo com a fonte.

  ⚠️ **E A LIÇÃO DE MÉTODO É MAIS ÚTIL QUE O FATO.** No dia anterior rodei a
  MESMA comparação na conta `A15NQMF7A6J1Y0` e o resultado foi *"não bate com
  nenhuma das duas hipóteses"* — que eu quase registrei aqui como comportamento
  estranho da API. Não era: aquela conta tem centenas de pedidos por dia e a
  ingestão fica para trás, então eu comparava a API contra um retrato
  **incompleto meu**.

  📌 **Conta grande não serve para calibrar contra a fonte.** Para perguntar "a
  API inclui ou exclui X?", use a conexão pequena e totalmente ingerida — e
  quando os dois lados divergirem, desconfie primeiro do lado que você controla.

- **2026-09-04 — A ISENÇÃO DA TARIFA DE INDICAÇÃO É INFERIDA DO EXTRATO, por
  conta.** Regra da dona do produto, verbatim: *"A isenção depende de conta pra
  conta e só acaba quando atingir o teto de faturamento. Você pode se basear
  nisso quando a amazon confirmar um pedido e vc ver que está com tarifa
  cobrada, quer dizer que aquela conta já não tem mais isenção."*

  **Medido nas duas contas reais, sem cadastro manual:**

  | conexão | inferência | evidência |
  |---|---|---|
  | `amazon:A15NQMF7A6J1Y0` (Silveiras) | **teto atingido** — paga a tabela cheia | pedido `701-7810258-5669048` veio com comissão > 0 |
  | `amazon:AO62LVXJMX3AA` | **isenta** desde 24/08/2026 | nenhum confirmado com comissão |

  ⚠️ **A data é onde começa a NOSSA evidência, não onde começou a promoção.** A
  janela abre no primeiro pedido confirmado com extrato no canônico (24/08), e
  não em 01/08. A inferência só afirma o que consegue provar; ajustar para trás
  é edição à mão na mesma estrutura.

  **As regras, e cada uma existe por um modo de falha:**

  - **o sinal é SÓ `commission`.** FBA e as demais continuam sendo cobradas na
    isenção — usar "tem tarifa qualquer" diria que a conta perdeu a isenção no
    primeiro pedido FBA;
  - **pedido sem extrato não é sinal.** Sem tarifa nenhuma o extrato ainda não
    chegou; contar como isenção faria toda conta nascer isenta ao conectar;
  - **o flip é só para frente.** O teto é permanente: comissão zero depois não
    reverte, vira anomalia no log. Reverter faria a tarifa dos pendentes oscilar
    sem nada mudar no mundo;
  - **sem histórico = paga cheio.** Desconhecido não pode virar desconto — e
    desconto errado aparece como **lucro bom**, que ninguém questiona;
  - **a vigência é pela data do PEDIDO.** Um pedido de julho pagou; aplicar a
    isenção de hoje ao histórico faria a margem daquele mês subir sozinha.

  📌 **E a Product Fees API mudou de papel:** o cálculo por tabela manda no
  pendente, e a API/extrato viram **conferência**. O cálculo roda mesmo quando a
  tarifa oficial existe, e divergência acima de R$ 0,10 por unidade vira alarme
  (`[tarifa-calculada] divergencia calculado x postado`). **Nunca corrige
  sozinho:** se as duas discordam, uma está errada e o código não sabe qual —
  ajustar a tabela pelo extrato esconderia uma mudança de regra da Amazon.

- **2026-09-03 — APP PÚBLICO APROVADO, e BRAND ANALYTICS CONTINUA FORA — o
  bloqueio é da CONTA, não do app.** A Amazon aprovou o acesso do app público
  ("acesso global do Marketplace com base nas funções solicitadas"), fechando em
  1 dia uma revisão parada desde julho.

  ⚠️ **E a aprovação não virou acesso.** Medido com o token real da conta
  `AO62LVXJMX3AA`, pedindo o relatório de verdade — não lendo documentação:

  | chamada | resposta |
  |---|---|
  | `POST /reports/2021-06-30/reports` → `GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT` | **403 Unauthorized** |
  | `GET /reports/...?reportTypes=GET_BRAND_ANALYTICS_...` | **403 Unauthorized** |
  | `GET /reports/...?reportTypes=GET_FLAT_FILE_ALL_ORDERS_DATA...` | **200 OK** |
  | `GET /sellers/v1/marketplaceParticipations` (controle) | **200 OK** |

  📌 **A terceira linha é a que importa.** Um 403 numa rota não diz se o problema
  é a API ou o relatório; com a Reports API respondendo **200** para um relatório
  comum, o bloqueio fica isolado no Brand Analytics.

  **E a causa foi confirmada FORA da API**, no Seller Central logado na conta:
  `/analytics/dashboard/searchTerms` devolve *"Acesso necessário — você não tem
  as permissões adequadas"*, e o menu lateral **não tem a seção Marcas**. Ou
  seja: **nem o login dela vê o Brand Analytics**. Reautorizar o app não mudaria
  nada — a hipótese do "token anterior à aprovação" morreu sem precisar do teste.

  **E A DOCUMENTAÇÃO CONFIRMA, verbatim** (`report-type-values-analytics`) — a
  exigência é TRIPLA, não só Brand Registry:

  > *"Sellers and vendors who have the Brand Analytics Selling Partner API role,
  > are registered in Amazon Brand Registry, and are a brand representative."*

  📌 Ou seja: **função do app** + **Brand Registry na conta** + **ser
  representante da marca**. A medição já dizia que faltava algo; a citação diz
  exatamente o quê, e mostra que são três condições independentes — atender uma
  não adianta.

  **CONCLUSÃO:** para a conta da dona do produto — que anuncia como Genérico, sem
  marca registrada — o Brand Analytics **não vira dado**, e nenhuma configuração
  nossa muda isso. Para um cliente futuro com Brand Registry, falta ainda um
  passo do NOSSO lado (ver abaixo).

  🔴 **E HÁ UM PASSO NOSSO QUE NINGUÉM TINHA VISTO.** No console, o app-dash
  ainda vive na **Central de desenvolvedores ANTIGA**: lista 8 funções marcadas e
  **Brand Analytics nem aparece como opção**; o perfil segue *"Desenvolvedor
  privado"*, com banner pedindo migração para o **Portal de provedores de
  soluções** — o portal novo, onde a aprovação de 03/09 aconteceu.
  Então a função existe no portal novo e é **inalcançável pelo app enquanto ele
  estiver no antigo**. Atender um cliente com Brand Registry exige, antes:
  migrar a conta de desenvolvedor e anexar a função ao app.

  ⚠️ **O padrão, pela terceira vez esta semana:** aprovação no papel ≠ acesso
  real, e só a chamada responde. Aqui a economia foi grande — sem a medição,
  teríamos pedido à vendedora uma reautorização que não resolveria nada.

- **2026-09-01 (noite)** — **`getOrderItems` de um pedido `Pending` não traz
  `ItemPrice`, e a chave sequer existe no payload.** Medido com UMA chamada de
  leitura na conexão `amazon:A15NQMF7A6J1Y0`, pedido `701-7591488-7149810`,
  criado às 19:01 do mesmo dia. As chaves devolvidas para o item são exatamente:

  `ProductInfo, IsGift, BuyerInfo, QuantityShipped, IsTransparency,
  QuantityOrdered, ASIN, SellerSKU, Title, OrderItemId`

  Não há `ItemPrice`, `ItemTax` nem `PromotionDiscount` — **ausentes, não nulos
  nem zerados**. Vem ASIN, SKU, título e quantidade; não vem dinheiro.

  ⚠️ **Isto encerra uma investigação que custou um dia e passou por três causas
  erradas.** A tela da vendedora mostrava, no recorte de "Hoje", faturamento de
  31 pedidos e margem calculada sobre 1. As hipóteses que caíram, na ordem:

  1. *"falta o ITEM do pedido pendente"* — falso: 30 dos 31 tinham item, com
     ASIN e quantidade gravados;
  2. *"o estimador de tarifa não roda ou não grava"* — falso: gravava, e
     bastante; o que ele tinha era um portão de entrada por preço, corrigido no
     mesmo dia;
  3. *"os tokens da Amazon estão revogados e falta renovar o OAuth"* — **falso, e
     o erro mais caro**: medido no mesmo dia, o refresh das duas vias devolve
     HTTP 200 e a SP-API responde normalmente. Essa afirmação vinha de uma
     medição do dia anterior tratada como fato do dia seguinte.

  A causa é esta entrada: **a Amazon não publica o valor de um pedido enquanto
  ele está pendente.** Não é defeito nosso, não é autorização, e não há ação da
  vendedora que resolva — o preço aparece quando o pedido despacha.

  📌 **O que isso decide no produto:** pedido pendente sem preço é o **ciclo
  normal** da Amazon, não estado de erro. A ingestão está certa gravando `null`
  (não há o que gravar), e a tela está certa dizendo *"N de M pedidos ainda sem
  valor publicado pela Amazon"* em vez de exibir margem sobre a minoria. Nada a
  consertar aqui — só a saber.

  📌 **E o corolário para o estimador:** a tarifa observada por ASIN é absoluta
  (R$ por unidade) e **não depende de preço**, então ela pode ser gravada para o
  pendente e fica pronta e datada. O que ela **não** produz é lucro: sem receita
  não há resultado, e somar tarifa a uma receita que não existe seria subtração
  sem minuendo.

- **2026-08-31 (noite)** — **E eles NUNCA substituem pelo oficial.** Segunda
  medição na mesma tela do Gestor Seller, que fecha a pergunta deixada em aberto
  na entrada abaixo. Pedido **`702-9124025-9780207`**, criado em **31/07** e
  **aprovado em 10/08**: três semanas depois da aprovação, a tela seguia exibindo
  comissão de **12,01%** — valor de tabela, não de extrato. E o mesmo SKU vendido
  em **julho (consolidado)** e **hoje (pendente)** mostra o **mesmo líquido ao
  centavo**: 21,90 → 13,62 nos dois.

  **O que isso significa para nós:** o número de tabela entra no minuto zero e
  fica para sempre. Se a Amazon cobrar diferente da tabela — promoção, mudança de
  categoria, ajuste, reembolso —, o lucro deles fica errado permanentemente.
  Estimar é o padrão do mercado; **reconciliar com o extrato é o que ninguém
  faz.** É a razão de existir da substituição na
  [ADR-027](adr/ADR-027-tarifa-estimada-ate-a-liquidacao.md).

- **2026-08-31 (noite)** — **`getMyFeesEstimateForASIN` devolve `Success` com
  `Amount: 0` na conta `AO62LVXJMX3AA`.** Medido com chamada real, dois ASINs
  (`B0HBGQNBD4` a R$ 28,90 e `B0HBGLBL6Y` a R$ 22,11), com `IsAmazonFulfilled`
  verdadeiro **e** falso. Em todos: `ReferralFee` 0, `FBAFees` 0 e — o detalhe que
  importa — **`FeePromotion` também 0**, e não uma promoção descontando um valor
  cheio. A resposta traz `SellerId: AO62LVXJMX3AA`, confirmando a conta.

  ⚠️ **Isto não prova que a conta não paga tarifa.** O nosso extrato tem apenas
  **3 pedidos com tarifa real capturada, somando R$ 2,39**, contra R$ 2.014,26 de
  receita em agosto — cobertura fina demais para confirmar ou refutar o zero.
  Fica como medição, não como conclusão. Na conta do colega, a mesma tabela dá
  12% cravado (entrada abaixo), então zero não é comportamento global da API.

  **O que a tela faz com isso:** a marca de estimativa aparece quando **existe
  pedido estimado**, não quando o valor é maior que zero — senão um lucro sem
  tarifa nenhuma apareceria sem dizer que aquele zero é estimativa sujeita a
  substituição na liquidação.

- **2026-08-31** — **O software concorrente calcula comissão e FBA NO MOMENTO DO
  PEDIDO, por tabela, e mostra na tela sem esperar aprovação nem liquidação.**
  Não é observação da SP-API: é medição da tela do **Gestor Seller**, feita pelo
  cérebro em leitura na conta que a Ana usa lá (**Crystal Fancy**, do colega).
  Fica registrado aqui porque responde a pergunta que a nossa documentação
  tratava como aberta — *quando a tarifa pode aparecer* — e porque muda o
  enquadramento da [ADR-027](adr/ADR-027-tarifa-estimada-ate-a-liquidacao.md).

  Pedido medido: **`702-5661774-5509040`**, Amazon FBA, criado em **31/08/2026
  às 22:05:42**. **Data de aprovação: `-`** — ou seja, o equivalente ao nosso
  `pending`, minutos após a criação. A composição inteira já estava na tela:

  | linha | valor |
  |---|---|
  | Total dos itens | +R$ 28,90 |
  | Comissão | −R$ 3,47 |
  | Taxa FBA | −R$ 5,65 |
  | Imposto | −R$ 1,73 |
  | Custo dos produtos | −R$ 12,08 |
  | **Lucro do pedido** | **R$ 5,97** (margem 20,64%) |

  E na linha da lista: *"líquido do marketplace R$ 19,78"* = 28,90 − 3,47 − 5,65.

  **É tabela, não extrato — e a prova é aritmética.** 3,47 / 28,90 = **12,006%**,
  a comissão de categoria batida na casa decimal; número vindo de extrato não cai
  em 12,00% redondo. A Taxa FBA de R$ 5,65 se repete idêntica em pedidos do mesmo
  SKU (quatro conferidos: 28,90 → 19,78 sempre). Derivação minha sobre os números
  deles, marcada como derivação: no outro preço do mesmo SKU, 21,90 → 13,62
  implica comissão 2,63 (**12,0%** de 21,90) e FBA **5,65 de novo** — preço
  diferente, mesma taxa de logística, que é o comportamento de tarifa por
  tamanho/peso e não por valor. É a mesma chave `(ASIN, preço)` cuja dedup já
  medimos do nosso lado.

  **Eles NÃO marcam o número como estimado.** Mostram como se fosse o oficial.
  ⚠️ **Isto não é para copiar** — a marca da casa fica. O que o achado derruba é
  a ideia de que exibir tarifa calculada antes da liquidação seria heterodoxo: o
  software que a Ana usa como referência faz isso desde o minuto zero do pedido.

  **O que ficou sem prova nesta medição — e foi medido depois:** se eles
  substituem o calculado pelo oficial. A resposta está na entrada de 31/08 (noite),
  no topo: **não substituem.**

  Uma observação lateral que vale para o nosso defeito de hoje: o lucro deles
  fecha exatamente sobre o **total de itens do próprio pedido**
  (28,90 − 3,47 − 5,65 − 1,73 − 12,08 = 5,97), e a margem sai sobre essa mesma
  base — **uma base só, do mesmo universo**. A margem exibida (20,64%) fica
  0,02 p.p. abaixo de 5,97/28,90 = 20,66%; o arredondamento exato do denominador
  deles não foi determinado.


- **2026-08-31** — **`getOrderItems` DEVOLVE os itens de um pedido `Pending`:
  traz ASIN, SKU e quantidade — e NÃO traz preço.** Medido com uma chamada real
  na conta `AO62LVXJMX3AA`, pedido `702-7217003-1775439` (Pending, AFN):

  ```json
  { "ASIN": "B0HBGLBL6Y", "SellerSKU": "kit-clips-320",
    "QuantityOrdered": 1, "QuantityShipped": 0,
    "Title": "Kit 320 Clips de Papel Coloridos…",
    "OrderItemId": "168420222447521",
    "ProductInfo": { "NumberOfItems": "1" }, "BuyerInfo": {} }
  ```

  Sem `ItemPrice`, sem `ItemTax`, sem `PromotionDiscount` — os campos de dinheiro
  simplesmente não existem no objeto enquanto o pedido está Pending, do mesmo
  jeito que `getOrders` omite `OrderTotal`.

  ⚠️ **E o nosso banco estava vazio por culpa NOSSA, não da Amazon.**
  `amazonSync.ts` filtra `status IN ('paid','shipped','delivered')` ao buscar
  itens — nunca pedimos os de um pendente. A ausência era consequência da nossa
  consulta, e chegamos a tratá-la como fato sobre a API. É o mesmo mecanismo pelo
  qual a premissa "a Amazon não tem imposto do vendedor" nasceu e sobreviveu no
  código: medir o nosso próprio silêncio e chamar de propriedade da fonte.

  **O que isto destrava:** com ASIN e SKU disponíveis desde o primeiro minuto do
  pedido, dá para estimar a tarifa de um pendente pela Product Fees API — que
  pede ASIN + preço. O preço vem de duas fontes possíveis, nesta ordem:
  1. `ordered_gross` (preço de tabela do PRÓPRIO pedido, do relatório All Orders
     — migration 0010). Medido: pendentes de 29/08 já tinham R$ 22,11; os de
     hoje ainda não, porque o relatório se espaça a cada 3h.
  2. o preço do nosso catálogo, quando o relatório ainda não passou.

- **2026-08-31** — **Os relatórios dedicados a pedidos pendentes NÃO servem para
  esta operação. Não persiga este caminho de novo.** `GET_PENDING_ORDERS_DATA`,
  `GET_FLAT_FILE_PENDING_ORDERS_DATA` e
  `GET_CONVERGED_FLAT_FILE_PENDING_ORDERS_DATA` existem, mas a documentação diz,
  em três eliminatórias independentes:
  - **"only available in the Amazon Japan store"** — a conta é `Amazon.com.br`;
  - **Order Fulfillment Channel: MFN** — os pedidos dela são **AFN** (FBA);
  - e os campos são `order-id, order-item-id, purchase-date, sku, product-name,
    quantity-purchased, payment-type` — **sem preço**, então nem resolveriam.

  Ou seja: mesmo que os dois primeiros não valessem, o relatório entregaria menos
  que o `getOrderItems` acima.

### 29/08/2026 — 📖 LIDO NO MCP OFICIAL DA AMAZON, **não confirmado por chamada nossa**

> ⚠️ **Origem diferente do resto deste changelog.** Todo o resto daqui para baixo
> foi **medido** por nós, contra a API de verdade. As três entradas abaixo vieram
> do **MCP oficial da Amazon** (`sp-api-dev`, ferramenta `sp_api_reference`), que
> fala pela **documentação** — e neste mesmo dia a gente provou que documentação e
> comportamento divergem: o teto do item 1 estava publicado e nós o atropelávamos.
> **Hipótese até uma chamada nossa confirmar.** Quando confirmar, mova para uma
> entrada medida e diga qual chamada provou.

**1. `listTransactions` declara teto de 0,5 req/s, burst 10.** Texto da referência:
*"Usage plan: Rate (requests per second): 0.5, Burst: 10"*. O cabeçalho
`x-amzn-RateLimit-Limit` devolve o limite **efetivamente aplicado**, que pode ser
maior que o padrão — a orientação oficial é ler o cabeçalho em vez de assumir o
número. Sobre o 429: *"A 429 is a retry-able status code. You can try again, but
repeated throttled requests require a back-off strategy."*

Paginação, na letra: `nextToken` deve ser chamado até vir `null`, e a chamada
seguinte deve **incluir os mesmos argumentos** da chamada que gerou o token.

⚠️ **Onde o nosso código difere hoje** (`src/lib/spapi.ts`, `nextTokenPagination.ts`):
a paginação já é serial e o 429 já tem backoff exponencial com `Retry-After`, mas
(a) nada **espaça** as chamadas a 0,5/s — o balde de burst esvazia e o resto vira
429 retentado; (b) o `x-amzn-RateLimit-Limit` é **registrado em log, não obedecido**;
(c) nas páginas seguintes mandamos só `{ nextToken }`, sem repetir `postedAfter`,
`postedBefore` e `marketplaceId`. Funciona hoje; contraria a letra da referência.
**Não mexi no código** — é do backend, e a decisão é dele.

**2. Evento financeiro pode não incluir as últimas 48 horas.** Texto da referência
do `listTransactions`: *"Financial events might not include orders from the last 48
hours."* Se aparecer buraco de repasse no dia corrente e no anterior, essa é a
primeira hipótese — e não é defeito nosso.

**3. Existe filtro por grupo de evento financeiro.** Release note oficial: o
`listTransactions` passou a aceitar filtro por `FinancialEventGroupId`, com
`relatedIdentifierName = FINANCIAL_EVENT_GROUP_ID` e `relatedIdentifierValue` sendo
o id obtido no `listFinancialEventGroups` da **Finances v0**. Há ainda o
`listFinancialEventsByGroupId`, que devolve *"up to 100 financial events"* por grupo.

🔴 **O QUE ISSO NÃO DIZ.** Perguntei ao MCP, por quatro formulações diferentes, até
onde a Transactions API volta no tempo e até onde os grupos de evento financeiro
alcançam. **Ele não respondeu.** A documentação descreve o `postedAfter` e **não
publica limite inferior**; sobre a idade máxima dos grupos, silêncio. Silêncio não é
permissão: **caminho existir não prova que ele alcança o passado.** A pergunta que
decide os 14.692 pedidos antigos sem taxa — se dá para buscar dado anterior a junho —
continua **em aberto**, e só uma chamada real com `postedAfter` anterior a junho
fecha ela.


### 22/08/2026 — "Vendas de produtos solicitados" é preço de TABELA, não o que entrou

Divergência que parecia bug e não era. Conferido pedido a pedido nos 20 pedidos da
conta `AO62LVXJMX3AA`:

| Janela | Seller Central | NEXO | Diferença |
|---|---|---|---|
| 7 dias | R$ 319,49 · 12 unidades | R$ 333,40 · 12 pedidos | +13,91 |
| 15 dias | R$ 449,94 · 18 unidades | R$ 455,01 · 18 pedidos | +5,07 |

⚠️ **A diferença troca de sinal entre as janelas** — e isso é a pista de que não é
uma causa só. São **duas**, em direções opostas:

```
7 dias    319,49 (SC)  + 21,90 (venda de hoje)  − 7,99 (cupom)  = 333,40 ✓
15 dias   449,94 (SC)  + 21,90 (venda de hoje)  − 16,83 (cupom) = 455,01 ✓
```

1. **Cupom.** `Vendas de produtos solicitados` soma o **preço de tabela**, antes do
   cupom que o comprador resgatou. O Faturamento do NEXO soma o que o comprador
   **pagou**. No banco os dois valores já existiam lado a lado — `ordered_gross`
   (tabela, do relatório All Orders) e `gross` (pago) — e a tela só mostrava o
   segundo. Sete pedidos com cupom: 5 × R$ 2,21 no clips + 2 × R$ 2,89 no martelo.
2. **Latência do Seller Central.** A venda das 17:32 de hoje já estava no NEXO e
   ainda não no Seller Central — mesma defasagem de relatório já registrada.

### 🔴 A armadilha do "18 = 18"

Nos 15 dias os dois painéis mostraram **18**, e significavam coisas diferentes:

| | |
|---|---|
| Seller Central: `Unidades pedidas 18` | **unidades** de **17 pedidos** (um pedido levou `kitprote-8 x2`) |
| NEXO: `18 pedidos no período` | **pedidos**, e inclui o de hoje que o SC ainda não tinha |

Dois erros que se cancelaram no total e batiam por coincidência. 📌 **Ao conferir
paridade, casar rótulo com rótulo — unidade com unidade, pedido com pedido.** Números
iguais em campos de nome diferente não são confirmação.

### O que foi feito

A linha **"Cupom resgatado"** entrou na faixa de indicadores do painel da Amazon,
entre "Pedidos feitos" (tabela) e "Faturamento" (pago) — os dois números que ela
comparava sem ter na tela o que os separava. Só aparece quando houve resgate.

**Não mudamos o Faturamento para o número do Seller Central.** Os R$ 16,83 de cupom
não entraram na conta dela; contá-los inflaria faturamento, lucro e margem.


- **2026-08-22** — **Pedido cancelado não tem valor recuperável em NENHUMA API.**
  Testados os quatro caminhos, todos na mesma janela de 30 dias:

  | Fonte | O que devolve para cancelado |
  |---|---|
  | `getOrders` | sem `OrderTotal` |
  | `getOrderItems` | `QuantityOrdered: 0`, sem `ItemPrice` |
  | `sales/v1/orderMetrics` | a linha do dia nem existe |
  | relatório `GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL` | `quantity 0`, `item-price` vazio |

  A Amazon **zera** o pedido cancelado, não o omite parcialmente. O Seller
  Central sabe o valor e mostra; a API não entrega.
  - Consequência: **paridade com o cartão do Seller Central é impossível.**
    Medido: Seller Central R$ 516,27 × API R$ 449,94 — os R$ 66,33 são os 2
    pedidos cancelados. Não adianta procurar outro endpoint.
  - Na tela isso vira "cancelados: N pedidos, valor não informado" — a regra
    `null` ≠ `0` do AGENTS.md aplicada literalmente.

- **2026-08-22** — **`orderMetrics` e o relatório All Orders valorizam a preço de
  tabela, antes do cupom resgatado.** Os dois devolveram exatamente R$ 449,94 na
  mesma janela, e a diferença contra o `OrderTotal` dos 14 pedidos enviados foi
  de **R$ 16,83** — o mesmo total de cupom que o `PromotionDiscount` do
  `getOrderItems` tinha apontado por outro caminho. Confirmação cruzada.
  - Decomposição do R$ 449,94: `360,99` pago + `16,83` cupom + `72,12` de 3
    pendentes (também a preço de tabela).
  - Consequência: **"pedidos feitos" e "faturamento" não diferem só por status,
    diferem por preço.** Um é tabela, o outro é caixa. Somar ou comparar os dois
    sem dizer isso produz número que não bate com nada.
  - Isto é a mesma pegadinha de 2026-08-12 (Pricing API) aparecendo num segundo
    lugar: **no lado do pedido, só o `OrderTotal` é o preço praticado.**

- **2026-08-12** — **Cupom não aparece na Product Pricing API.** O
  `kit-clips-320` (`B0HBGLBL6Y`) estava com cupom de 10% off, e
  `GET /products/pricing/v0/items/{asin}/offers` devolveu `ListingPrice`,
  `LandedPrice` e `BuyBoxPrices` **todos a R$ 22,11**, sem nenhum campo de
  promoção ou desconto. O valor realmente pago (R$ 19,90) só apareceu no pedido,
  via Orders API.
  - Consequência: o preço da Pricing API é o **preço cheio**, não o preço
    praticado. Toda projeção feita em cima dele (margem por SKU, teto de ACOS,
    piso de preço FBA da pesquisa de nicho) fica otimista pelo valor do cupom,
    enquanto o realizado continua correto.
  - Tratar esse preço como **teto**, nunca como preço realizado. Desconto
    desconhecido é desconhecido, não zero.

- **2026-08-06** — **`GET_SALES_AND_TRAFFIC_REPORT` responde 403 Forbidden.**
  Não é token revogado nem erro de código: o relatório exige o papel
  **Brand Analytics**, que este app não possui. O perfil de desenvolvedor e os
  demais papéis funcionam normalmente (pedidos, listings, FBA, financeiro) — é
  um papel adicional que falta.
  - Peculiaridade confirmada em issues do repositório oficial (amzn #1989,
    #3018): Brand Analytics **não aparece como caixa de seleção** na
    configuração do app, diferente dos outros papéis. Precisa ser solicitado
    nominalmente via caso no suporte de desenvolvedores.
  - Depois de concedido: aplicar ao app, re-listar e **reautorizar** (a
    autorização antiga não carrega o papel novo).
  - Consequência: `/amazon/desempenho` (sessões, visualizações, conversão,
    % buy box) está implementado mas não funciona. Fonte alternativa hoje:
    Seller Central → Relatórios de Negócios.

- **2026-08-06** — **Refresh token revogado nas duas contas conectadas por
  OAuth** (`invalid_grant`). O `LWA_REFRESH_TOKEN` do ambiente continua válido —
  scripts de diagnóstico devem rodar **sem** `runWithAccount` para usá-lo. Ver
  [`conexoes-que-expiram.md`](./conexoes-que-expiram.md).

A Amazon muda comportamento e deprecia versões sem quebrar na hora. Toda mudança ou
pegadinha **datada** observada na prática entra aqui — o detalhe fica na seção
correspondente acima; esta lista é o índice cronológico.

- **2026-08-04** — Agendamento self-ship (Fulfillment Inbound 2024-03-20): slots de
  entrega precisam ser **gerados** (`generateSelfShipAppointmentSlots`) antes de
  listar/confirmar; sem isso o calendário do Seller Central fica sem botão de confirmação.
- **2026-08-03** — Catalog Items 2022-04-01 em lote (`identifiers`): confirmado que o
  `pageSize` padrão é **10** — lotes de 20 ASINs voltavam pela metade em silêncio (o
  snapshot de ranking rodou semanas capturando metade dos itens). Sempre passar `pageSize`.
- **2026-07-22** — Semântica de PATCH com selectors confirmada com o caso real do FNSKU
  travado por offer FBA+FBM duplo (fonte oficial: issue #2061). `replace` não sobrescreve
  array; remover entrada exige `delete` com selector no `value`.
- **(sem data precisa)** — `GET /finances/v0/financialEvents` retorna valores **zerados**
  nesta conta (deprecação silenciosa). Fees e lucro migrados para
  `GET /finances/2024-06-19/transactions`.
