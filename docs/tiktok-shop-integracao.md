# Plano: Integração TikTok Shop

> **Status (20/09/2026):** o app **público** está publicado no Service Market e é
> o **único** caminho de autorização. **Existe cliente real conectado por ele**
> — a primeira loja entrou em 12/09/2026 e sincroniza pedidos normalmente
> (1.863 pedidos, cobertura 01–20/09, último ciclo há minutos).
>
> ⚠️ **A conciliação financeira desse cliente NUNCA rodou.** Medido em
> 20/09/2026: o ledger está travado na primeira janela desde a estreia, oito
> dias, por `TIKTOK_FINANCIAL_ORDER_ASSOCIATION_UNRESOLVED` — a colisão entre a
> regra de estreia (só o mês vigente) e a recusa de gravar transação de pedido
> que não temos. **Atinge todo vendedor novo, não é caso isolado.** Ver o
> changelog de 20/09.
>
> ⚠️ **Não há mais migração custom→público.** A loja que usava o app custom era
> **sonda** (serviu para medir o que a API entrega) e saiu do banco em 12/09.
> Resta o custom apenas na conexão de demonstração — ver "Desligar o custom".
>
> Registrado em 2026-07-15, atualizado em 20/09/2026.
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

## O caminho de entrada de um vendedor (20/09/2026)

**Só existe uma porta: o botão "Integrar" dentro do NEXO.**

```
/integracoes  →  GET /api/tiktok/login   (exige sessão; gera state; grava cookie)
              →  consentimento na TikTok (app PÚBLICO)
              →  GET /api/tiktok/callback?code=…&state=…
              →  troca o auth_code  →  lista as lojas  →  grava app='publico'
              →  sync imediato (estreia = mês vigente)
```

| ponto | regra | onde |
|---|---|---|
| qual app autoriza | **sempre o público**; não existe mais "padrão" | `APP_DA_AUTORIZACAO` |
| público não configurado | **recusa** (503), nunca cai no custom | `appDaAutorizacao()` |
| como ler linha antiga | `custom` — é a verdade de quem nasceu antes da 0033 | `APP_DE_LINHA_ANTIGA` |
| cartão habilitado na tela | depende das três `TIKTOK_PUBLIC_*` | `tiktokConfigured()` |

⚠️ **O Service Market NÃO é porta de entrada** (decisão de produto, 11/09/2026).
Uma instalação iniciada lá chega ao callback **sem o nosso `state`**, e sem ele
não há como saber para qual workspace a loja vai. Desde 12/09 esse caminho é
reconhecido e responde *"comece pelo botão Integrar aqui no NEXO"* em vez do
JSON cru que devolvia antes; o `auth_code` é **descartado sem uso** (trocá-lo
seria vetor de CSRF).

### Os desfechos do callback, e o que cada um diz

Todos são registrados no log com a marca `[tiktok-conexao]`
(`tiktokConexaoTentativa.ts`) — sem token, sem PII, workspace abreviado.

| desfecho | o que o vendedor vê |
|---|---|
| `conectada` | volta para `/integracoes?connected=tiktok_shop` |
| `loja_de_outra_conta` | *"Loja já conectada ao NEXO. Desconecte-a na conta onde ela está antes de conectar aqui."* — **sem dizer qual conta** |
| `sem_lojas` | *"A TikTok confirmou a autorização, mas ainda não liberou a loja…"* (após 3 tentativas com 1,5s) |
| `sem_state` | manda voltar pelo botão |
| `state_invalido`, `codigo_ausente`, `recusado_na_tiktok`, `erro` | mensagem específica de cada caso |

## Desligar o custom — o que falta

A condição é uma **consulta**, não uma lembrança: o custom sai quando não houver
nenhuma linha com `app = 'custom'` em `workspace_tiktok_shops`.

Estado em 20/09/2026: **resta uma linha — a conexão de demonstração**
(`Loja Demo TikTok`). A loja-sonda saiu do banco em 12/09.

1. decidir o que fazer com a demo — migrar para `publico`, marcá-la como interna
   e excluí-la da condição, ou aposentá-la. **Pendente com a dona do produto**;
2. `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET` e `TIKTOK_SERVICE_ID` saem do Fly —
   **passo dela**. Sem trava técnica: nenhuma conexão real depende mais deles;
3. o custom sai do código: `tiktokApps.ts` colapsa, o parâmetro `app` fica com um
   valor só e morre junto, e os dois scripts que exigem as variáveis antigas
   (`scripts/tiktok-qa-evidence.mjs`, `scripts/tiktok-reprocess-real.mjs`)
   passam a apontar para o público.

⚠️ **2 nunca antes de 1.** Sem as credenciais do custom, qualquer conexão ainda
marcada `custom` para de assinar **e de renovar** — vira uma linha que erra a
cada ciclo, para sempre.

## Próximo passo (histórico — 07/08/2026)

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

