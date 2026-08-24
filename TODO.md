# TODO — NEXO

Pendências combinadas da migração multicanal e melhorias. Atualize os checkboxes
conforme for concluindo.

> Itens marcados **"todos"** já estão feitos na **Amazon** (foi onde a auditoria
> rodou) e faltam nos demais canais. Continuam abertos até os quatro fecharem.

> Para **onde cada frente parou** (Shopee, Amazon, contas de teste) e o passo
> exato de retomada, veja `docs/estado-atual.md`. Este arquivo é a lista de
> tarefas; aquele é a foto da situação.

## Ação manual (precisa de você)

- [ ] **Reconectar a Amazon** — as duas contas estão com o refresh token
  revogado (`invalid_grant`, confirmado em 06/08). Preferir **self-authorization**
  pelo Solution Provider Portal em vez do OAuth atual; motivo e caminho em
  `docs/conexoes-que-expiram.md`.
- [x] **Shopee: submeter o Go Live** — submetido em 07/08. Aprovação,
  credenciais de produção, autorização de loja real e payload Live seguem
  **BLOCKED** por dependência externa (`docs/estado-atual.md`).
- [ ] **Shopee: confirmar IP Whitelist no ambiente Live** depois da aprovação;
  sem ela os dados do comprador vêm mascarados e não sai NF-e.

- [x] ~~**Agendar o cron da Amazon**~~ — **já está feito e este item estava
  desatualizado.** O `.github/workflows/cron.yml` chama os **quatro** canais
  (`amazon-sync`, `mercado-livre-sync`, `shopee-sync`, `tiktok-sync`) a cada 5 min,
  autenticado por `CRON_SECRET` (ADR-003). Não é preciso serviço externo de
  agendamento. Verificado em 16/08/2026.

## Fase 5 — Amazon no modelo canônico (em andamento)

- [x] Ingestão de pedidos (headers via `getOrders`, itens conciliados em background)
- [x] Cron para avançar histórico e itens sem visitas ao dashboard
- [x] **Fees via Finances API** — comissão, tarifa FBA, frete e estornos viram
  fees canônicas por pedido, conciliadas em background junto do sync
- [x] **Re-base na Transactions API validado ao vivo.** Painel financeiro e
  lucro re-baseados na Transactions API 2024-06-19
  (`getFinanceSummaryFromTransactions`) — a Finances v0 devolvia valores
  zerados. Parser reconstruído sobre a estrutura real (Sales/Expenses →
  ProductCharges/AmazonFees), validado contra dados reais: receita R$ 104,7k,
  taxas R$ 44,9k (FBA + comissão…), líquido R$ 57,4k, consistência interna ~1%.
- [ ] **COGS zerado para a Amazon** — os SKUs vendidos não têm custo cadastrado
  em Produtos (2922 unidades sem custo), então o lucro aparece = repasse
  líquido (sem descontar produto). Cadastrar custos dos SKUs Amazon, ou
  investigar se é descasamento de chave de custo.
- [x] **Taxas por pedido** ("Resultado por venda") re-baseadas na Transactions
  API, rateadas por receita entre os itens.
- [x] **Opção A: faturamento unificado na Transactions API.** Faturamento,
  pedidos, unidades, série diária e COGS agora vêm todos das transações (data
  de postagem, por competência), mesma fonte do lucro — receita e lucro
  reconciliam. Rótulo do lucro vira "Repasse líquido / antes do custo" quando
  faltam custos, nos dois canais. `/api/sales` não é mais usado no dashboard/
  central (segue servindo `/api/orders`).
- [ ] Conciliação de **fees canônicas da Amazon** (`getOrderFinancialEvents`,
  v0) precisa migrar para a Transactions API — fase 5 do canônico. O endpoint
  `/api/finances` (v0, órfão) pode ser removido.
- [ ] Limpeza opcional: `getSalesVelocity`/`getDailySales` (v0) não alimentam
  mais o dashboard; revisar se ainda valem para o radar de estoque.
