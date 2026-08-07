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
| `GET /api/v2/payment/get_escrow_detail` | detalhe de escrow por pedido | **fonte das taxas reais**: comissão, taxa de serviço, taxa de transação, frete real. Só disponível após o pedido pago/concluído ⚠️ |

## Mapeamento canônico (ver [`canonical-schema.md`](./canonical-schema.md))

- **Status** Shopee → canônico (⚠️ confirmar enum): `UNPAID→pending`,
  `READY_TO_SHIP`/`PROCESSED→paid`, `SHIPPED→shipped`, `COMPLETED→delivered`,
  `CANCELLED→cancelled`.
- **Fees** (do escrow) → taxonomia canônica: `commission_fee→commission`,
  `service_fee`/`transaction_fee→commission` (ou `payment`),
  `actual_shipping_fee→shipping_seller`/`fulfillment`. Preservar o código original em
  `provider_fee_code`.

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
- ✅ UI: `src/app/shopee/page.tsx` + `components/ShopeeWorkspace.tsx`
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

**Fase 3 — o que falta para dados reais (não é código):** Go Live no console →
partner key de produção → `SHOPEE_*` no Render → loja autoriza. Só então o
mapeamento de campos encontra a realidade; revisar `shopeeCanonical.ts` nesse dia.

> Pendente também: entrada da Shopee no dashboard consolidado (`app/page.tsx`),
> que só faz sentido quando houver loja conectada com dados.

**Sem mudança (agnósticos):** schema canônico, `canonicalStore.ts`, `canonical.ts`,
`integrationStore.ts`, `secrets.ts` — reaproveitados com `provider: "shopee"`.

**Assets:** conferir `public/brands/shopee.svg` e `public/brands/app/shopee.svg`
(os caminhos já estão referenciados em `MarketplaceIcon.tsx`).

## Changelog observado (mais recente primeiro)

Mesma convenção dos docs da Amazon e do ML: mudanças de comportamento da API observadas
na prática entram aqui, com data. Enquanto o canal não for implementado, a lista fica
vazia — ao implementar, re-validar tudo marcado com ⚠️ e registrar o que divergir.

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
  - Produtos: `item_status` usa `NORMAL`/`UNLIST`/`BANNED`/`DELETED`, e o estoque
    vem aninhado em `stock_info_v2.summary_info.total_available_stock`.
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