## Tipos de transação do extrato — o que entra em cada conta

**Estado: reembolso da plataforma DECIDIDO; a tabela dos demais tipos aguarda o
OK da dona do produto (levada em 11/09/2026).**

### O que está decidido

`PLATFORM_REIMBURSEMENT` entra como **reembolso/ajuste — dinheiro que ENTRA,
nunca como receita de venda**. Mesma doutrina do vizinho
`LOGISTICS_REIMBURSEMENT`.

⚠️ **Com uma diferença que só o payload real revelou:** o vizinho lê o crédito de
`revenue_amount`; aqui `revenue_amount` veio **0** e o dinheiro estava em
`settlement_amount`. Espelhar o vizinho ao pé da letra gravaria `adjustment = 0`
e **perderia o valor** — sem erro, sem vermelho, só faltando. É `null ≠ 0` com o
sinal trocado: zero gravado como se fosse fato, quando o fato estava noutro
campo.

**O caso medido (29/08/2026):** coqueteleira de R$ 22,90, pedido de 23/08, item
marcado *"Item com defeito"*; a TikTok creditou **+R$ 7,90** em 29/08.
Documentação oficial do campo `type`:

> *"PLATFORM_REIMBURSEMENT: Reimbursement paid by TikTok Shop for an order
> refunded under TikTok's refund without return policy (the seller is not
> responsible)."*

📌 Três coisas medidas que **não** sabemos explicar, registradas em vez de
preenchidas: por que R$ 7,90 e não R$ 22,90 (a doc não diz como o valor é
calculado); que o pedido continua `COMPLETED` **sem sinal de reembolso** — quem
olha só a lista de pedidos **superestima o que entrou**; e que é **uma** amostra.

### O princípio que a tabela aplica

**A documentação decide o BALDE; o dado decide o SINAL.** O valor e o sinal saem
de `settlement_amount` medido, nunca da nossa expectativa — assim, errar a coluna
"direção esperada" não corrompe número, só aparece numa conferência.

### Por que o fail-closed é permanente, e não um remendo

O campo `type` **não tem `enum` na especificação**: é `"type": "string"` com uma
descrição em prosa. Dos 28 códigos citados, **23 parecem enum e 5 não são** —
vêm como frase, com parênteses de largura dupla (`Violation fee （settlement
fee）`), e são justamente os ligados a **saldo negativo e multa**.

Ou seja: a lista não é contrato de máquina e **nada garante que seja exaustiva**.
Tipo novo vai aparecer de novo. O que muda com a correção proposta é que a recusa
passa a **dizer o que era**, em vez de parar em silêncio — como parou por 11 dias
em 30/08 (ver o changelog de 11/09).

⚠️ Os 5 não-enum ficam **fora** da lista fechada até um aparecer de verdade:
adivinhar a forma de um lançamento de multa é errar dinheiro que o vendedor deve.

## Fontes

## Changelog observado

- **20/09/2026 — 🔴 A CONCILIAÇÃO DO PRIMEIRO CLIENTE REAL NUNCA RODOU, E A CAUSA
  É A COLISÃO DE DUAS REGRAS CERTAS.** Medido no banco enquanto eu punha este doc
  em dia — ou seja, ninguém tinha percebido em oito dias.

  | recurso | janelas | incompletas | erros | código |
  |---|---|---|---|---|
  | `statements` | 1 | **1** | **176** | `TIKTOK_FINANCIAL_ORDER_ASSOCIATION_UNRESOLVED` |
  | `statement_transactions:7683…` | 1 | 1 | 6 | `UNKNOWN_ERROR` |
  | `unsettled` | 1 | 0 | 0 | — 59 linhas gravadas |
  | `payments` | 1 | 0 | 0 | — |

  A janela travada é **11/09 → 12/09**: o dia fechado anterior à conexão. Ela
  nunca completou, e pelo desenho da seleção de janela (a mais antiga incompleta
  primeiro) **o pipeline está preso nela desde a estreia** — não cobriu nenhum
  dia de 12 a 20/09. As 59 transações que existem vieram todas de `unsettled`
  (estimadas); de extrato liquidado, **zero**.

  **A causa, lida no código (`tiktokFinancialLedger.ts:159`):** `upsertLedger`
  recusa gravar transação cujo `order_id` não exista em
  `workspace_channel_orders` daquela conexão. A recusa está certa — dinheiro sem
  o pedido correspondente não entra.

  📌 **Mas a regra de estreia só traz o MÊS VIGENTE.** O extrato de 11/09 liquida
  pedidos criados dias ou semanas antes — muitos anteriores a 01/09, que esta
  conexão **não tem e nunca vai ter**. Toda transação assim derruba a janela
  inteira.

  ⚠️ **ISSO ATINGE TODO VENDEDOR NOVO, e piora quanto mais tarde no mês ele
  conectar.** Não é o caso de um cliente: é o encontro de duas decisões corretas
  que nunca tinham se cruzado, porque até 12/09 não existia conexão nascida pela
  regra de estreia. É a família de *"replicar a garantia, não o mecanismo"* vista
  por dentro: cada regra protege o que promete, e o par produz um terceiro
  comportamento que ninguém escolheu.

  **Não consertei** — o desenho é decisão de produto e tem pelo menos três
  saídas com consequências diferentes: pular a linha órfã com diagnóstico (perde
  dinheiro de pedido antigo, em silêncio se não for registrado), gravar a
  transação com `order_id` nulo (mantém o valor e quebra a associação), ou
  alargar a janela do financeiro para além da estreia (traz o pedido e custa
  chamada). Levado à dona do produto.

  📌 E a lição de método: isto apareceu porque **documentar exigiu medir**. O
  texto teria ficado "cliente conectado, tudo certo" — que era verdade para
  pedidos e falso para dinheiro.