- [ ] **Trocar as rotas do dashboard Amazon** (`/api/orders`, `/api/sales`,
  `/api/profit`, `/api/top-products`) para ler do SQL canônico — é o que
  torna a Amazon rápida como o Mercado Livre ficou. Antes, validar os números
  do canônico contra o dashboard atual (mesma conferência feita no ML)
- [x] TikTok Shop: pedidos, produtos e financeiro implementados no canônico,
  com sync/cron, Dashboard, Financeiro e módulos filtráveis. QA autenticado
  segue **BLOCKED** por ownership duplicado e pela migration 0005 não aplicada.
- [x] **Shopee: implementação local** (OAuth, dashboard/módulos multi-loja,
  ingestão canônica fail-closed, sweep retomável, cron, settings por loja e
  remoção local). Go Live e payload real seguem **BLOCKED**; ao conectar,
  revisar `shopeeCanonical.ts` contra a resposta Live.

## Marca NEXO (pedido em 15/08/2026)

- [x] **Assinatura NEXO.** A 1a versao criava a CENA do video (parede escura
  atras das letras) e virou um retangulo preto colado numa pagina clara — lia como
  banner, nao como marca. Refeita sem fundo proprio (`NexoWordmark.tsx` + bloco
  "Assinatura NEXO" no `globals.css`) e vista renderizada na tela de login.
- [ ] **Landing do NEXO** — esboço navegável em `/landing`. Estrutura do dub.co,
  efeitos do midday.ai. Mapa em `docs/landing-nexo.md` (hero em 3 versoes,
  manifesto, contadores, riscos).
  - [x] Vitrine animada da tela do produto, com cursor navegando (`VitrineAnimada.tsx`)
  - [x] Animação da conciliação financeira (`AnimacaoConciliacao.tsx`)
  - [ ] **Animação da pesquisa de mercado da Amazon** — pedida, não começada
  - [ ] **Animação do aviso de dia de repasse** — pedida, não começada
  - [ ] **Fidelidade à tela real:** faltam a borda superior colorida dos cards, as
    seções da sidebar (PAINÉIS/CATÁLOGO/FERRAMENTAS) e a faixa
    VENDAS/UNIDADES/TICKET/ROI
  - [ ] Contadores: conferir o número de "tarifas auditadas" antes de publicar —
    número em landing é promessa
  - ⚠️ **Não há depoimento de cliente e não se inventa um.** A parede de prova
    social do dub não tem equivalente honesto ainda.
  - 📌 **Ao usar um repositório de referência, leia o código antes de codar.** Três
    iterações foram perdidas construindo a partir de screenshot. E o dub **não tem**
    a landing aberta no repo (só o dashboard); o midday tem, em `apps/website`.
- [ ] **Renomear SellerCore -> NEXO no produto.** Nao e substituir tudo: a URL
  `sellercore.onrender.com` esta cadastrada como Redirect URI na Shopee e no
  TikTok, que tem allowlist. Trocar a URL **quebra o OAuth** dos dois. Precisa de
  plano: onde e so texto, onde e dominio, e a ordem de atualizar cada allowlist.
  Ja trocado: botao do login ("Entrar no NEXO").

## Onboarding visual no produto (referência observada em 24/08/2026)

- [x] **Criar onboarding guiado sobre a interface real.** A referência final
  escolhida em 24/08/2026 foi o tour contextual do PEEC: fundo atenuado, alvo
  recortado, tooltip escuro com seta, progresso, “Pular” e um CTA por etapa.
  - Roteiro próprio do NEXO em três passos: canais, leitura contextual e resumo
    financeiro; nenhum asset ou texto proprietário foi reutilizado.
  - A versão vista é persistida em `localStorage` e o tour pode ser reaberto por
    “Como funciona” na topbar.
  - O tour espera o aviso de avaliação terminar, prende o foco, fecha por `Esc`,
    respeita redução de movimento e usa alvos semânticos na interface.
  - Novidades de versão continuam sendo uma ocasião separada e ainda não foram
    implementadas.

## Paridade financeira entre canais (pedido em 15/08/2026)

A auditoria dos números da Amazon achou sete defeitos. Todos foram corrigidos
**só na Amazon**; a Ana pediu para adaptar aos demais canais — lembrando que
adaptar **não é copiar código**: cada API entrega a informação de um jeito.

