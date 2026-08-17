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
  duas vezes. Falta ML, Shopee e TikTok.
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
  quanto valor está esperando, no formato que o Seller Central usa. Falta ML,
  Shopee e TikTok.
- [ ] **Todos: ausência em período conciliado = zero explicado**, não "—" eterno.
  ✅ Amazon (15/08): `somaTipos()` em `src/app/amazon/amazonFinancialCards.ts`
  devolve `0` quando o período está conciliado e `null` quando não está — três
  cards ficavam mudos para sempre. Falta ML, Shopee e TikTok.
- [ ] **Todos: categorizar tarifa por padrão, não por lista de nomes exatos.**
  Nome fora da lista vira R$ 0,00 numa conta que paga. O total é a autoridade.
  ✅ Amazon (15/08): trocado por regex (`/^FBA/i`, `/advertis|productads/i`,
  `/commission|referralfee/i`) em `amazonFinancialCards.ts`. Falta ML, Shopee e
  TikTok.
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
- [ ] **Saldo e retenção — TikTok.** `/finance/202507/orders/unsettled` devolve
  `sum_est_settlement_amount` e `estimated_settlement` ("Delivered + 3 days").
  Depende de o ledger financeiro encher — destravado hoje pela correção do
  `payment_status`, falta confirmar que os dados chegaram.
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
- [ ] **Replicar para os outros canais.** Amazon, Shopee e TikTok também cobram
  frete e também declaram envio — mesma garantia, campos diferentes.

## Limpeza (depois que o overview SQL do ML estiver estável no Render)

- [ ] Remover o código dormente de snapshots/materializer do ML
  (`mercadoLivreOverviewCache.ts`, `mercadoLivreOverviewMaterializer.ts`,
  chamadas a `invalidateMercadoLivreOverviewSnapshots` e o caminho de payloads
  do `loadMercadoLivreSource` que só o comparador usou)
- [ ] Dropar as tabelas `workspace_marketplace_overview_snapshots` e
  `workspace_marketplace_materialization_leases` (migração própria)
- [ ] Tirar o DDL legado do `ensureSchema` (mover para migração versionada,
  como já foi feito com as tabelas canônicas)

## Infra / performance

- [ ] **Aproximar app e banco**: Render está em Oregon e o Supabase em
  São Paulo (~180ms por query). Opções: mover o serviço do Render, ou testar o
  deploy Vercel que já está configurado para `gru1` (São Paulo) com os crons no
  `vercel.json`
- [ ] Pinger externo em `/api/health` a cada 5–10 min para a instância free do
  Render não hibernar (pode ser no mesmo cron-job.org)

## UI (opcional, sem urgência)

- [ ] Dark mode — todas as cores já são tokens OKLCH no `globals.css`; é
  redefinir as variáveis do `:root` sob `prefers-color-scheme: dark`
- [ ] Sidebar: decidir se as descrições dos itens de navegação ficam, saem ou
  aparecem só no hover

## Segurança

- [ ] Rotacionar `MELI_CLIENT_SECRET` e `OAUTH_CLIENT_SECRET` (foram expostos
  em uma conversa de suporte; trocar nos painéis do Mercado Livre/Amazon e
  atualizar no Render)