- **12/09/2026 — ✅ O PRIMEIRO VENDEDOR REAL CONECTOU PELO APP PÚBLICO, e a prova
  que a frente perseguia desde agosto finalmente existe.** Loja `Crystal Fancy`
  no workspace do vendedor, `app='publico'`, conectada 02:51 UTC. A estreia puxou
  o mês vigente exato: **1.395 pedidos de 01 a 12/09** (hoje, 1.863, cobertura
  01–20/09).

  📌 **O que isso prova e o que as etapas anteriores não provavam:** que o par do
  público **assina**. A etapa 1 validou as três variáveis dentro do processo e o
  convite respondendo `app: "publico"` — montagem de URL. Mil e trezentos pedidos
  sincronizados exigem chamadas de negócio assinadas. *Validação de credencial
  que não assina nada não prova que a credencial assina* — agora ela assinou.

  **⚠️ E ele só conseguiu na quinta tentativa.** As quatro primeiras falharam, e
  o diagnóstico está registrado abaixo porque a forma da falha vale mais que a
  falha.

  **O que acontecia:** a loja já pertencia a OUTRO workspace do NEXO (a conexão
  da sonda, de 10/08). `assertGlobalTiktokShopOwnership` é fail-closed — uma loja
  pertence a um workspace — e recusou as quatro vezes, **deterministicamente**.
  O sistema agiu certo. A tela é que dizia apenas *"Não foi possível operar esta
  loja TikTok."*, sem causa e sem próximo passo.

  **Como o diagnóstico foi feito, e o que ele custou:** os logs do Fly **não têm
  linha por requisição**, então "o callback chegou a ser chamado?" não tinha
  resposta direta. A única pista durável veio do contador de chamadas criado
  para o alerta da Shopee de 29/08: `/authorization/202309/shops`, 4 chamadas,
  **0 erros** — e esse endpoint tem **um único chamador no repo**, o callback.
  Logo ele rodou, trocou o `auth_code` e assinou, quatro vezes. O que faltava era
  a gravação.

  ⚠️ **Duas hipóteses foram derrubadas por medição antes de virarem trabalho:**
  *propagação* (a 4ª tentativa foi posterior ao e-mail de subscription do
  Partner Center e falhou igual — o que repete idêntico é determinístico) e
  *"copiaram o service_id do custom na variável do público"* (os digests das seis
  secrets no Fly são distintos, e digest compara sem revelar valor).

  📌 E um **quase-falso-alarme** que vale registrar: uma sonda local devolveu
  HTTP 401 `36009005` *"access_token header is invalid"*, que o nosso
  classificador traduz para **"a autorização expirou ou foi revogada. Reconecte
  a loja."** — na véspera de uma reautorização. Não era a loja: era o token
  lido **cifrado** do banco (`enc:v1:`) e passado cru, sem `revealSecret`.
  Produção sincronizava normalmente 8 minutos antes. Fica a dívida: esse
  classificador manda a vendedora reconectar por defeito nosso.

  **A correção sistemática (`2994e0d`), por ordem da dona do produto — causa raiz,
  não contorno, porque *"ficaria inviável passar instrução manual para 50–70
  pessoas"*:**

  1. **registro de tentativa** (`tiktokConexaoTentativa.ts`): oito desfechos
     nomeados, todos registrados, sem token nem PII, workspace abreviado;
  2. **mensagem por desfecho**, incluindo a de posse — *"Loja já conectada ao
     NEXO. Desconecte-a na conta onde ela está antes de conectar aqui."* —
     **sem revelar qual conta** (ler entre inquilinos pode, devolver
     identificador não);
  3. **porta da App Store** reconhecida antes de exigir sessão. Era pior do que
     parecia: quem chegava de lá recebia **JSON cru** (`{"error":"Faça login
     para continuar."}`) depois de concluir o consentimento;
  4. **retry curto** (3 tentativas, 1,5s) só para lista vazia — erro não é
     retentado, e nenhum token órfão é guardado.

  ⚠️ **Uma guarda nova passou VERDE na primeira quebra**, e o achado vale mais
  que a correção: `assert.ok(linha.startsWith(MARCA_DA_TENTATIVA))` lê certo em
  voz alta e não prova nada — esvaziando a constante, toda string começa com
  `""`. **A guarda usava a própria constante como gabarito de si mesma.** É
  *"casar o nome não prova a origem"* na forma de **circularidade**, e só
  apareceu ao rodar a quebra. Ancorada no literal.

  **A sonda saiu do banco no mesmo dia**, por ordem da dona: a linha da loja, a
  linha de sync (o vigia lê `workspace_marketplace_syncs` **sem join** com a
  tabela de lojas — apagar só a loja deixaria uma linha órfã envelhecendo para
  sempre) e, em seguida, os 52.629 registros do canal naquele workspace, para
  que a estreia fosse testada sem resto de dado antigo. Tudo com contagem exata
  medida antes e guarda de rollback; os outros canais dela e os custos
  cadastrados ficaram intactos.