- [x] **ML: alíquota `null` ≠ `0`.** Feito em 15/08/2026. `mercadoLivreTaxRate` faz
  `Number(metadata.taxRate ?? 0)` — quem nunca configurou é tratado como
  **isento**, e o painel exibe "Imposto R$ 0,00" afirmando um fato falso.
  Espelhar o desenho da Amazon/Shopee (`null` quando não configurado; `0` só
  quando declarado). Toca 4 pontos: `mercadoLivre.ts`,
  `mercadoLivreOverviewCanonical.ts`, `mercadoLivreAbc.ts` e a rota
  `/api/integrations/mercado-livre/settings` (hoje devolve `0`).
  A aritmética deve seguir com `?? 0` para **não mudar o lucro já exibido** —
  o que muda é a tela dizer "sem imposto" em vez de afirmar zero.
- [x] **Todos os canais: faturamento = o que o comprador pagou.** Auditado em
  15/08/2026: ML (`unit_price`, nunca `full_unit_price`), Shopee
  (`model_discounted_price ?? model_original_price`) e TikTok
  (`sale_price ?? original_price`) **já estavam corretos** — o defeito era só do
  cálculo ao vivo da Amazon. Travado por `tests/faturamentoValorPago.test.mjs`.
  - [ ] **Ressalva:** Shopee e TikTok caem para o preço de tabela quando o campo
    de preço com desconto vem ausente. Não observado na prática, e trocar o
    fallback por "desconhecido" apagaria a receita do período inteiro — decisão
    consciente de manter, registrada aqui para não virar surpresa.
- [ ] **Todos: desconto/cupom não é custo** — se já vier abatido da receita,
  somá-lo às deduções desconta duas vezes. ✅ Amazon (15/08): a cascata parte do
  **preço de tabela**, mostra "Cupons e promoções" como dedução e fecha num
  subtotal que **é** o card de faturamento. Assim o cupom aparece sem descontar
  duas vezes.
  ✅ TikTok (23/08): **não havia dupla contagem** — a receita já era o valor pago
  (`sale_price ?? original_price`) e nenhum campo de desconto entrava em dedução.
  O que faltava era a cascata. `descontoDaLinha` não confia na prosa da doc: exige
  que **a própria linha reconcilie ao centavo**
  (`original_price − seller_discount − platform_discount = sale_price`); não
  reconciliou, faltou campo ou veio negativo ⇒ `null`, sem cascata. Uma unidade
  não provada contamina o grupo (somar só as provadas afirmaria cupom menor que o
  concedido). Provado, vira `listPrice`/`promotionDiscount` e
  `coverage.revenueCascade`, onde `listRevenue − discounts = revenue` **por
  construção**. Nunca vira `CanonicalFee`.
  Falta ML e Shopee.
- [x] **Todos: não misturar bases.** Auditado em 15/08/2026. Achado no **ML**:
  `revenue30d` soma aprovadas **+ canceladas** (proposital, é o "Vendas brutas"
  do painel), mas `paidOrders` conta só aprovadas — o ticket saía inflado em
  3,8% (conta 1191100170) e 4,7% (648425194), medido sobre dados reais. Passou a
  usar `approvedRevenue / paidOrders`, a mesma base do "Aprovadas" exibido ao
  lado. Shopee e TikTok já usavam base única. Travado por
  `tests/ticketMesmaBase.test.mjs`.
