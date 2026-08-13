# Plano: Integração TikTok Shop

> **Status (07/08/2026):** app **existe** no Partner Center (app "sellercore",
> key `6kl9m4ajdcvpm`) e a **revisão de Data Security & Privacy (DSPR) foi
> APROVADA** em 07/08 — era o que travava desde 04/08. O código da integração
> ainda **não foi escrito**; o que existe é o esqueleto de OAuth (ver "Estado do
> código" abaixo).
>
> Registrado em 2026-07-15, atualizado em 07/08/2026.
> Relacionado: [`estado-atual.md`](./estado-atual.md), [`arquitetura-plano.md`](./arquitetura-plano.md).

## Por que priorizar (vs. Shopee)

O **TikTok Shop já está aberto no Brasil** (lançou em maio/2025, cadastro de
vendedor liberado em 2026) — diferente da Shopee, que ficou pausada esperando
verificação. Único requisito: **empresa** cadastrada (MEI, EI, SLU, LTDA, S/A);
só CPF não abre loja de vendedor.

## Visão geral — TikTok Shop Partner API v2

- App criado no **TikTok Shop Partner Center** → `app_key` + `app_secret`.
  É uma **integração separada** da Amazon (outro app, outras credenciais — igual
  o Amazon Ads é separado da SP-API).
- **Host da API:** `https://open-api.tiktokglobalshop.com`
- Toda chamada de negócio exige: **assinatura HMAC-SHA256** + `app_key` +
  `timestamp` + **`access_token`** (header `x-tts-access-token`) + **`shop_cipher`**
  (identifica a loja).

## Fluxo de autenticação (OAuth)

1. Vendedor autoriza o app → retorna `auth_code`.
2. Troca o code por tokens no token endpoint
   (`https://auth.tiktok-shops.com/api/v2/token/get`) → `access_token` (curta
   duração) + `refresh_token` (longa).
3. Renova o `access_token` periodicamente via `refresh_token`.
4. `GET /authorization/202309/shops` → lista lojas autorizadas com `shop_id` +
   `shop_cipher`.

> Os endpoints de token **não** usam a assinatura HMAC — vão com
> `app_key` + `app_secret` direto.

## Algoritmo de assinatura (HMAC-SHA256)

⚠️ **Validar na doc oficial / Postman antes de codar** (a página de assinatura não
renderizou na pesquisa; abaixo é do conhecimento geral). Assinatura errada = 401.

1. Pegar todos os query params **exceto** `sign` e `access_token`.
2. Ordenar as chaves em ordem alfabética.
3. Concatenar no formato `{chave}{valor}` (sem separador).
4. **Prefixar o path** da requisição: `path + params`.
5. Se `Content-Type` **não** for `multipart/form-data`, anexar o **corpo JSON** cru.
6. Envolver com o segredo: `app_secret + string + app_secret`.
7. **HMAC-SHA256** com `app_secret` como chave → hex → é o `sign`.
8. Enviar `sign`, `timestamp` (unix segundos) e `app_key` na query;
   `access_token` no header `x-tts-access-token`.

## Endpoints que interessam (versão 202309+)

| Área | Endpoint | Pra quê |
|---|---|---|
| Lojas | `GET /authorization/202309/shops` | shop_id + shop_cipher |
| Produtos | `POST /product/202309/products/search` | catálogo, preço, estoque |
| Pedidos | `POST /order/202309/orders/search` + detalhe | vendas, itens |
| **Financeiro** | `GET /finance/202309/statements` / transactions | **payout real + taxas** |
| Logística | `/logistics/...`, `/fulfillment/...` | envio |
| **Webhooks** | configurados no Partner Center | **push de pedido em tempo real** (ex.: `ORDER_STATUS_CHANGE`) |

Vantagem sobre a Amazon: webhooks empurram o pedido no servidor — não precisa
ficar consultando.

## Como encaixa no SellerCore

Mesma arquitetura já existente:
- **`lib/tiktok.ts`** — assinatura HMAC + gestão de token por loja (guardado no
  Postgres, junto das contas Amazon).
- **Rotas OAuth do TikTok** (login/callback), no padrão do `withAccountContext`.
- **Adapters** mapeando pedido/produto/financeiro do TikTok para os *shapes*
  comuns do app → dashboard, gráfico e o futuro copiloto ganham TikTok Shop de
  graça (para eles, "venda" é uma coisa só, venha da Amazon ou do TikTok).

## Caveats

1. **Integração separada** — app próprio no Partner Center, credenciais distintas.
2. **Precisa de empresa** cadastrada no TikTok Shop BR + app aprovado.
3. **Validar assinatura** na doc oficial/Postman antes de escrever código.
4. **Rate limit por QPS** por app → backoff (reusar o padrão do `spapiFetch`).
5. Credenciais (`app_key`/`app_secret`, tokens) **só em env/Postgres**, nunca no código.

## ✅ Base construída (2026-07-16)

- Credenciais validadas contra a TikTok (smoke-test no endpoint de token retornou
  "invalid auth code", não erro de app → `app_key`/`app_secret` reconhecidos).
- **Endpoint de token confirmado:** `https://auth.tiktok-shops.com/api/v2/token/get`
  (o host sem hífen não existe).
- `src/lib/tiktok.ts` — assinatura HMAC-SHA256, `exchangeAuthCode`,
  `refreshAccessToken`, `tiktokFetch` (assinado), `getAuthorizedShops`.
- `src/lib/tiktokStore.ts` — persiste lojas+tokens no Postgres (fallback JSON);
  tabela `tiktok_shops` no schema.
- Rotas: `/api/tiktok/login` (redireciona para `TIKTOK_AUTH_URL`) e
  `/api/tiktok/callback` (troca o code → lista lojas → salva).
- Env: `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_AUTH_URL`.

**Falta para o primeiro dado real:** o vendedor autorizar a loja (gera o
`auth_code`). Depois disso: mapear **pedidos + financeiro** para os shapes comuns.

## Próximo passo

**DSPR aprovada em 07/08/2026.** Checklist **lido no console em 07/08**
(`partner.tiktokshop.com/service/gather?service_id=7662688850348934932`), não
mais suposto:

**Partner onboarding**
1. Partner registration review — revisão de contato e dados de empresa
2. Data security and privacy review — ✅ *"You passed the data security and
   privacy review"*

**Getting ready to publish**
3. **Listing review** — *"We will review listing information that will be shown
   on the TikTok Shop App & Service market for sellers"*
4. **App review** — *"We will review and **test** app functionality"*

Depois disso, o botão **Publish**.

### Estado do app no console (07/08)

| | |
|---|---|
| Nome / ID | `sellercore` / `7662688850348934932` |
| App key | `6kl9m4ajdcvpm` |
| Status | **Draft**, visibilidade **Public**, tipo **Product Listing** |
| Redirect URL | `https://sellercore.onrender.com` — já configurado |
| Target sellers | **Brazil · Local sellers** — marcado **"1 to complete"** ⚠️ |
| Listing pt-BR | existe, atualizado em 16/07 |

⚠️ **IP allowlist também existe aqui** (marcado "New"): *"Manage the IP addresses
permitted to use your app key to retrieve seller data"* — mesmo padrão da Shopee.
O IP de saída do Render é **`74.220.49.18`**, medido em 07/08 (ver
[`api-shopee.md`](./api-shopee.md), entrada de 07/08, para o método). Vale
declarar antes do App review, não depois.

⚠️ O console mede **SLA de suporte** do parceiro (tempo de primeira resposta em
2h, resolução em 48h). Hoje há 0 tickets, então as taxas aparecem como 0%.

### O que a API do Partner Center respondeu (07/08, via TTS Open Toolkit)

CLI `@tts-open-toolkit/cli` 0.1.7, `auth login` OAuth (escopo
`open_toolkit:developer`, região BR), `devapi call partner-service-detail
--query service_id=7662688850348934932`.

**1. Dá para testar com loja real ANTES do Publish.**

```
seller_invitation_link      = true
invitation_link             = https://services.tiktokshop.com/open/authorize
auth_link_list[0].auth_type = 1
custom_beta_authorization_num = 25
```

São **25 autorizações beta**. Um vendedor conhecido autoriza a loja pelo link de
convite e o app já lê dados reais — sem esperar Listing review, App review nem
Publish. É o caminho para validar `tiktokCanonical.ts` contra resposta real
**antes** da revisão funcional, exatamente o que faltou na Shopee.

**2. O "1 to complete" é a ficha em branco.** O registro do listing pt-BR existe,
mas o conteúdo está vazio:

```
language_listing[0].language        = pt
language_listing[0].service_name    = (vazio)
language_listing[0].service_logo    = (vazio)
language_listing[0].service_main_image = (vazio)
language_listing[0].video           = (vazio)
language_listing[0].contact_email   = (vazio)
language_listing[0].contact_phone   = (vazio)
language_listing[0].official_website= (vazio)
```

Trabalho sem código, dá para fazer hoje.

**3. Status dos gates**

| Campo | Valor | Leitura |
|---|---|---|
| `partner_cert_status` | 4 | certificação do parceiro OK |
| `opis_status` | 4 | OPIS OK |
| `need_usds` / `usds_status` | false / 0 | não exigido |
| `app_review_status` | 1 | **App review ainda não feito** |
| `need_app_review` | true | obrigatório |
| `service_status` | 1 | Draft |

**4. Categorias divergem** — vale checar se limita escopo de API (a Shopee tem
regra equivalente: App Type imutável define endpoints):

- Serviço: `Product Listing` (884624)
- Identidade do parceiro: `Order Management (OMS / WMS)` (836880), sob
  `Shipping & Fulfillment`

### ⚠️ Vendedor real não consegue autorizar enquanto a ficha estiver vazia (07/08)

Um vendedor com loja **brasileira** tentou autorizar pelo link e recebeu
*"Não disponível na região da sua loja — este aplicativo ou serviço não está
disponível no mercado atual do vendedor"*.

A URL da tela de autorização mostra que a região estava certa:

```
/authorize/7662688850348934932?is_draft=true&is_new_connect=0
  &noUser=login&prev=transit&region_check=1&shop_region=BR
```

`shop_region=BR` e mercado-alvo BR, e mesmo assim recusou. Expandindo o mercado
Brasil no console, o "1 to complete" é:

> **Language listings remain to be filled out** — *To complete*

Bate com o que a API já dizia: `language_listing[0]` (pt) tem todos os campos
vazios. **Nada chegou ao nosso banco** — `workspace_tiktok_shops` com 0 linhas e
"Manage services" do console vazio em todos os status. O bloqueio é anterior ao
redirect; o código não foi exercitado.

Hipótese principal: ficha vazia → mercado incompleto → app indisponível para o
vendedor. Hipótese alternativa não descartada: app em `Draft` não aceita
autorização até publicar, e as 25 autorizações beta dependem de outro caminho.
Preencher a ficha resolve o Listing review de qualquer forma — é o teste barato.

**Ficha pt-BR COMPLETA em 07/08 18:51** — o indicador ficou verde e o
**"1 to complete" sumiu** do mercado Brasil. Preenchido: nome, logo 1:1,
descrição curta, mídia em destaque, 3 imagens, descrição detalhada (921 chars),
três "Key benefits", plataformas integradas (Amazon, Shopee), e-mail e site.

Quatro armadilhas do formulário que custaram tempo e vão custar de novo:

1. **A proporção da imagem precisa ser EXATA.** O primeiro banner era 1297×778 =
   1,6671; 5:3 é 1,6667. O componente (Arco Upload) **rejeita em silêncio** —
   o arquivo entra no input e nada acontece, sem mensagem. Com 750×450 (exato)
   funcionou na primeira tentativa. Gerar sempre com altura múltipla de 3.
2. **"Don't use the TikTok Shop logo"** vale para banner e galeria — o que
   elimina qualquer print com a barra lateral do SellerCore, porque ela agora
   mostra o ícone do TikTok. Recortar a lateral fora (250 px) resolve.
3. **O campo de nome trunca no primeiro caractere "especial".** `SellerCore —
   Lucro e operação multicanal` virou `SellerCore` depois de salvar: o travessão
   corta o resto sem avisar. Usar hífen simples ou nada.
4. **Salvar não basta para o mercado ficar completo** — só ficou verde quando a
   galeria de imagens (mín. 3) também foi preenchida.

O logo 1:1 foi gerado de `public/brands/sellercore-logo.png` (621×400, não
quadrado) com `sharp`: reduzido a 78% e centralizado num quadrado branco 600×600.

⚠️ **Telefone pessoal na vitrine.** O campo "Contact phone" veio pré-preenchido
pela conta com `BR +55 11966695597` e vai a público junto com a ficha. Decidir se
fica.

⚠️ **O dashboard `/amazon` aparece vazio na conta demo** ("Nenhuma conta"), porque
a Amazon lê da SP-API e não do canônico — por isso a galeria usa central, ML e
Shopee. É a mesma pendência registrada em `estado-atual.md`.

### Caminho escolhido: Custom app para validar, ISV para vender (07/08)

O app **público** (ISV) só aceita autorização de vendedor **depois de publicado**,
e publicar exige Listing review + App review. O App review testa a funcionalidade
— ou seja, exige a integração pronta. Isso trava a validação.

A saída é o **Custom app**, e ela **não** exige nada do vendedor:

> *"Custom app: Not listed publicly. Developers share a private authorization link
> with selected sellers."*
> *"Custom apps usually launch privately by authorization link. App review is
> required only for... custom apps with 25 or more seller authorizations."*

Ou seja: o custom app é criado **na nossa conta de parceiro**, não na conta do
vendedor. Ele só clica no link e autoriza.

**Criado em 07/08:**

| | |
|---|---|
| Nome | SellerCore Conexao Direta |
| Service ID | `7671117911286351636` |
| App key | `6kt9seem3qnjr` |
| Tipo / categoria | Custom · Order Management (OMS / WMS) |
| Mercado / vendedor | Brasil · Local sellers |
| Redirect URL | `https://sellercore.onrender.com/api/tiktok/callback` |
| Escopos | 4, **todos de leitura**: `seller.order.info`, `seller.finance.info`, `seller.product.basic`, `seller.authorization.info` |

⚠️ **Categoria, mercado e tipo de vendedor não mudam depois da criação.**

⚠️ **Publicar exigiu o registro de parceiro para o Brasil**, que estava em
*"Draft - Awaiting submission"* com CNPJ e documentos já preenchidos, nunca
submetido. **Submetido em 07/08 — status "Under review", 3 a 5 dias úteis.**
Enquanto não aprovar, o Publish fica bloqueado e nenhuma loja autoriza.

**Depois da aprovação:** publicar o custom app → sai o link privado de
autorização → o vendedor clica → token → validar `tiktokCanonical.ts` contra
pedido e extrato reais → aí sim o caminho ISV com o mapeamento provado.

### PUBLICADO — o desvio pela categoria já aprovada (08/08)

Accounting e Order Management foram **rejeitadas** com a mesma razão:

> *"The Company Number that you entered was inconsistent with the company number
> on your Company registration document."*

O `Company registration number` do formulário está como `66.106.202/0001-20`
(igual ao CNPJ, com máscara) e o revisor não aceitou. **Pendência: descobrir o
valor que ele espera** — provavelmente sem pontuação, ou outro número do
documento. Vale para recuperar as duas categorias e para o app público ISV.

O desvio que destravou: a categoria **não restringe escopos** (os 21 aparecem em
qualquer uma), e **Catalog / Product Listing já estava aprovada**. Criar o custom
app sob ela publica na hora, sem depender da correção.

| | |
|---|---|
| Nome | SellerCore Conexao Parceiro |
| Service ID | `7671696361289074452` |
| App key | `6kt9seens0iip` |
| Tipo / categoria | Custom · **Catalog / Product Listing** (aprovada) |
| Mercado / vendedor | Brasil · Local sellers |
| Redirect URL | `https://sellercore.onrender.com/api/tiktok/callback` |
| Escopos | os mesmos 4 de leitura, todos `Active`, nenhum em review |
| Status | **On · Beta Testing** — limite de **25** autorizações |
| Link de autorização | `https://services.tiktokshop.com/open/authorize?service_id=7671696361289074452` |

⚠️ **`status` na `partner-profile` é o INVERSO do intuitivo.** A leitura correta,
conferida contra a tela `My Account → Profile → My category & market`:

| valor | significa |
|---|---|
| `1` | **Approved** |
| `3` | Not approved (rejeitada) |
| `5` | Draft — nunca submetida |

Ler `5` como "aprovado" custou duas submissões e uma rejeição. Confirme sempre
contra a tela antes de decidir com base nesse campo.

### Escopos de API — o pedido vinha DESLIGADO (07/08)

`App & Service → sellercore → Manage API`. São **21 escopos**, e o de pedido não
estava entre os ativos. Não é limitação de categoria nem exige aprovação: o
**Order Information** (`seller.order.info`, Scope ID 430276) vem **desligado por
padrão**, marcado como `Sensitive data`, com o aviso:

> *"This scope contains customers' personal information. Do not enable it unless
> necessary."*

Coerente com o schema: `GET /order/202507/orders` devolve `cpf`, `cpf_name`,
`buyer_email` e `recipient_address`. Ligado em 07/08 — sem ele o módulo `order`
(9 endpoints) fica inacessível, e o `Finance Information` que já tínhamos fica
inútil, porque o extrato se consulta **por `order_id`**.

⚠️ **Ao adicionar escopo, lojas já autorizadas precisam REAUTORIZAR.** Como havia
zero lojas conectadas, ligar agora não quebrou ninguém; depois quebraria.

⚠️ **Excesso de privilégio a corrigir antes do App review.** Estão ativos quatro
escopos de **escrita** que o produto não usa: `Product Modify`,
`Product Delete & Recover`, `Promotion Modify` e `Update Delivery Status`. O
SellerCore é somente leitura. Pedir permissão de apagar produto num painel de
lucro contradiz o próprio App review, que avalia se o escopo condiz com a função.

O único que continua inativo é `Manage Seller Redeem Info Callback`
(`seller.redeem_info.write`) — esse exige "Apply", e não precisamos.

### Endpoints escolhidos (OAS oficial, 07/08)

Selecionados pela regra do `tts-openapi-guide`: **maior versão aplicável**, salvo
quando só existe uma. Conferir contra o docv2 antes de implementar — o OAS
empacotado é baseline local, não prova de que é o mais recente.

| Capacidade | Método e caminho | Versão | Por quê |
|---|---|---|---|
| Lista de pedidos | `POST /order/202309/orders/search` | 202309 | única versão de `search` |
| Detalhe do pedido | `GET /order/202507/orders` | **202507** | mais nova (havia 202309) |
| **Taxas reais por pedido** | `GET /finance/202501/orders/{order_id}/statement_transactions` | **202501** | mais nova (havia 202309) |
| Lista de produtos | `POST /product/202502/products/search` | **202502** | mais nova (havia 202309, 202312) |
| Detalhe do produto | `GET /product/202309/products/{product_id}` | 202309 | única versão |

**O `statement_transactions` é o equivalente ao escrow da Shopee** — é ele que dá
lucro real por venda. Resposta (campos monetários vêm como **string**):

```
data.currency, data.revenue_amount, data.fee_and_tax_amount,
data.shipping_cost_amount, data.settlement_amount, data.order_create_time
data.sku_transactions[]: product_name, quantity, revenue_amount,
  fee_tax_amount, shipping_cost_amount, settlement_amount
  + revenue_breakdown / fee_tax_breakdown / shipping_cost_breakdown
```

No modelo canônico, `fee_and_tax_amount` alimenta taxa do canal e
`shipping_cost_amount` alimenta frete. `revenue_amount` é usado para reconciliar
o extrato, mas não substitui o gross: o gross continua vindo dos itens do pedido,
para não confundir venda bruta com descontos ou ajustes liquidados. Há também
detalhamento **por SKU**, que a Shopee não dá com essa granularidade.

### Reconciliação dos breakdowns financeiros (11/08/2026)

O parser produtivo usa apenas os totais liquidados do pedido. Na amostra real já
registrada, `revenue_amount = 23,90`, `fee_and_tax_amount = -9,13`,
`shipping_cost_amount = 0` e `settlement_amount = 14,77`: portanto os custos vêm
com sinal negativo e o canônico os inverte para débito positivo. A identidade
observada é `revenue + fee_and_tax + shipping_cost = settlement`.

Os três breakdowns ficam dentro de `sku_transactions[]`; o contrato oficial os
apresenta como detalhamento de `revenue_amount`, `fee_tax_amount` e
`shipping_cost_amount`, não como valores adicionais. Logo, persistir o total e
também seus componentes como fees duplicaria custos. Uma futura decomposição
deve **substituir** a linha agregada somente quando a soma assinada dos
componentes reconciliar ao centavo com o total correspondente; caso contrário,
mantém-se o total e a cobertura do detalhe fica pendente.

Mapeamento funcional ainda bloqueado por falta de nomes/valores reais dos
componentes (o OAS informa a estrutura, mas não prova a semântica regional):

- **Ads:** só pode virar `ads` se um componente real de `fee_tax_breakdown` for
  identificado pela documentação oficial e reconciliar dentro de
  `fee_tax_amount`. Nunca somar Ads por fora de `fee_and_tax_amount`.
- **Impostos retidos:** mesma regra, com destino `taxes_withheld`. Não confundir
  retenção do marketplace com `payment.product_tax`/`shipping_fee_tax` nem com o
  imposto configurado pelo vendedor no dashboard.
- **Reembolsos:** pode ser ajuste negativo de `revenue_breakdown` ou outro tipo
  de transação. Até observar o payload, não virar `refund`: adicioná-lo como fee
  enquanto `revenue_amount` já estiver líquido produziria dupla redução; trocar
  o gross canônico pelo `revenue_amount` também misturaria venda bruta com
  descontos/ajustes.

Tentativa read-only em 11/08/2026: a API recusou a leitura com código
`36009002`, apesar de o vencimento armazenado da conexão ainda estar no futuro.
Nenhum refresh foi disparado e nenhum identificador, payload ou PII foi
registrado. O desbloqueio exato é reautorizar/renovar a conexão e coletar uma
evidência agregada contendo apenas nome do componente, sinal, soma e reconciliação
com o total pai, idealmente incluindo um pedido com Ads, retenção e reembolso.

⚠️ **PII do Brasil no detalhe do pedido.** `GET /order/202507/orders` devolve
`cpf` e `cpf_name`, além de `buyer_email`, `buyer_nickname` e `buyer_avatar`.
**Não ingerir** — o modelo canônico não tem nem precisa desses campos, e o
[`standard de proteção de dados`](./compliance/personal-information-protection-standard.md)
manda reter o mínimo. O `tiktokCanonical.ts` deve descartar explicitamente, não
por omissão: campo que não é lido hoje vira campo copiado sem querer amanhã.

⚠️ **O que a CLI NÃO entrega:** `authorization-open-api-list` exige `pkg_id`, que
não aparece em nenhuma resposta acima. E as rotas de `developer_center_api`
(`/api/v1/app/list`, `/api/v1/app/detail`) devolvem **não-JSON** para esta conta —
provavelmente por ser conta de Partner Center (ISV) e não de Developer Center.
A lista definitiva de endpoints liberados ainda precisa sair do **"Manage API"**
no console.

O passo 3 descrito no plano original foi concluído: OAuth, leitura de pedidos e
produtos, sync/cron, modelo canônico e ledger retomável existem. A sidebar expõe
Dashboard e Financeiro, e monitor, catálogo, produtos, estoque e curva ABC
preservam loja, período e os filtros aplicáveis. Isso foi coberto localmente;
não deve ser confundido com validação visual ou autenticada.

O QA autenticado está **BLOCKED** porque a mesma loja tem ownership duplicado
entre workspaces; o harness exige ownership exclusivo e não escolhe um owner
arbitrariamente. A migration `0005_workspace_financial_ledger.sql` também não
foi aplicada neste ambiente. O runtime falha fechado apenas nas superfícies que
dependem do ledger e mantém vendas/catálogo disponíveis, sem inventar zeros.

## Fontes

## Changelog observado

- **11/08/2026 — superfície de produto e bloqueios de QA:** Dashboard,
  Financeiro, sidebar e módulos com filtros por loja/período estão
  implementados. O harness detectou ownership duplicado e interrompe o QA sem
  expor identificadores. O contrato local da 0005 está certificado, mas a
  migration não foi aplicada neste ambiente; validação autenticada segue
  bloqueada.

- **11/08/2026 — ledger financeiro revisado após evidência paginada:**
  `GET /finance/202309/statements` respondeu 31 dias/31 statements `PAID`;
  `GET /finance/202501/statements/{statement_id}/statement_transactions`
  respondeu 175 linhas em duas páginas (174 com pedido), com tipos provider
  observados `ORDER` e `LOGISTICS_REIMBURSEMENT`; `GET /finance/202605/payments`
  respondeu 200 linhas em duas páginas; e
  `GET /finance/202507/orders/unsettled` respondeu 675 estimates em sete páginas.
  Fixtures locais conservam somente shapes e valores financeiros sanitizados,
  sem IDs reais ou PII.
- **11/08/2026 — identidade, sinais e cobertura do ledger:** os quatro endpoints
  são fontes distintas. Payment nunca entra no lucro; unsettled é estimate e
  somente uma linha final com o mesmo `transaction_id` pode substituí-lo por
  precedência. `fee_and_tax_amount` e `shipping_cost_amount` negativos são
  convertidos em débitos canônicos positivos; `revenue_amount` e
  `settlement_amount` preservam a semântica do provider. A cobertura só fecha
  após cursor terminal e página integralmente válida, com tipo e associação de
  pedido resolvidos. Uma página com ID vazio, timestamp/moeda inválidos ou tipo
  desconhecido falha sem avançar checkpoint.
- **11/08/2026 — reembolso logístico e paginação fail-closed:** o tipo observado
  `LOGISTICS_REIMBURSEMENT` preserva `order_id` e `adjustment_order_id`, mas seu
  `revenue_amount` é classificado exclusivamente como `adjustment`, nunca como
  receita de venda. Para os sinais reais observados, a identidade é
  `adjustment - fee debit - shipping debit = settlement_amount`; assim o crédito
  reconcilia sem inflar o revenue oficial nem contar o mesmo valor duas vezes.
  Statement `PENDING` ou com status desconhecido mantém a janela incompleta e
  produz diagnóstico retryable. Nos quatro recursos, `page_token` presente mas
  vazio, igual ao cursor atual ou já visto na execução interrompe a tentativa
  antes de escrita/checkpoint, preservando o cursor para retry e evitando loop.
- **11/08/2026 — categorias não observadas continuam desconhecidas:** não se
  inferem `COMMISSION_FEE`, `PAYMENT_FEE`, Ads, imposto retido ou refund. O total
  pai comprovado `fee_and_tax_amount` ocupa provisoriamente a coluna agregadora
  de fees; Ads/refunds/withheld permanecem `null` até um breakdown real fechar
  ao centavo contra o pai. Os códigos provider brutos observados são preservados
  em allowlist.
- **11/08/2026 — retomada e rate limit:** checkpoints retomam primeiro a janela
  incompleta mais antiga; dias UTC fechados têm identidade determinística e o
  dia corrente usa janela separada. HTTP 429 e código provider `36009002`, mesmo
  em HTTP 200, encerram a tentativa para backoff/retomada sem avançar cursor.
- **11/08/2026 — fonte financeira única:** `/tiktok` e
  `/tiktok/financeiro` consultam o mesmo snapshot do ledger. Janelas finais
  by-statement contíguas e integralmente válidas são autoritativas; o extrato
  por pedido permanece apenas fallback/recovery enquanto essa cobertura não
  existe, sem ser somado ao ledger. Se o período alcançar o dia UTC corrente,
  a cobertura permanece parcial mesmo que todas as páginas lidas até agora
  tenham cursor terminal.

- **11/08/2026 — conciliação financeira real:** a fila de extratos caminha em
  ordem determinística (sem tentativa antes, depois tentativa mais antiga), em
  até 100 chamadas sequenciais por loja e sob orçamento de 180 s. Placeholders e
  `36009002` registram a tentativa e continuam desconhecidos; nunca viram zero.
  HTTP 429 encerra o lote imediatamente para o cron posterior retomar.
- **11/08/2026 — configuração financeira:** alíquota de imposto é persistida por
  loja TikTok (`tax_rate`, nullable) e SKUs TikTok entram no cadastro canônico de
  custos com chave isolada por conexão. Ads, refunds e impostos retidos seguem
  `null` até existir evidência que os separe.

- **11/08/2026 — breakdown financeiro:** totais liquidados e seus sinais estão
  confirmados, mas Ads, impostos retidos e reembolsos continuam sem mapeamento
  por componente. A leitura adicional foi recusada com `36009002`; o parser
  conserva os totais para não duplicar `fee_and_tax_amount`,
  `shipping_cost_amount` ou reduzir duas vezes a receita.

- **11/08/2026 — loja real BR:** `POST /product/202502/products/search`
  devolveu o preço das variações em `price.tax_exclusive_price` (não em
  `sale_price`). Alguns produtos não vendáveis/rascunhos vieram sem preço ou
  estoque comprovável; o sync os exclui do snapshot em vez de fabricar zero ou
  descartar o catálogo válido inteiro.
- **11/08/2026 — loja real BR:** pedidos paginados em lotes de 50 com
  `next_page_token`; detalhe em lote e extrato 202501 responderam com sucesso.
  Pedidos sem extrato liquidado continuam compondo faturamento bruto capturado,
  enquanto lucro, margem e cobertura financeira permanecem parciais.

- TikTok Shop Partner Center — Sign your API request:
  https://partner.tiktokshop.com/docv2/page/sign-your-api-request
- TikTok Shop Partner Center — Call your first API using Postman:
  https://partner.tiktokshop.com/docv2/page/call-your-first-api-using-postman
- TikTok Shop Data API (2026) — EchoTik:
  https://www.echotik.live/blog/tiktok-shop-data-api-access-endpoints-metrics-and-analytics-2026/
- TikTok Shop Brasil — seller.tiktok.com
- TikTok Shop Brasil 2026 — TecNois: https://tecnois.com.br/tiktok-shop-brasil-2026/