- **11/09/2026 — 🔁 O MODELO MUDOU: NÃO HÁ MIGRAÇÃO, HÁ UM APP SÓ.** Decisão da
  dona do produto, verbatim: *"pode desligar o custom do tiktok, vamos usar a
  aplicacao do tiktok que foi aprovada (public)"*. A loja que estava no custom
  era **sonda** — serviu para medir o que a API entrega, nunca foi produção.

  Consequência em código (`fc59f97`): a autorização passou a ser sempre pelo
  público, a ausência das credenciais virou **recusa** (nunca fallback), e
  `tiktokConfigured()` passou a responder pelo público — é ela que habilita o
  cartão na tela.

  ⚠️ **E a armadilha que isso revelou:** `APP_PADRAO = "custom"` guardava **dois
  significados** que coincidiam até a véspera — *qual app autoriza* e *como ler
  linha gravada sem app*. Com o modelo novo eles ficaram **opostos**. Trocar a
  constante para `"publico"` — a leitura ingênua de "o público é o único app" —
  quebraria a conexão já gravada em silêncio, no refresh seguinte. Viraram duas:
  `APP_DA_AUTORIZACAO` e `APP_DE_LINHA_ANTIGA`. É a família da **coluna que dois
  escritores tocam**, na forma de constante.

  📌 No mesmo dia, o campo `app` deixou de ser opcional em `TiktokShopRef`
  (`1eafda6`): ser opcional foi exatamente o que deixou dois sítios esquecerem-no
  sem o `tsc` reclamar — um deles o **scheduler financeiro, que roda a cada
  ciclo**. Custo medido: 5 erros de compilação, zero colateral. Guarda por grep
  virou segunda linha; a primeira é o compilador.