- [ ] **Todos: pendência diz de quem é a espera.** "Aguardando dados" parece
  falha nossa; separar "o canal ainda não informou" de "falta você cadastrar".
  ✅ Amazon (15/08): a tela diz quantos pedidos a Amazon ainda não confirmou e
  quanto valor está esperando, no formato que o Seller Central usa.
  ✅ TikTok (23/08): o painel separa **três** donos, não dois —
  `vendedora` (custo de SKU e alíquota; vem primeiro e sempre com link),
  `canal` (a TikTok não postou o extrato, ou fechou sem informar o componente;
  **sem botão**, de propósito) e `conciliacao` (a janela ainda não fechou do
  NOSSO lado). Travado por `tests/tiktokPendenciaDono.test.mjs`, que varre todo
  texto gerado e o fonte contra `/parcial|incomplet/i`.
  - 📌 **O terceiro dono não estava no plano e é o achado da rodada.** O card de
    faturamento dizia "a TikTok ainda não devolveu todos os pedidos do período".
    Era falso: `periodCovered` vem de `checkpointsCoverPeriod`, que começa com
    `if (to > closedFinancialBoundary(now)) return false` — ou seja, **toda janela
    que termina hoje nasce não-coberta**, "Hoje"/"7 dias"/"30 dias" incluídos. A
    tela acusava o marketplace todo santo dia por uma janela nossa. Ao replicar
    para ML e Shopee, conferir se a mesma frase existe lá.
  Falta ML e Shopee.
- [ ] **Todos: ausência em período conciliado = zero explicado**, não "—" eterno.
  ✅ Amazon (15/08): `somaTipos()` em `src/app/amazon/amazonFinancialCards.ts`
  devolve `0` quando o período está conciliado e `null` quando não está — três
  cards ficavam mudos para sempre.
  ✅ TikTok (23/08): em `applyTiktokLedgerAuthority`
  (`tiktokFinancialV2.ts`), no nível de **período**. O zero só vale com
  `covered && finalTransactions > 0` — conciliado **sem nenhuma transação
  liquidada** continua `null`, porque não há extrato afirmando nada. Vale só para
  `fees` e `sellerShipping`, as categorias que o extrato discrimina, e o que
  virou zero fica em `coverage.settledZeros` para a tela explicar.
  ⚠️ **Única mudança de valor na tela desta rodada:** em período conciliado com
  transação liquidada e sem comissão/frete do vendedor no ledger, "Taxas" e
  "Frete do vendedor" saem de "—" para R$ 0,00. Falta ML e Shopee.
- [ ] **Todos: categorizar tarifa por padrão, não por lista de nomes exatos.**
  Nome fora da lista vira R$ 0,00 numa conta que paga. O total é a autoridade.
  ✅ Amazon (15/08): trocado por regex (`/^FBA/i`, `/advertis|productads/i`,
  `/commission|referralfee/i`) em `amazonFinancialCards.ts`.
  ✅ TikTok (23/08): `tiktokFeeDecomposition` em `tiktokCanonical.ts`.
  - 📌 **O TikTok NÃO é o caso da Amazon, e a primeira versão errou por isso.**
    Na Amazon `fees` é um total independente e o breakdown só o reparte:
    categorizar errado move dinheiro de card, **não muda o total**. No TikTok
    não existe total independente — as taxas **são** a soma dos campos. Somar um
    `*_amount` desconhecido não é miscategorizar, é mexer no dinheiro, e o campo
    real `fee_per_item_sold_amount` (regra do mercado BR) casa com `/fee/` e
    somaria **em cima** do próprio pai `fee_and_tax_amount`.
  - A saída: categorização por padrão continua, mas quem decide é a **aritmética
    do próprio pedido**. Agregado comprovado (`fee_and_tax_amount` +
    `shipping_cost_amount`) sempre entra; qualquer outro campo só conta se
    `revenue_amount + Σ(componentes assinados) = settlement_amount` fechar ao
    centavo — e aí o sinal sai da identidade, então subsídio comprovado continua
    crédito em vez de virar custo. Não fechou (ou não veio `settlement_amount`)
    ⇒ vale só o agregado e o campo vira **pendência nomeada** (`field`, `amount`
    cru, `reason`), na mesma disciplina de `tiktokUnmappedOrderStatuses`.
  - ⚠️ **Limite honesto:** a pendência tem nome e valor, mas hoje só os testes a
    leem. Levar até `last_error`/tela exige `tiktokSync.ts` — fica na lista de
    observações abaixo.
  Falta ML e Shopee.
