# TODO — SellerCore

Pendências combinadas da migração multicanal e melhorias. Atualize os checkboxes
conforme for concluindo.

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

- [ ] **Agendar o cron da Amazon.** "Cron" é só um despertador: um serviço
  externo chama uma URL do app de tempos em tempos, e essa chamada empurra a
  sincronização — sem depender de alguém abrir o dashboard.
  1. Se ainda não existir, crie a variável `CRON_SECRET` no ambiente do Render
     (Environment → Add) com um valor longo e aleatório. O cron do Mercado
     Livre usa a mesma variável.
  2. Num serviço gratuito de agendamento (ex.: [cron-job.org](https://cron-job.org)),
     crie um job a cada **10 minutos** chamando:
     `GET https://SEU-APP.onrender.com/api/cron/amazon-sync`
     com o header `Authorization: Bearer <valor do CRON_SECRET>`.
  3. Confira que o job do Mercado Livre também está agendado (mesmo formato,
     URL `/api/cron/mercado-livre-sync`, a cada 5 minutos).
  4. Teste: a resposta deve ser `{"ok":true,...}`. Sem o header correto, 401.

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
  somá-lo às deduções desconta duas vezes.
- [x] **Todos: não misturar bases.** Auditado em 15/08/2026. Achado no **ML**:
  `revenue30d` soma aprovadas **+ canceladas** (proposital, é o "Vendas brutas"
  do painel), mas `paidOrders` conta só aprovadas — o ticket saía inflado em
  3,8% (conta 1191100170) e 4,7% (648425194), medido sobre dados reais. Passou a
  usar `approvedRevenue / paidOrders`, a mesma base do "Aprovadas" exibido ao
  lado. Shopee e TikTok já usavam base única. Travado por
  `tests/ticketMesmaBase.test.mjs`.
- [ ] **Todos: pendência diz de quem é a espera.** "Aguardando dados" parece
  falha nossa; separar "o canal ainda não informou" de "falta você cadastrar".
- [ ] **Todos: ausência em período conciliado = zero explicado**, não "—" eterno.
- [ ] **Todos: categorizar tarifa por padrão, não por lista de nomes exatos.**
  Nome fora da lista vira R$ 0,00 numa conta que paga. O total é a autoridade.
- [ ] **Saldo e retenção nos outros canais.** Na Amazon saiu de
  `financialEventGroups` + `transactionStatus`/`maturityDate`. Investigar o
  equivalente em ML (`/users/{id}/mercadopago_account/balance`?), Shopee
  (escrow) e TikTok, e montar o mesmo bloco "o que tenho hoje".

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