- **11/09/2026 — 🚦 O APP PÚBLICO FOI PUBLICADO, E A ETAPA 2 ACHOU UM BLOQUEIO QUE
  A ETAPA 1 NÃO PODIA TER VISTO.** O e-mail do Go Live Review chegou (serviço NEXO
  publicado, já no Service Market do Seller Center) e a dona do produto pediu o
  link de reautorização. Antes de mandá-lo, a leitura do caminho revelou que
  **clicar nele quebraria no meio**.

  **O defeito: o app da conexão nunca era PERSISTIDO.** O app viajava dentro do
  `state` assinado do convite e chegava ao callback, que trocava o `auth_code`
  com o par certo — isso a etapa 1 validou e continua verdade. Mas
  `workspace_tiktok_shops` não tinha coluna para ele, e `appDaConexao()` só era
  usado para ler o app de dentro do convite (`tiktokInvite.ts`), nunca para
  gravar. **Do instante seguinte à autorização em diante, ninguém no sistema
  sabia de qual app o token era** — e todo caminho que precisa da credencial caía
  no `APP_PADRAO`, que é o custom:

  | caminho | o que fazia | consequência |
  |---|---|---|
  | `getAuthorizedShops` (`tiktok.ts`) | `tiktokFetch` sem `app` | assina com a chave do custom **logo após** a troca do `auth_code` |
  | `tiktokFinancialApi` | `tiktokFetch` sem `app` | toda conciliação financeira assinada com o custom |
  | `tiktokSync` | monta o ref sem `app` | toda leitura de pedido assinada com o custom |
  | `tiktokStore` (2 sítios) | `refreshAccessToken` sem `app` | renova token do público com o par do custom |

  ⚠️ **É a família do `undefined` em produção que a Amazon já pagou** (`.env` ×
  `workspace_accounts`), e o cabeçalho de `tiktokApps.ts` já a nomeava como o
  motivo de não conviver para sempre. O que faltava não era aviso — era **campo**.

  📌 **E o mais instrutivo: a etapa 1 estava certa no que ela mediu.** Ela validou
  as três `TIKTOK_PUBLIC_*` dentro do processo e o invite respondendo
  `app: "publico"`. Nunca passou uma autorização REAL pelo público, porque não
  havia como — o par do público só tinha sido usado para **montar URL**, nunca
  para **assinar chamada**. Validação de credencial que não assina nada não prova
  que a credencial assina.

  📌 **O modo de falha era benigno por acidente, não por desenho.** Como a quebra
  acontece em `getAuthorizedShops`, ou seja **antes** do `save`, a conexão viva
  não seria sobrescrita: a Ana veria "Autorizado, mas nenhuma loja retornada" e
  continuaria conectada pelo custom. Ninguém perderia o TikTok tentando — mas a
  etapa 2 não andaria, e a causa ficaria parecendo problema do TikTok.

  **A correção (migration `0033` + 5 arquivos):** a coluna `app` passa a existir,
  com `CHECK (app IN ('custom','publico'))` — lista **fechada**, o oposto da lista
  negra que este projeto matou em 31/08/2026 — e `DEFAULT 'custom'`, que é a
  **verdade** da conexão viva (autorizada pelo custom em 10/08/2026), não uma
  conveniência. O callback grava o app que veio do convite; `TiktokShopRef` ganha
  o campo; os 4 endpoints de negócio, os 2 refresh e os 2 sítios que montam ref
  propagam. Guarda: `tests/credencialDoTiktokNaoSeAdivinha`.

  ⚠️ **A guarda enumera, e por isso diz no próprio arquivo o que NÃO cobre:**
  chamador novo de `tiktokFetch`/`refreshAccessToken` e endpoint de negócio novo
  entram na lista no mesmo commit em que nascerem. As 9 quebras foram rodadas
  **uma a uma** e todas ficaram vermelhas no teste certo; rodada contra a árvore
  sem a correção, a guarda acusou exatamente os 5 testes de código.

  📌 **Isto é também o que torna a ETAPA 3 verificável.** Sem a coluna, "a loja
  migrou para o público" não teria como ser provado — só torcido. Com ela,
  aposentar o custom é uma consulta: nenhuma linha com `app='custom'` restando.

  **Duas pegadinhas do próprio portão de migration, pagas aqui:**

  1. `classify()` (`scripts/migration-safety.mjs`) casa a palavra de remoção por
     RegExp **sobre o arquivo inteiro, comentário incluído**. Um
     `DROP CONSTRAINT IF EXISTS` defensivo carimbou a 0033 como **DESTRUCTIVE**,
     e depois o **comentário que explicava a troca** a carimbou de novo. Rótulo
     de risco errado é pior que nenhum: ensina quem autoriza a ignorar o rótulo.
     A idempotência passou a vir de um bloco `DO $$ ... pg_constraint ... $$`, e a
     classificação virou `DDL` puro. É a mesma família de "asserção que proíbe uma
     string tem de olhar o fonte sem comentários" — aqui do lado do classificador.
  2. **O manifesto do plano é write-once** (`savePlan` usa `flag: "wx"`).
     Regerar por cima falha com `EEXIST` e **o arquivo em disco continua sendo o
     antigo** — que foi exatamente o que quase virou report: plano velho, com o
     hash velho e o carimbo DESTRUCTIVE, lido como se fosse o novo. Plano se
     gera em arquivo novo, e o `planHash` se confere.

  ⚠️ **E o apply arrasta a `0032` junto:** ela também está pendente em produção, e
  o cabeçalho dela avisa que os `CREATE INDEX` são **sem `CONCURRENTLY`** (o
  runner aplica em transação), ou seja, tomam lock nas tabelas quentes. A janela
  não é "aditiva e rápida" como a da 0033 sozinha. Além disso, o apply remoto
  **exige worktree limpo** (`migration-safety.mjs`) — com trabalho não commitado
  de outra frente na árvore, ele recusa antes de tocar no banco.