- [x] **Saldo e retenção — Mercado Livre.** Feito em 15–16/08/2026 via API do
  Mercado Pago (`/v1/payments/search` com `range=money_release_date`), que abre
  com o MESMO token do ML. Leitura limitada a 6 páginas e declarada parcial
  quando trunca.
  - ⚠️ **`net_received_amount` NÃO serve** — a API devolve valor inconsistente
    com a própria tela do MP. Este TODO já mandou usá-lo; era errado. O líquido é
    **derivado**: `transaction_amount − tarifas − frete do vendedor`, onde as
    tarifas vêm de `charges_details` **excluindo** as de `type: "shipping"` (senão
    o frete desconta duas vezes). Conferido contra a tela do MP:
    `36,90 − 4,24 − 6,65 = 26,01` = "Total a receber". Ver
    `src/lib/integrations/mercadoPagoBalance.ts`.
- [x] **Saldo e retenção — TikTok.** Feito em 23/08/2026. Retido vem das
  transações `unsettled` (o valor que o próprio TikTok estima repassar); a data
  de liberação vem de `expected_time` em `/finance/202309/payments` — a **única**
  data que a API prova. Venda retida sem extrato aparece com valor e **sem data**,
  com a contagem de quantas estão nesse estado; nada de previsão inventada.
  `src/lib/integrations/tiktokSaldo.ts` (módulo puro), rota
  `/api/integrations/tiktok/saldo` e `TikTokSaldo.tsx`.
  - ⚠️ `settlement_state` é tratado por `switch` exaustivo com `default: never`:
    **estorno não conta como venda** e um estado novo estoura em vez de virar
    venda em silêncio. Foi um defeito real achado na revisão.
  - A decomposição do repasse (ads, imposto retido, reembolso) segue **não
    mapeada**: `settlement_amount` chega como número único e a semântica não
    está provada.
- [ ] **Saldo e retenção — Shopee.** Bloqueado: sem Go Live não há loja real.
- [ ] **ML: usar `charges_details` no lucro.** O MP informa a tarifa
  DISCRIMINADA (`ml_sale_fee`, `mp_processing_fee`, `shp_fulfillment`); hoje
  estimamos a partir de `sale_fee` e exibimos "Tarifa de venda" como bloco único.
  Discriminar aproxima o ML do padrão de tarifa por categoria já aplicado na
  Amazon. ⚠️ **Não usar `net_received_amount`** — ver a ressalva no item de saldo
  acima.

## Pedidos a revisar — ML (entregue em 16/08/2026)

Auditoria de frete: compara o que o Mercado Pago **cobrou** (`shp_fulfillment`)
com o que o envio **declara**. Divergência não vira acusação — vira lista para ela
decidir. Ideia veio de um print de concorrente (Hunter Hub) que ela mandou.

- [x] **Implementado** em `src/lib/integrations/mercadoLivreAuditoria.ts`.
- [x] **Corrigido o falso positivo que quase virou reclamação.** A primeira versão
  acusou **8 divergências, todas falsas**: comparava o `shp_fulfillment` **bruto**
  contra `senders[].cost` (**líquido**). O esperado é a **soma das duas pontas** —
  `custoVendedor + custoComprador`. Confirmado pelo print dela:
  `16,99 (comprador) − 23,64 = −6,65`.
  📌 **Lição:** antes de apresentar divergência financeira ao usuário, conferir
  se os dois lados da comparação estão na mesma base. Acusar cobrança errada sem
  isso queima confiança de um jeito que não se recupera.
- [x] **TikTok** — feito em 23/08/2026. `src/lib/integrations/tiktokAuditoria.ts`,
  rota `/api/integrations/tiktok/auditoria` e `/tiktok/auditoria`.
  Compara o mesmo campo (`shipping_cost_amount`) lido por dois caminhos
  independentes: o extrato **por pedido** (fee `shipping_seller`) contra o feed de
  **statements** (`workspace_financial_transactions.seller_shipping`).
  📌 A lição do ML foi aplicada ANTES da primeira linha: cada lado carrega uma
  `base` explícita e a comparação só acontece quando as bases batem. Bases
  diferentes viram pendência com motivo nomeado, **nunca** divergência.
  ⚠️ `payment.shipping_fee` (frete do comprador) **não** entra na subtração: o OAS
  diz que `shipping_cost_amount` já é a soma do `shipping_cost_breakdown`, que
  **já inclui** `customer_paid_shipping_fee_amount`. Subtrair descontaria a parte
  do comprador duas vezes — o falso positivo do ML com o sinal invertido. Há
  teste de regressão travando isso.