- **04/09/2026 — ⏳ CONVIVÊNCIA DOS DOIS APPS, COM PRAZO DE MORTE DECLARADO.**
  Decisão da dona do produto: **migrar é o destino**, em duas etapas, porque a
  migração real só é possível depois da aprovação do app público.

  **Etapa 1 (feita, v271):** o NEXO passa a conhecer os dois apps. Credenciais
  separadas, `auth_code` trocado com o par certo, e o app viaja dentro do
  `state` **assinado** do convite — o callback não adivinha com qual par trocar,
  porque adivinhar errado devolve token negado. O custom continua atendendo a
  loja conectada, sem uma linha de mudança no caminho dela.

  **Etapa 2 (pendente, `TODO.md` → "TikTok: aposentar o app custom"):**

  > app público **APROVADO** → janela combinada com a dona → a loja **reautoriza**
  > pelo público (convite com `?app=publico`) → o custom é **aposentado** →
  > `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET` e `TIKTOK_SERVICE_ID` **saem do Fly** →
  > `tiktokApps.ts` e o parâmetro `app` que ele espalhou morrem junto.

  ⚠️ **Por que o prazo de morte é escrito e testado:** duas vias de credencial
  já custaram um `undefined` em produção na Amazon. A guarda
  `tests/convivenciaDoTikTokTemPrazo` cobra que a condição continue escrita no
  módulo e que o item exista no `TODO.md` — mas **guarda nenhuma faz a migração
  acontecer**; ela só impede que a convivência vire desenho por inércia.

  ### O fluxo do revisor, e por que ele é por CONVITE

  📌 O revisor autoriza **sem ter conta aqui**. O callback só dispensa sessão e
  cookie quando o `state` é um convite íntegro — a origem é provada pela
  assinatura. Logo **a revisão tem de ser feita por link de convite, não pelo
  botão do painel**. O link sai de `GET /api/tiktok/invite?app=publico`.

  ⚠️ E `?app=publico` **cai no custom sozinho** se as três variáveis do público
  não estiverem no ambiente. É o modo de falha certo: sem credencial, autorizar
  pelo público quebraria no meio do fluxo do vendedor — melhor nem oferecer.

  ### As três variáveis que faltam no Fly

  | variável | de onde copiar |
  |---|---|
  | `TIKTOK_PUBLIC_APP_KEY` | app público → App key (`6kl9m4ajdcvpm`) |
  | `TIKTOK_PUBLIC_APP_SECRET` | app público → App secret |
  | `TIKTOK_PUBLIC_SERVICE_ID` | app público → Service ID da URL de autorização |

  As do custom **não mudam de nome**: renomeá-las seria churn com risco de
  quebrar a conexão viva, em troca de simetria.

- **04/09/2026 — 🗺️ O MAPA DOS QUATRO APPS, e por que confundir os pares de
  credencial quebra a conexão da vendedora.**

  | app | id / key | status | quem atende |
  |---|---|---|---|
  | **custom (Conexão Parceiro)** | — | **On** | **é o que atende a loja HOJE, em produção** |
  | **público `sellercore`** | `7662688850348934932` / `6kl9m4ajdcvpm` | Off, criado 16/07 | **App review EM ANDAMENTO para Brazil (Local)** |
  | draft | — | draft | — |
  | draft | — | draft | — |

  Checklist do público: **3 de 4** — registro, data security e listing aprovados;
  falta a revisão funcional, que já está na fila deles. Escopos integrados:
  Finance Information, Fulfillment, Orders, Products (todos), Promotions,
  Returns, Shop info.

  ⚠️ **OS DOIS APPS TÊM PARES DE CREDENCIAL DIFERENTES, E O NEXO SÓ CONHECE UM.**
  Medido em 04/09/2026 no Fly (`fly secrets list`, só nomes): existem
  `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET` e `TIKTOK_SERVICE_ID` — **um par só**, o
  do custom. `src/lib/tiktok.ts` lê essas três variáveis e não tem noção de
  "qual app": `creds()` devolve sempre a mesma chave.

  📌 **É a mesma família das duas vias de credencial da Amazon** (`.env` da conta
  dona × `workspace_accounts` do app-dash), que já custou um `undefined` em
  produção. A diferença é que lá as duas vias existem no código; aqui a segunda
  **não existe ainda**.

  ### O que quebra na revisão funcional, se nada mudar

  O revisor autoriza usando as credenciais do app **público**. Três coisas, nesta
  ordem, e cada uma sozinha derruba o teste:

  1. **A troca do `auth_code` falha.** O TikTok devolve o código emitido para o
     app público; nosso callback chama `exchangeAuthCode` com a chave do
     **custom**. Par trocado = token negado.
  2. **O `service_id` da URL de autorização é o do custom.** Quem partir da nossa
     tela vai autorizar o app errado.
  3. ⚠️ **E a que ninguém prevê: o callback EXIGE cookie de state e sessão.** Ver
     `src/app/api/tiktok/callback/route.ts` — sem convite, ele passa por
     `withAuthenticatedWorkspace` e exige `state` casando com o cookie
     `sellercore_tiktok_oauth_state`. Um revisor que inicie a autorização **do
     lado do TikTok** não tem nem sessão nem cookie, e cai em *"Autorização
     expirada. Inicie a conexão novamente."* — que para ele lê como app quebrado.

     📌 O caminho que JÁ funciona sem sessão é o **convite** (`exigirCookie:
     false`), desenhado para o vendedor que não tem conta aqui. Se a revisão for
     feita pelo fluxo do TikTok, é por aí — e isso precisa ser decidido antes,
     não descoberto durante.

  ### O que falta, e de quem é

  Três segredos no Fly, que **a dona do produto sobe** (credencial não passa pelo
  chat), com os nomes ainda a definir junto com a decisão de desenho:

  - a **app key** do app público;
  - o **app secret** do app público;
  - o **service_id** do app público.

  ⚠️ **E uma decisão de desenho vem ANTES de subir qualquer chave:** o NEXO passa
  a conhecer os DOIS apps ao mesmo tempo (e escolhe por conexão), ou a produção
  MIGRA para o público quando ele for aprovado? A segunda é mais simples e não
  duplica caminho de credencial — mas **corta a loja que está conectada hoje pelo
  custom**, que teria de reautorizar. Isso é decisão da dona do produto, não do
  código, e não deve ser tomada por inércia no dia da revisão.

  ⚠️ **O redirect do app público precisa ser LIDO no console** — não dá para
  inferir daqui. O que este repo registra (`docs/estado-atual.md`, seção de
  domínios) é `https://nexoaihub.com.br/api/tiktok/callback`, e esse campo é
  **único por app**: o do custom estar certo não diz nada sobre o do público.

- **04/09/2026 — 🟢 AS TRÊS QUALIFICAÇÕES PENDENTES DO PARTNER CENTER FORAM
  APROVADAS EM SETE MINUTOS.** Finance/Accounting às 18:28, Marketing/Analytics &
  Reporting às 18:31, Shipping/OMS às 18:35 — **4 de 4 verdes** com a Catalog,
  que já estava.

  ⚠️ **A CAUSA DAS REPROVAÇÕES DE JULHO E AGOSTO ERA UM CAMPO DIGITADO ERRADO:**
  o CNPJ informado na época divergia do documento. Reenviado com o número atual,
  a aprovação veio automática, sem análise humana perceptível.

  📌 **A lição não é sobre o TikTok, é sobre como tratamos bloqueio de terceiro.**
  Duas qualificações ficaram ~2 meses classificadas como "aguardando aprovação do
  marketplace" — uma espera que não existia. O que reprovava era dado nosso, e o
  motivo estava no painel o tempo todo. É a mesma família do Go Live da Shopee,
  que ficou 26 dias marcado como "under review" aqui porque a checagem dependia
  de alguém abrir o console: **estado de terceiro que só se mede abrindo painel
  envelhece calado, e o silêncio parece bloqueio quando é pendência nossa.**

  **O que isso destrava:** a conciliação financeira real do TikTok deixa de estar
  bloqueada por qualificação. ⚠️ **E "destravado" não é "medido":** a permissão
  existir não diz o que a API entrega nem quando. Antes de desenhar qualquer
  conciliação, medir na loja conectada o que `finance` responde de verdade —
  `settlements`, `statements`, `payments` — e com que atraso. A regra da dona do
  produto vale aqui inteira: cada API tem seu próprio calendário de dados.
  Lembrando que `payments` tinha erro conhecido (entrada de 27/08 abaixo) — se
  ele parar de falhar agora, a causa era permissão e isso precisa ser registrado;
  se continuar, era forma do dado e continua sendo.

- **27/08/2026 — o repasse (`payments`) tem forma de dinheiro DIFERENTE, e nunca
  foi lido uma vez sequer.**
  O contador de erro novo acusou **18 falhas seguidas** no recurso `payments`,
  todas como `UNKNOWN_ERROR`, com `rows_seen = 0` desde 27/08 04:35. Sondado na
  conta real em `GET /finance/202309/payments`:

  | O que | Suposto | Observado |
  |---|---|---|
  | `amount` | escalar (`"151.49"`) | **objeto `{currency, value}`** |
  | Moeda | campo `currency` na linha | **não existe** na linha nem no envelope — vive **dentro** do `amount` |
  | `expected_time` | presente | **não existe** nesta resposta |
  | `statement_id` | presente | **não existe** nesta resposta |

  `requiredCurrency(raw.currency)` lançava em toda linha, então nenhuma leitura
  de repasse jamais completou. Chaves reais confirmadas: `amount`,
  `bank_account`, `create_time`, `exchange_rate`, `id`, `paid_time`,
  `payment_amount_before_exchange`, `reserve_amount`, `settlement_amount`,
  `status`. Todos os 7 repasses da janela de 7 dias vieram com `status: "PAID"`,
  `exchange_rate: "1"` e `reserve_amount` zerado.

  📌 **Terceira vez que o mesmo defeito aparece** (moeda no envelope em
  `statement_transactions`, `fee_tax_amount` inexistente, agora dinheiro como
  objeto): a lição não é sobre um campo, é sobre **medir a forma do payload antes
  de escrever o parser**. Consequência para o produto: sem `expected_time`, o
  painel de saldo **não tem como prometer data de liberação** por esta via — o
  que estiver sem data continua sem data, e não vira estimativa.