- [ ] **Replicar para Amazon e Shopee.** Também cobram frete e também declaram
  envio — mesma garantia, campos diferentes.

## Observações da rodada do TikTok (23/08/2026) — achadas, NÃO corrigidas

Levantadas pelos agentes enquanto fechavam o bloco C. Nenhuma foi tocada: ou é
outro canal (o diff da rodada não podia sair do TikTok), ou é decisão de produto.

- [x] ~~**`brDate()` erra em um dia toda data de liberação do Mercado Livre.**~~
  **CORRIGIDO em 23/08** no ponto único (`src/lib/datetime.ts`): data no formato
  `YYYY-MM-DD` passa a ser ancorada em `-03:00` antes do parse. Travado por
  `tests/brDateSomenteData.test.mjs`. ⚠️ A data ficava um dia **atrasada**, não
  adiantada — o exemplo abaixo estava certo, a palavra é que não. Diagnóstico
  original preservado:
  `MercadoLivreSaldo.tsx` passa um dia já calculado em São Paulo (`YYYY-MM-DD`)
  por `brDate()`, que faz `new Date("2026-09-13")` — meia-noite **UTC** — e
  reconverte para `America/Sao_Paulo`, devolvendo **12/09/2026**. Confirmado
  rodando. Todas as datas de liberação do ML estão um dia adiantadas na tela.
  O componente do TikTok não replicou o padrão (usa um `diaBr` local, com o
  motivo comentado).
- [ ] **`Math.abs()` transforma crédito em débito nos dois lados do frete.**
  `canonicalTiktokFees` e `normalizeTransaction` normalizam o sinal com
  `Math.abs`. Quando o frete líquido é **positivo** (subsídio da plataforma, ou
  frete do comprador acima da tarifa real), o crédito vira custo e o lucro do
  canal erra no **dobro** do valor. Inofensivo na auditoria de frete (os dois
  lados sofrem a mesma transformação), mas não no lucro. Vale um probe quando a
  loja BR liquidar o primeiro pedido com subsídio.
- [ ] **`shipping_cost_breakdown` é descartado na ingestão** — não está em
  `TiktokStatement` nem na allowlist do ledger. Sem ele **não dá para auditar o
  frete de verdade**: a tarifa real da transportadora
  (`actual_shipping_fee_amount`) nunca chega ao banco. Capturá-lo é decisão de
  produto, não ajuste.
- [ ] **`tiktokSync.ts` ainda fixa dois nomes exatos de tarifa** em dois pontos:
  o purge de fees placeholder (`provider_fee_code IN ('fee_and_tax_amount',
  'shipping_cost_amount')`) e `financialEvidence.fees`
  (`Object.hasOwn(statement,"fee_and_tax_amount")`). O caminho autoritativo
  (período/ledger) já categoriza por padrão; o caminho **por pedido**
  (`orderProfitability`, `tiktokModules`) continua na lista exata.
- [ ] **`TikTokModulePage.tsx` ainda diz "Extrato ainda incompleto"** — mesmo
  defeito de pendência sem dono que foi corrigido no dashboard, nos módulos
  monitor/catálogo/financeiro. Pela regra "correção vale para TODOS", ML e Shopee
  provavelmente têm texto equivalente.
- [ ] **Pendência de tarifa não chega à tela.** `tiktokFeeDecomposition` já
  devolve o campo desconhecido com nome, valor cru e motivo, mas só os testes
  leem. Levar até `last_error`/tela exige `tiktokSync.ts`, fora do escopo da
  rodada. Não usar `throw`: campo novo benigno pararia a fila financeira em
  retry infinito.
- [ ] **Regra BR não separável:** o OAS traz `fee_per_item_sold_amount`
  ("Applicable only for the Brazil market") dentro de `fee_tax_breakdown`. Está
  somado dentro de `fee_and_tax_amount`, então não se perde — mas não é
  discriminável hoje.

## Limpeza (depois que o overview SQL do ML estiver estável em produção)

- [ ] Remover o código dormente de snapshots/materializer do ML
  (`mercadoLivreOverviewCache.ts`, `mercadoLivreOverviewMaterializer.ts`,
  chamadas a `invalidateMercadoLivreOverviewSnapshots` e o caminho de payloads
  do `loadMercadoLivreSource` que só o comparador usou)
- [ ] Dropar as tabelas `workspace_marketplace_overview_snapshots` e
  `workspace_marketplace_materialization_leases` (migração própria)
- [ ] Tirar o DDL legado do `ensureSchema` (mover para migração versionada,
  como já foi feito com as tabelas canônicas)

## Infra / performance

- [x] ~~**Aproximar app e banco**~~ — RESOLVIDO pela migração para o Fly em São
  Paulo (região `gru`, ADR-015). Era o motivo de existir da migração: o Render
  estava em Oregon e o Supabase em São Paulo, ~180ms por query.
- [x] ~~Pinger externo em `/api/health`~~ — desnecessário no Fly:
  `auto_stop_machines = false` e `min_machines_running = 1` no `fly.toml`.

## Explicações dentro do produto (pedido em 23/08/2026)

Referência que ela mandou: painel de monitoramento de marca com **ⓘ em cada
métrica** (*"hover any metric to learn what it measures"*) e uma trilha de
primeiros passos (*"Start here · 0/4 — get your first win in 5 minutes"*).

O NEXO tem o problema oposto do dashboard genérico: as métricas dele são
**específicas e contraintuitivas**, e hoje ninguém explica. Exemplos que já
custaram conversa nesta semana:

- "Pedidos feitos" ≠ "Faturamento" — um é preço de tabela, o outro é o que o
  comprador pagou. Ela perguntou **três vezes** até entender que a diferença era
  cupom.
- "Taxas Amazon" de R$ 6,12 que não é tarifa de pedido, é `ProductAdsPayment`.
- Saldo retido × disponível × data de liberação.
- Cobertura financeira: por que um pedido aparece sem tarifa.

- [ ] **ⓘ por métrica, com o texto explicando de onde o número vem.** O padrão
  já foi definido por ela em 23/08 para a diferença Pedidos × Faturamento:
  *"só coloque uma bolinha i, sabe? de informação, aí quando a pessoa passa por
  cima do i, aparece a frase"*. Falta virar componente único e cobrir o resto.
- [ ] **Um dicionário só, não texto solto na tela.** Mesmo conceito tem que dar
  a mesma explicação em qualquer canal — é a mesma regra de
  `src/lib/nomeDaTarifa.ts` para nome de tarifa.
- [ ] **Explicação é por canal quando a regra é do canal.** Faturamento no ML
  segue a regra de aprovadas+canceladas sem frete; na Amazon é
  `ItemPrice − PromotionDiscount`. O texto tem que dizer a regra **daquele**
  marketplace, não uma frase genérica.
- [ ] **Trilha de primeiros passos** — o equivalente ao "Start here · 0/4": o
  que a pessoa precisa fazer para o painel ficar útil (conectar loja, cadastrar
  custo, configurar imposto). ⚠️ Cada passo aponta o que falta **com número**,
  nunca um adjetivo que se desculpe.
- [ ] **Nada de tour modal que bloqueia a tela.** A referência usa balão preso à
  métrica, e é o certo: a pessoa aprende olhando o próprio número, não uma
  apresentação.

📌 Isto é irmão da frente de cobrança: quem não entende a métrica não confia no
número, e quem não confia não assina.

## UI (opcional, sem urgência)

- [ ] Dark mode — todas as cores já são tokens OKLCH no `globals.css`; é
  redefinir as variáveis do `:root` sob `prefers-color-scheme: dark`
- [ ] Sidebar: decidir se as descrições dos itens de navegação ficam, saem ou
  aparecem só no hover

## Segurança

- [ ] Rotacionar `MELI_CLIENT_SECRET` e `OAUTH_CLIENT_SECRET` (foram expostos
  em uma conversa de suporte; trocar nos painéis do Mercado Livre/Amazon e
  atualizar com `fly secrets set`)