- **26/08/2026 — `sort_field` também é obrigatório no detalhe do extrato, e o
  payload não é o que o parser supunha.**
  Ao destravar o checkpoint financeiro congelado desde 13/08, três achados na
  mesma chamada `GET /finance/202501/statements/{statement_id}/statement_transactions`:

  | O que | Observado |
  |---|---|
  | `sort_field` | **Obrigatório**, e o único valor aceito é `order_create_time`. Sondado na conta real: sem o campo, com `create_time` e com `statement_time` → **`36009004`**; com `order_create_time` → 200 com 39 transações. |
  | Moeda | Vem **no envelope** da resposta (`currency` ao lado de `transactions`), **não** em cada transação. Nenhuma das 39 linhas tinha `currency`, e `requiredCurrency` derrubava todas. |
  | Tarifa | O campo é **`fee_tax_amount`**. `fee_and_tax_amount` era suposição e nunca existiu: o valor saía `null` em silêncio, o que é pior que lançar — o ledger gravaria a linha sem a maior despesa do pedido. |

  Isto estende a entrada de 13/08: `sort_field` obrigatório com um único valor
  aceito não vale só para os três endpoints de lista, vale também para o detalhe
  do extrato. Chaves confirmadas na resposta real: `adjustment_amount`,
  `adjustment_id`, `adjustment_order_id`, `fee_tax_amount`, `fee_tax_breakdown`,
  `id`, `order_create_time`, `order_id`, `revenue_amount`, `revenue_breakdown`,
  `settlement_amount`, `shipping_cost_amount`, `shipping_cost_breakdown`,
  `supplementary_component`, `type`. Tipos observados: `ORDER` (37) e
  `LOGISTICS_REIMBURSEMENT` (2) — os dois já na allowlist.

  ⚠️ **Lição que não é da API, é nossa: `advanceCheckpoint` mandava 15
  parâmetros para uma função de 14.** A `financial_checkpoint_advance` da
  `0005_workspace_financial_ledger.sql` declara 14 argumentos; o SQL pedia
  `$1..$15`. O Postgres nem executava — respondia **42883**
  (*"function ... does not exist"*), porque a assinatura procurada tinha um
  argumento a mais. Ou seja, **nenhum advance jamais rodou desde que a 0005
  entrou**, e `workspace_financial_transactions` estava em zero linhas.
  Só apareceu depois de destravar o `36009004`: um defeito escondia o outro.
  Corrigido, com teste que compara os placeholders do SQL com os parâmetros
  declarados na migration.

  ⚠️ **Por que ninguém viu por 14 dias:** as colunas
  `error_count`/`last_error_code`/`last_error_at` existem desde a 0005 e **nada
  nunca escrevia nelas** — toda exceção entre `claimCheckpoint` e
  `advanceCheckpoint` subia sem contador. O checkpoint ficava indistinguível de
  um que ainda não tinha rodado: página 0, 0/0 linhas, zero erro, enquanto o
  cron renovava o lease a cada ciclo (o `fencing_token` chegou a **3.070**).
  Agora a falha é contada, o lease é devolvido e há backoff por recurso.
  Evidência do destravamento: a janela 12→13/08 fechou com 39 transações
  gravadas e `completed_at` preenchido nos dois checkpoints.

- **13/08/2026 — as três chamadas financeiras nunca funcionaram: `36009004`.**
  O cron do TikTok respondia `{"ok":true}` e o GitHub Actions marcava `success`,
  mas o corpo trazia `status:"failed"` com
  *"A TikTok Shop recusou a solicitação (code 36009004)"*. Conferido contra a OAS
  oficial (`references/oas/paths/finance.json`), o motivo é o mesmo nas três:

  | Chamada | Enviava | OAS exige |
  |---|---|---|
  | `/finance/202309/statements` | `start_time`, `end_time` | `statement_time_ge`/`_lt` + `sort_field: statement_time` |
  | `/finance/202605/payments` (**versão inexistente**) | `start_time`, `end_time` | `/finance/202309/payments` · `create_time_ge`/`_lt` + `sort_field: create_time` |
  | `/finance/202507/orders/unsettled` | `start_time`, `end_time` | `search_time_ge`/`_lt` + `sort_field: order_create_time` |

  **`start_time`/`end_time` não existem em nenhuma das três**, e `sort_field` é
  obrigatório nas três, com um único valor aceito por endpoint. Ou seja, a
  conciliação financeira nunca completou uma chamada — o que o
  `estado-atual.md` descrevia como "parcial e retomável" era, na verdade, zero.
  Corrigido, com `tests/tiktokFinanceContract.test.mjs` guardando path, janela,
  `sort_field` e faixa de `page_size` contra a OAS.

  ⚠️ **O cron mascara falha:** `/api/cron/tiktok-sync` devolve HTTP 200 e
  `ok:true` mesmo quando todas as lojas falham. O status HTTP precisa refletir o
  resultado, senão o Actions continua verde sobre um sync quebrado.

  ⚠️ **`*/5 * * * *` não é a cadência real.** As execuções observadas em 13/08
  saíram às 09:52, 10:47, 11:34, 12:28, 13:57, 14:58, 15:59 e 17:01 — intervalos
  de 47 a 89 minutos. O GitHub Actions estrangula agendamentos de alta
  frequência; a frescura real do dado é horária, não de 5 minutos.

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
