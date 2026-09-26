# Estado atual — onde cada frente parou

**Última atualização: 26/09/2026** (produção em **v318/`83deb7b`**, de 22/09,
conferida no `/api/health`). O que a semana 21–26/09 fechou: **a leva Amazon de
21/09** — webhook por SQS no ar (ADR-023: consumidor, processador e
auto-assinatura no connect, v310–v312), **ADR-030** (o cálculo do NEXO é o
número; o rótulo "estimativa" saiu e a face mostra procedência), pedido pendente
**valorizado pela nossa base em tempo real** e margem **real** (contribuição) no
Top de produtos; **a frente AbacatePay CONCLUÍDA em 22/09** — `/`, `/termos` e
`/privacidade` públicas com razão social/CNPJ, provadas sem sessão em produção
(a causa exata da reprovação do cadastro); **as quatro decisões de produto de
23/09** — gateway é a **AbacatePay** com fluxo pagamento-primeiro + senha
temporária por e-mail, convite do TikTok **morre**, alíquota vira passo
**obrigatório** pós-conexão, multi-CNPJ é **pago**; e **o portão de CI estreou
verde em 20/09** (run 35520489720 — a suíte completa + testes de integração com
Postgres descartável rodam em todo push). 🔴 Segue aberto: **o ledger do TikTok
travado** (seção 4 — decisão pendente da Ana) e as janelas **0034+0035**
(commitadas, não aplicadas). Regras operacionais vivas: **conferência e ação
nunca no mesmo comando encadeado** (`docs/fly-io.md` §"quarta mordida") e
**fetch-antes-do-checkout em todo deploy** — `git rev-list --count
HEAD..origin/main` = 0, regra de 22/09, quando uma main local atrasada rebaixou
produção por 15 minutos. Leia isto antes de continuar qualquer frente; o
"porquê" das decisões está nos docs de cada área e nos ADRs.

Este doc responde três perguntas: **o que está pronto**, **o que está no meio do
caminho** (com o passo exato para retomar) e **o que está bloqueado por
terceiros**. Quando uma frente terminar, mova a linha para "pronto" e apague o
detalhe operacional — este arquivo não é histórico, é foto do presente.

> **Cada seção diz quando foi verificada pela última vez.** Data velha não
> significa "errado"; significa **não reconferido**. Antes de agir sobre uma
> afirmação com data antiga, confirme — foi assim que três erros seguidos
> entraram nesta semana.

> **O produto se chama NEXO — e só NEXO.** Decisão dela em 27/08/2026: o nome antigo
> **não pode mais ser citado** em texto que uma pessoa lê (tela, doc novo, mensagem,
> commit); era nome de POC e ficou para trás. O identificador continua vivo **apenas**
> onde quebra se mexer — URL cadastrada em allowlist de OAuth, contas `.test` do banco,
> nomes de variável/arquivo/tabela e o `service_id` do app do TikTok. Ver `AGENTS.md`
> antes de renomear qualquer coisa.

---

## 🌐 Domínio e OAuth — atualizado em 20/08/2026

O produto vive em **`https://nexoaihub.com.br`** (Fly.io, São Paulo — ADR-015). O
`sellercore.onrender.com` foi **suspenso pelo Render** em 19/08 e devolve 503; deixou de
ser referência viva, mas **permanece nas allowlists** onde ainda está cadastrado.

Estado dos cadastros de OAuth/webhook por portal (todos feitos em 19–20/08):

| Portal | Campo | Valor novo | Antigo |
|---|---|---|---|
| Amazon Solution Provider (SP-API) | URI de login | `https://nexoaihub.com.br/api/auth/login` | substituído |
| Amazon Solution Provider (SP-API) | Redirect OAuth | `https://nexoaihub.com.br/api/auth/callback` | mantido ao lado |
| Mercado Livre DevCenter | Redirect URI | `https://nexoaihub.com.br/api/integrations/mercado-livre/callback` | mantido ao lado |
| Mercado Livre DevCenter | Webhook de notificação | `https://nexoaihub.com.br/api/webhooks/mercado-livre` | substituído (campo único) |
| TikTok Partner Center | Redirect URL | `https://nexoaihub.com.br/api/tiktok/callback` | substituído (campo único) |
| Shopee Open Platform | Test/Live Redirect **Domain** | `https://nexoaihub.com.br` (⚠️ só domínio — URL completa é recusada) | substituído |
| Shopee Open Platform | Live Version URL do produto | `https://nexoaihub.com.br` | substituído — o antigo apontava para o host suspenso, reprovação certa no Go Live |

📌 O webhook do ML já está recebendo no domínio novo (2.406 eventos nas 12h seguintes).

## Canais

| Canal | Situação | Verificado |
|---|---|---|
| **Amazon** | Em produção, vendendo, com Ads no ar. Tokens das duas contas **OK** (medido 01/09 — a "revogação" era medição velha; ver seção 2). Tarifa estimada com origem nomeada na tela; pendentes com comissão+FBA. 🟢 **Dashboard no v3 desde 13/09** (ver seção Front). 🟢 **Solicitação de avaliação VALIDADA EM PRODUÇÃO em 13/09**: 10 envios reais (1 unitário + 9 em lote no clips), zero recusas, zero 429 — janela é pós-ENTREGA e a prova de aceite é a ação sumir da releitura (changelog do `api-amazon-sp-api.md`). Feature aprovada pela Ana, no backlog aguardando o front + a janela da **0034** (registro durável; até lá os envios feitos estão em `G:/sc-temp/solicitacoes-de-avaliacao.md`). **Saldo ganhou as cobranças**: `cobrancasFechadas` no `/api/amazon/balance` (extrato que fecha devendo; ~R$ 148 na conta real), e cobrança deixou de se passar por transferência em `ultimaTransferencia`. **Repasses na 991**: cadeias antigas resolvidas em 08/09; padrão confirmado (26/09) — transferência disparada em fim de semana falha e o redisparo em dia útil anda; a cadeia absorve, é benigno. 🟢 **Leva de 21/09 no ar (v310–v312)**: webhook por **SQS** (ADR-023 — consumidor, processador que AGE e auto-assinatura de `ORDER_CHANGE` no connect, escala para N vendedores), **ADR-030** (o número sem rótulo de estimativa; procedência na face), pedido pendente **valorizado pela nossa base em tempo real** (preço do anúncio via Listings Items — pendente parou de valer R$ 0,00), margem **real** por contribuição no Top de produtos, e o contador "N pedidos apurados" saiu — **só da Amazon**, por ordem dela (20/09); continua nos outros três. | 26/09 |
| **Mercado Livre** | Em produção e sincronizando. Faturamento validado ao centavo contra o painel do ML. Saldo/liberação e auditoria de frete no ar. 🟢 **Dashboard no v3** (Caminho do Dinheiro) com o pente-fino de 13/09 fechado: margem do Top 8 por agregado SQL do período inteiro (o teto de 1000 pedidos não a mata mais — a conta real passou de 1000/janela e o defeito era esse), payload da troca de período em ~28 KB, ritmo estável. Detalhes e medições no changelog do `api-mercado-livre.md`. | 20/09 |
| **Shopee** | Implementação local completa (OAuth, dashboard multi-loja, ingestão fail-closed/retomável, settings por loja, remoção local). **Go Live: APROVADO — os dois apps estão ONLINE no console, conferido em 02/09/2026** com a dona do produto na tela. O "under review de 07/08" ficou 26 dias desatualizado aqui porque a checagem dependia de alguém abrir o console (a extensão do navegador não tem permissão para `open.shopee.com`) e ninguém abriu. ⚠️ Estado de terceiro que só se mede abrindo painel envelhece calado — este ficou quase um mês afirmando bloqueio que não existia mais. IP de saída do Fly já medido (ver seção 5). 🟢 **PONTO SEGURO ATUAL: `f50e3b9` (v270)** — validado pela dona do produto em **04/09/2026**, verbatim: *"valores batendo"*. A conciliação foi feita na **janela FECHADA de 03/09** contra o Mercado Turbo, e bate ao centavo: faturamento **R$ 9.541,89**, tarifas **R$ 3.140,30**, canceladas **R$ 1.017,58 em 28 pedidos**, **308 unidades** — idênticos. Única diferença: **3 SKUs sem custo cadastrado (R$ 28,72)**, que é cadastro dela e já aparece apontado na tela. E Hoje/7/15/30 dias sem travessão, com a conta fechando em todas. ⚠️ **NOTA DE CRITÉRIO, para não virar falso alarme depois:** a contagem de "vendas" do Mercado Turbo difere da nossa porque ele conta **pacote** e nós contamos **pedido** — com unidades e centavos idênticos. **Isso não é divergência**, é vocabulário diferente para o mesmo fato; quem comparar contagem de vendas sem saber disso vai abrir defeito que não existe. ⚠️ **E janela fechada por DATA não é número congelado:** às 15h de 04/09 esta mesma janela dava R$ 9.516,99 em 275 pedidos, e às 16h dava R$ 9.541,89 em 276 — um pendente virou pago no meio. A data do pedido não muda, o **status** ainda anda. Comparar duas leituras da mesma janela em horários diferentes e chamar a diferença de defeito é o erro que esta nota evita. **Ponto seguro ANTERIOR, mantido no histórico: `95ad8e9` (v253, 02/09/2026)** — cadeia validada contra o Mercado Turbo (faturamento ao centavo, unidades exatas, widget e lista coerentes, push em tempo real, aba persistente). Qualquer regressão futura da Shopee se compara contra o **v270**; os commits-chave dos dois estados estão no changelog de `docs/api-shopee.md`. **Push LIGADO em 02/09/2026:** endpoint `/api/webhooks/shopee` no ar com assinatura verificada (`url|corpo` com a Live Push Partner Key), Push ON e status *Normal* no console, 29 tipos ligados. Primeiro push real confirmado às 19:12Z — dois pedidos entraram pelo caminho canônico, latência mediana pedido → push de **10,8 s** contra 3–15 min da varredura. A varredura **continua** como rede de segurança, e o push carimba `last_push_at` (0031) para não mascarar varredura parada. Detalhe da assinatura e as duas armadilhas em `docs/api-shopee.md` → Changelog. **Em medição:** cobertura do push por 7 dias (`scripts/medir-cobertura-do-push-shopee.mjs`) — o gate de ≥99% que a dona do produto pediu antes de relaxar a cadência da varredura. | 07/08 |
| **TikTok Shop** | OAuth, sync paginado, cron, modelo canônico, overview, Dashboard, Financeiro e ledger de extratos **implementados**. 🟢 **APP PÚBLICO É O ÚNICO CAMINHO, E HÁ CLIENTE REAL CONECTADO POR ELE** (12/09/2026): loja no workspace do vendedor com `app='publico'`, estreia puxou o mês vigente e o sync de pedidos está saudável — **2.461 pedidos, cobertura 01–26/09, último ciclo há minutos** (medido 26/09). O público está provado nos dois caminhos que faltavam: **assina** chamada de negócio (12/09) e **renova** token (26/09 — vencia no dia e está válido até 03/10). 🔴 **MAS A CONCILIAÇÃO FINANCEIRA DESSE CLIENTE NUNCA RODOU** — o ledger está travado na primeira janela (11→12/09) desde a estreia, **299 erros** (eram 176 em 20/09), `TIKTOK_FINANCIAL_ORDER_ASSOCIATION_UNRESOLVED`; de extrato liquidado, **zero linhas**, 14 dias. ⚠️ **Não é caso isolado: atinge todo vendedor novo** — ver seção 4; decisão de desenho pendente com a Ana. 🟢 **Não há mais migração custom→público**: resta custom só na conexão de demonstração, e o desligamento espera decisão sobre ela. 🪦 **O link de convite MORREU por decisão dela (23/09)** — era método de teste; a remoção do código (`invite/route.ts`, `tiktokInvite.ts`, ramo sem cookie do callback) fica para a próxima leva de superfície. ⚠️ Reembolso da plataforma DECIDIDO (entra como ajuste, valor de `settlement_amount`); **a tabela dos ~23 tipos do extrato aguarda o OK da dona do produto**. | 26/09 |

## 🎨 Front — onde a frente parou (bloco da Vitrine, 26/09/2026)

**Em produção (carimbo `83deb7bd18e6`, de 22/09):** ML e Amazon no esqueleto v3,
com o canal Amazon fechado inteiro — dashboard, monitor, radar e anúncios;
catálogo e custo por SKU mudaram de casa para `/amazon/anuncios`, e as rotas
antigas redirecionam. As páginas legais públicas estão no ar e **conferidas em
26/09 sem sessão**: `/`, `/termos` e `/privacidade` respondem **200** com razão
social, CNPJ, contato e os dois links — a reprovação da AbacatePay era de
**visibilidade**, e essa causa está resolvida.

**Na main, ainda não em produção:** os commits de 23 a 26/09 são de documentação
(playbook, espelho do mobile, ledger do TikTok, esta leva de arquitetura) — o
push desta leva fecha a distância com o `origin/main`.

**Em branch, vivo mas parado:** `redesign/design-system-indigo` (`4974d1e`,
11/09) arquiva a frente do design system índigo para não se perder na faxina —
não está em produção e é retomável. `io/abc-recorte-por-pedido` (`14f38a3`,
12/09) é WIP da Delta, fora da leva até melhorar nos três períodos.
`redesign/identidade-peec` e `redesign/nexo-peec-completo` estão **atrás** da main
(zero commits à frente) — são histórico, não trabalho pendente.

**O próximo passo exato do front**, em ordem:

1. **A cobrança que fecha devendo** — *"A Amazon vai descontar R$ X no próximo
   fechamento"*. O dado existe desde `69fb42f` (`cobrancasFechadas`, em
   `src/lib/amazonBalance.ts`) e **nenhuma tela o lê**; o lugar natural é dentro
   da etapa "Cai na conta", que hoje só fala do que entra. Espera canvas dela.
2. **As levas de Shopee e TikTok no v3**, cada uma por ordem dela.
3. **A limpeza da rota `/api/sync-estado`**, órfã desde que a faixa de sync saiu
   das telas em 13/09 — decisão registrada: remover junto com `saturacaoDoSync` e
   o teste, na próxima leva de superfície (junto com o convite do TikTok, morto
   em 23/09).
4. **Pendente de decisão dela, não minha:** o veto (ou não) dos cinco removidos
   reversíveis da leva da Amazon, com o preço da volta já escrito em
   `docs/amazon-v3-leva-12-09.md`.

📌 O contrato visual (medidas do `globals.css`) e as três famílias de superfície
de tela agora estão documentados em
[`architecture/overview.md`](./architecture/overview.md) §5 — regra dela de
10/09: *"todas as novas telas precisam seguir o padrão do dash principal"*. O
espelho do mobile foi corrigido em `e122ed0` (duas regras que ele afirmava
erradas: a marca de estimativa morreu no ADR-030; o contador de apuração saiu
só da Amazon).

---

## O que mudou desde 23/08 (para quem leu a versão anterior)

1. **O app público do TikTok foi submetido** (27/08) — App review + Listing review. É a
   virada da frente: o que falta agora é espera, não trabalho nosso. Seção 4.
2. **Monetização saiu do zero** — Stripe em sandbox ponta a ponta, migration `0013`
   aplicada e webhook respondendo em produção. Seção nova, "Monetização".
3. **Recuperação de senha e primeiro acesso no ar** (v107+), com SMTP próprio. Sem isso
   ninguém que não fosse a Ana conseguia entrar sozinho.
4. **Lucro, margem e ROI do TikTok destravaram** quando o extrato liquidado cobre o
   período — era o único canal que nunca mostrava lucro.
5. **Cron ficou honesto**: conexões de demonstração saíram do ciclo nos quatro canais, os
   passos `insights` e `warm` da Amazon voltaram a rodar, e o agendador passou a
   **alarmar `ok:false`** em vez de logar HTTP 200 sobre passo quebrado.
6. **"SellerCore" não pode mais ser citado** em texto que uma pessoa lê — ver o aviso no
   topo.
7. **Sync imediato pós-conexão nos quatro canais** (27/08, v118→v124) — conectar uma
   loja dispara a importação na hora, com os 30 dias recentes primeiro. Ver a seção 12.

## Em andamento — retomar aqui

### 1. Paridade financeira entre canais — **a frente mais quente**

*Verificado em 24/08.*

A auditoria dos números da Amazon (pedida por ela em 15/08: *"para pra avaliar todos os
valores que aparecem na amazon e garanta que todos estão certos"*) achou **sete
defeitos**. Todos foram corrigidos **só na Amazon**. A instrução dela foi explícita:

> *"todos os marketplaces precisam ser adaptados pq justamente o que já sabemos, cada api
> fornece sua própria informação"*

⚠️ **Adaptar não é copiar código.** Cada API entrega a informação de um jeito diferente;
replicar é reimplementar a mesma *garantia* com os campos que aquele canal oferece.

**Os sete defeitos e o princípio de cada um:**

| # | Defeito | Princípio que ficou |
|---|---|---|
| 1 | Faturamento usava preço de tabela | **Faturamento é o que o comprador pagou** (`ItemPrice − PromotionDiscount`) |
| 2 | Cupom somado às deduções sobre receita já líquida | **Não descontar duas vezes** — cascata parte do bruto e fecha num subtotal igual ao card |
| 3 | Ticket médio de uma base, faturamento de outra | **Não misturar bases** — mesmo numerador e denominador do que está exibido ao lado |
| 4 | Tarifa categorizada por lista de nomes chutados | **Categorizar por padrão** (regex), não por nome exato — o total é a autoridade |
| 5 | Tarifa ausente em período conciliado exibia "—" para sempre | **Ausência em período conciliado é zero explicado**, não desconhecido |
| 6 | "Aguardando dados" parecia falha nossa | **A pendência diz de quem é a espera** — o canal ou você |
| 7 | "Impostos retidos" (mecanismo US/EU) num painel BR | **Não exibir card que não se aplica ao mercado** |

**O que já foi replicado** (ver `TODO.md` → "Paridade financeira" para o checklist vivo):

- ✅ Faturamento = valor pago — auditado nos 4 canais; ML, Shopee e TikTok **já estavam
  corretos**. Travado por `tests/faturamentoValorPago.test.mjs`.
- ✅ Não misturar bases — achado e corrigido no ML (ticket inflava 3,8% e 4,7% em contas
  reais). Travado por `tests/ticketMesmaBase.test.mjs`.
- ✅ Alíquota `null` ≠ `0` no ML — "não configurado" era tratado como isento.

**Aberto:** cupom não é custo (todos), pendência com dono (todos), ausência conciliada =
zero (todos), categorizar tarifa por padrão (todos), saldo/retenção para TikTok e Shopee.

### 2. Amazon: autorização OK nas duas contas — a "revogação" era medição velha

*Verificado em 01/09/2026 — refresh retorna HTTP 200 nas duas contas e a SP-API responde.*

A afirmação anterior ("revogada nas duas contas", medida em 06/08) ficou meses neste
doc e induziu **três recomendações erradas de "renovar OAuth"**. Os tokens nunca
caíram. Lição registrada: **estado de credencial se mede na hora, não se lembra** —
data velha aqui embaixo significa "reconferir", nunca "fato".

⚠️ **Contas:** usar `AO62LVXJMX3AA` (dela). A `A15NQMF7A6J1Y0` é **do colega** e o
acesso autorizado é **somente leitura**.

#### Tarifa estimada até a liquidação ([ADR-027](adr/ADR-027-tarifa-estimada-ate-a-liquidacao.md)) — implementada, 01/09/2026

O lucro da Amazon cobre o **faturamento inteiro** (pendentes + confirmados), com a
tarifa estimada quando a oficial ainda não chegou. Ordem de preferência das fontes,
implementada em `amazonTarifaEstimada.ts`: **observada > tabela > api**.

- **observada** — a tarifa que a Amazon de fato cobrou naquele ASIN (valor absoluto
  por unidade; não precisa de preço). Cobre a maioria dos ASINs com histórico.
- **tabela** — a regra publicada pela Amazon, versionada em
  [`tarifas-amazon-br.md`](./tarifas-amazon-br.md) (comissão por categoria +
  logística FBA por preço/peso) e no código (`amazonTabelaDeComissao.ts`).
  Mapeamento categoria→percentual **explícito**: não-mapeado devolve `null`, nunca
  cai em "demais 15%". Valor prospectivo: dispara em ASIN sem histórico.
- **api** — Product Fees API, quando houver token da conta.

Na liquidação, a tarifa **oficial substitui** a estimativa por `fee_type` (view
`workspace_channel_order_fees_efetivas`; `superseded_at` marca a substituída) — é o
diferencial sobre o Gestor Seller, que estima e nunca reconcilia. Na tela, toda
estimativa é **marcada com a procedência** na própria linha.

**Fato medido que limita a tabela:** pedido `Pending` da Amazon vem **sem
`ItemPrice`** (chave ausente do payload; o preço só publica no shipment). Comissão é
percentual sobre preço → linha pendente sem preço não ganha estimativa por tabela.
Peça em andamento: usar o **preço do anúncio** (nosso catálogo) como base marcada
para pendentes — é o que o Gestor Seller faz.

**Pendência aberta desde 07/08 — lucro da Amazon pelo canônico.** `/api/sales` e
`/api/order-profitability` já caem no modelo canônico quando o workspace não tem nenhuma
conta SP-API (ver [`architecture/read-and-cache.md`](./architecture/read-and-cache.md)).
`/api/profit` **não** — ele carrega `refunds`, `reimbursements` e `netProceeds`, que só a
Transactions API tem. Preencher com zero violaria `null ≠ 0`; fazer direito exige tornar
esses campos nuláveis e ensinar o dashboard e o monitor a mostrar "—" em vez de R$ 0,00.

### 3. Amazon Ads — **no ar desde 12/08**

*Verificado em 16/08, 22h36.*

Seis campanhas ativas: automática + manual para martelo, clips e protetor. Estrutura de
**1 automática + 1 manual com grupo Exata e grupo Frase por produto**.

Acompanhamento diário fica na skill `.claude/skills/monitorar-ads/SKILL.md` (fora do
versionamento — `.claude` está no `.gitignore`). Ela guarda cada leitura datada, as
mudanças aplicadas e os limiares de decisão. **Leia antes de opinar sobre campanha.**

Duas regras que já custaram erro:

- **`get_page_text` lê o DOM, não recarrega.** Sempre `navigate` antes de ler, senão a
  "leitura de agora" é uma foto de horas atrás.
- **O dia fechado não fecha venda.** Atribuição de Ads é pela **data do clique**, com
  janela de 7 dias — a linha de hoje continua ganhando compras por uma semana. Fecha
  impressão, clique, CTR e gasto; não fecha compra e venda.
- **A API entrega o dia corrente** (medido 25/08/2026: relatório de hoje voltou com
  R$ 17,53 e 17 cliques em 105s). O gasto de hoje é real e já saiu do bolso — só
  continua **crescendo** até a meia-noite. Por isso a tela mostra o valor com o aviso
  "Hoje ainda está somando", e deixa ACOS/TACOS em `—` até a atribuição entrar.

#### Ads API: **APROVADA em 25/08/2026** — e o gasto já está na tela

12 dias depois do pedido, na 3ª candidatura (a que corrigiu o site declarado, que
apontava para um endereço em 503). Conta que autoriza: `consultor.masterseller@gmail.com`,
dona do perfil LWA cadastrado na Amazon como `SellerCore Ads` (nome de registro, não do
produto — não renomear). Token cifrado em `workspace_settings`,
`profileId 3728826838894301`.

**O que entrou no produto no mesmo dia** — decisão registrada no
[ADR-025](adr/ADR-025-anuncio-entra-no-lucro.md):

| | |
|---|---|
| `migrations/0012` | `workspace_ad_metrics` (dia × campanha) e `workspace_ad_reports`, **aplicadas em produção** |
| `src/lib/integrations/amazonAdsSync.ts` | pedir / colher / resumir — ingestão assíncrona |
| Cron | passo `adsSync` em `/api/cron/amazon-sync`, colhendo antes de pedir |
| Dashboard | cards **Ads**, **ACOS** e **TACOS**; o **Lucro passou a descontar anúncio** |

🔴 **O número da conta virou negativo, e é o número certo.** Em 30 dias:
R$ 295,65 de lucro contra R$ 312,98 de anúncio → **−R$ 17,33**, margem de 58,7%
para **−2,9%**, TACOS de **52,9%**. O painel vinha exibindo margem alta numa
operação no vermelho porque o maior custo variável não entrava na conta.

⚠️ **Os outros três canais ainda não descontam anúncio.** ML (Product Ads),
TikTok (GMV Max) e Shopee (AdsManager) têm API — a tabela já nasceu com coluna
`provider` para o segundo canal ser um `INSERT`, não uma tabela nova. Até lá, a
comparação de margem entre canais é injusta com a Amazon. Ver `TODO.md`.

⚠️ **Visualizações/sessões não funcionam no produto.** `/amazon/desempenho` existe e o
código está pronto, mas `GET_SALES_AND_TRAFFIC_REPORT` responde **403**: exige o papel
**Brand Analytics**, que o app não tem e que **não aparece como caixa de seleção** —
precisa ser pedido nominalmente em caso de suporte (candidatura travada; ver "Bloqueado").

### 4. TikTok Shop — onde a frente parou (bloco da Batida, 26/09/2026)

*Medido em 26/09/2026 contra o código de `main` e o banco de produção. Detalhe
completo em `docs/tiktok-shop-integracao.md` (commit `5268c41`); a mecânica da
estreia, do ledger fail-closed e do travamento está em
[`architecture/sync-engine.md`](./architecture/sync-engine.md) §1.1 e §5.*

**Em produção e saudável:**

- app **público** publicado no Service Market, **único** caminho de autorização
  (`service_id` 7662688850348934932);
- **um cliente real conectado** desde 12/09 (`app='publico'`): **2.461 pedidos**,
  cobertura 01–26/09, último ciclo há minutos;
- o público está provado nos dois caminhos que a etapa 1 não cobria: **assina**
  chamada de negócio (12/09) e **renova** token (26/09 — o `access_token`
  vencia hoje e está válido até 03/10);
- toda tentativa de conexão deixa rastro no log (`[tiktok-conexao]`), com
  mensagem própria por desfecho — inclusive a de posse, que diz *"Loja já
  conectada ao NEXO. Desconecte-a na conta onde ela está antes de conectar
  aqui."*, sem revelar qual conta. O **Service Market não é porta de entrada**
  (decisão de 11/09): autorização iniciada lá chega sem o nosso `state` e o
  callback manda voltar pelo botão.

**🔴 O que bloqueia:**

- a **conciliação financeira desse cliente nunca rodou** — 14 dias travada na
  primeira janela (11→12/09), 299 erros, zero linha de extrato liquidado.
  **Decisão de desenho pendente com a Ana** — as três saídas, com o que cada uma
  preserva e custa, estão no
  [`sync-engine.md`](./architecture/sync-engine.md#5-tiktok-o-ledger-fail-closed-e-o-travamento-conhecido);
- a **tabela dos ~23 tipos** do extrato aguarda o OK dela. O
  `PLATFORM_REIMBURSEMENT` já está decidido: entra como **ajuste**, com o valor
  vindo de `settlement_amount` (não de `revenue_amount`, que veio zerado no caso
  medido). O campo `type` **não tem `enum` na especificação**, então o
  fail-closed é permanente, não remendo;
- o **destino da conexão de demonstração** — é o que falta para o custom sair: a
  condição de desligamento é uma consulta (`nenhuma linha com app='custom'`) e
  hoje resta só ela.

**Decidido, com remoção de código pendente (próxima leva de superfície):**

- **link de convite morto** (23/09): o revisor não precisa mais (app publicado) e
  vendedor sem conta não existe mais (pagamento primeiro + senha temporária).
  `invite/route.ts`, `tiktokInvite.ts` e o ramo sem cookie do callback seguem no
  repo;
- **custom desligado**: as três `TIKTOK_APP_*` saem do Fly (passo da dona, sem
  trava técnica) e depois o código do custom sai. ⚠️ Nunca as envs antes do
  destino da demo: sem credencial, conexão marcada `custom` para de assinar **e
  de renovar**.

**Próximo passo exato:** a Ana escolhe entre as três saídas do ledger. Com a
escolha, o conserto é de um commit no `upsertLedger` mais o teste visto vermelho;
sem ela, cada dia que passa é um dia de extrato que o pipeline não vai buscar
depois, porque a janela não avança (a janela destravada **salta para ontem** —
os dias no meio nunca viram janela).

📌 A pendência de razão social dos cadastros (empresário individual: o campo diz
exatamente `66.106.202 ANA BEATRIZ DE OLIVEIRA`, sem nome fantasia) segue em
`docs/tiktok-shop-integracao.md` — vale para qualquer cadastro que peça razão
social.

### 5. Shopee: Live no ar — o que resta é operação

*Reescrita em 26/09/2026 — esta seção afirmou "Live BLOCKED" por semanas depois
de o Go Live ter sido aprovado, contradizendo a própria tabela de Canais acima.
A verdade medida:*

- **Go Live APROVADO em 02/09/2026** — os dois apps ONLINE no console, conferido
  com a dona do produto na tela (o "under review" de 07/08 ficou 26 dias
  desatualizado aqui porque a checagem dependia de alguém abrir o console).
- **Credenciais de produção ativas e loja real conectada**: a UTILEIRA (conta do
  sócio) sincroniza em produção, o push está ligado com a Live Push Partner Key
  (status *Normal*, 29 tipos), e a conciliação bateu **ao centavo** contra o
  Mercado Turbo em 04/09 (ponto seguro `f50e3b9`/v270 — detalhes na tabela de
  Canais e no changelog de `docs/api-shopee.md`).

**Pendências operacionais que restam, com dono:**

1. **IP allowlist** — o IP de saída medido do Fly é `50.31.196.138` (27/08),
   medido contra um host só; reconferir contra `open.shopee.com` e a cada
   mudança de plano/região. A Shopee **rejeita CIDR** (só endereço avulso) e
   bloqueio de IP falha **em silêncio** — não dá erro, some.
2. **`shopeeCanonical.ts` já foi confrontado com payload real** (a UTILEIRA
   passou por ele); qualquer divergência nova de payload se registra no
   changelog de `docs/api-shopee.md`.
3. **Segunda loja / loja de cliente**: o fluxo é o botão em
   `/api/integrations/shopee/connect` — ⚠️ a loja cai no workspace de **quem
   estiver logado**; decidir antes quem autoriza.

### 6. Marca NEXO e landing

*Verificado em 16/08.*

- ✅ **Assinatura NEXO** na tela de login (`NexoWordmark.tsx` + bloco no `globals.css`).
  A 1ª versão recriava a *cena* do vídeo de referência (parede escura atrás das letras) e
  virou um retângulo preto colado numa página clara — lia como banner, não como marca.
  Refeita sem fundo próprio.
- ✅ **Landing v2 em `/landing`** — rota pública oficial, com demonstração multicanal
  interativa, cursor guiado e comportamento responsivo. `/landing-v2` permanece como
  alias da mesma experiência. A versão anterior foi preservada, fora das rotas e do
  build, em `archive/landing-v1/src/app/landing`.
- ⛔ **Renomear a URL não está autorizado** — ver `AGENTS.md`.

📌 **Duas lições caras desta frente**, registradas para não repetir:

1. **Quando ela manda um repositório de referência, leia o código antes de codar.** Três
   iterações foram perdidas construindo a partir de screenshot. O midday é **serifado,
   pequeno e com bordas retas** — o oposto do que eu tinha feito de memória.
2. **Turbopack serve CSS velho.** Duas vezes o print "não mudou nada" era cache: o CSS
   servido tinha **zero** ocorrências das classes novas. Validar pelo CSS servido, não
   pelo print; matar o processo e apagar `.next` resolve.

### 7. Contas de avaliação ativas

*Verificado em 27/08.*

| Conta | Para quê | Prazo |
|---|---|---|
| `contato.anabeatrizoliver+tiktokreview@gmail.com` | Conta que o **TikTok** usa no App review. Workspace demo com os **quatro** canais e dados sintéticos. | **90 dias a partir de 27/08** |
| `contato.anabeatrizoliver+trial@gmail.com` | Conta trial que a **Shopee** usa para avaliar o produto. Workspace com dados sintéticos: ML + Amazon + Shopee (sem TikTok). | sem prazo |
| `emmanuvitorio@gmail.com` | Teste de uma pessoa conhecida. | venceu em **26/08/2026** |

Gestão pelo script `scripts/trial-account.mjs` (`ACTION=status|create|extend|delete`).
Ao vencer, a conta **para de abrir** (HTTP 403 `TRIAL_EXPIRED`) — nada é apagado
automaticamente, de propósito: bloqueio é reversível, exclusão não. A exclusão exige
`CONFIRM=SIM`.

O seed é `scripts/_demo-seed.mjs`. Aceita `--workspace <id>` (reaproveita um workspace
demo que já existe, sem tocar em Auth) e `--canais a,b` (restaura canal cujo dado foi
limpo); recusa qualquer workspace que tenha conexão real. **Ele apaga e regrava** o canal
antes de semear — rodar de novo é a forma de reparar a demo.

📌 **Três armadilhas que o seed já cobre**, resolvidas em 27/08 — não reintroduzir:

1. **Pedido não pode nascer no futuro.** A versão anterior ancorava o dia em
   `now - dia*24h` e somava até 22h, jogando o dia corrente adiante do relógio; "hoje"
   ficava vazio e o narrador dizia que não havia faturamento.
2. **`_sellercore` não passa por `saveCanonicalOrders`** — `stripReservedCanonicalMetadata`
   apaga o bloco reservado de qualquer `raw` que chega de fora. A marca de extrato vai num
   UPDATE próprio; sem ela o `financial_backlog` derruba a fase e a tela mostra
   "Sincronizando" em cima de total oficial.
3. **O painel de saldo lê outra fatia** que o Financeiro: só transação `unsettled` e as dos
   extratos com repasse a pagar. Sem semear `workspace_financial_payments`, ele diz
   "nenhuma movimentação" ao lado de um Financeiro cheio.

### 8. Amazon: pendências de catálogo

*Verificado em 09/08 — **preços mudaram depois; ver a skill de Ads**.*

⚠️ Os preços desta seção estão **desatualizados**: o martelo caiu de R$ 43,22 → R$ 31,90
(15/08) → R$ 27,90 (16/08) para destravar as primeiras vendas. Preço corrente e o porquê
de cada mudança ficam na skill `monitorar-ads`.

Pendências de catálogo que continuam abertas:

1. ⚠️ **O `size: 3 cm` dos kits de protetor pode estar errado.** As dimensões cadastradas
   dizem `40 × 40 × 30 mm` e o título diz "para pés até 4 cm" — provavelmente 4 cm é o
   diâmetro e 3 cm a altura. Confirmar e corrigir.
2. **Desconto no preço está bloqueado** para esta conta: exige ≥1 avaliação de vendedor e
   nota ≥3,5. Por isso foi cupom, não desconto.
3. **Amazon Vine indisponível** — exige Brand Registry, e os anúncios são `Genérico` (por
   decisão dela: buy box fechada). É o maior acelerador de review no lançamento.
   **Virou a alavanca mais provável**: o martelo tem CTR alto e não converte, e o gargalo
   restante é prova social.
4. `martelo-borracha` e `kit-clips-320` seguem com material/formato/tamanho vazios.
5. **Cupom de 10% (09/08–08/09) só desconta se o comprador resgatar** — a taxa de resgate
   nesta conta é R$ 0,00. **Não assumir preço com cupom ao calcular margem**: usar o valor
   do pedido.

---

### 9. Tela de administração — **fase 1 no ar desde 23/08**

`/admin`, a **única** rota do produto que lê entre workspaces. Decisões e
trade-offs em [`ADR-024`](./adr/ADR-024-tela-de-administracao.md).

**Quem entra:** allowlist de e-mail em `ADMIN_EMAILS` (secret do Fly), hoje
`admin@sellercore.test` e `admin2@sellercore.test` — as contas dela e do Lucas.
Fora da lista, `/api/admin/*` responde **404**, e o link nem aparece na barra
lateral. Sem a variável configurada, ninguém é admin (falha fechada).

**O que mostra:** só agregado — workspaces, conexões por canal, volume 30 dias,
adoção de custo e watchlist. ⚠️ É **proibido** exibir nome ou e-mail de vendedor
ao lado do faturamento dele; para suporte, identificar por `workspace_id`.

**Fase 2, pendente:** "telas mais acessadas" e "funcionalidades mais usadas".
Exigem captura de navegação no `src/proxy.ts` numa tabela de eventos **com
retenção** — não existe registro de uso hoje, e o dado começa do zero. O
`metricas.ts` que já existe é telemetria operacional (Prometheus, porta 9091),
não uso de produto.

### 10. Monetização — **gateway definido: AbacatePay (23/09/2026)**

*Atualizado em 26/09.*

**A decisão de gateway saiu: é a AbacatePay**, não a Stripe — decisão da Ana em
23/09, junto com o desenho do funil de conta:

- **pagamento primeiro**: o cliente paga a assinatura pela AbacatePay (que
  coleta CPF e dados de cobrança — o NEXO só pede e-mail e senha);
- confirmado o pagamento, ele recebe o e-mail da AbacatePay **e o nosso, com
  senha temporária** (SMTP da Resend, já ativo); troca de senha no primeiro
  login;
- **alíquota de imposto vira passo OBRIGATÓRIO** do pós-conexão, e a integração
  termina com tela explícita de sucesso/erro;
- **multi-CNPJ é pago** (contas adicionais do mesmo marketplace).

**O que já foi feito:** as exigências do cadastro na AbacatePay — páginas
públicas com razão social/CNPJ, `/termos` e `/privacidade` — estão **no ar e
provadas sem sessão** desde 22/09 (v318; a reprovação de 22/09 era exatamente a
visibilidade dos documentos legais). O doc de onboarding para o designer (PDF
em Downloads) descreve o fluxo aprovado por ela.

**O que falta:** a implementação do funil (webhook AbacatePay → cria conta →
e-mail com senha temporária → troca no primeiro login) **aguarda o "vai" dela**;
credenciais da AbacatePay no Fly são passo dela. A máquina de acesso já existe e
é única (`billing/acesso.ts` — `decidirAcesso()` tranca layout, rotas de dado e
**pausa o sync**, equivalência provada por teste de integração).

📌 O código Stripe (`checkoutStripe`, `webhookStripe`, sandbox completo,
migration 0013) permanece no repo como **legado**: o KYC de produção nunca saiu
e a decisão de 23/09 o substitui. Não configurar chave `live` da Stripe.

### 11. Acesso: recuperação de senha e primeiro acesso — **no ar desde a v107**

*Verificado em 27/08.*

Até esta rodada, quem não fosse a Ana não tinha como entrar sozinho: não havia
recuperação de senha nem fluxo de primeiro acesso. Ambos estão no ar
(`src/app/recuperar-senha/`), com **SMTP da Resend** ativo e os templates em português
colados no provedor.

📌 Pré-requisito silencioso da conta de review do TikTok: o revisor precisa conseguir
entrar — e, se algo der errado, se recuperar sem falar com ninguém.

### 12. Sync imediato pós-conexão (frente K) — **concluída em 27/08, v118→v124**

*Verificado em 27/08.* Pedido da Ana: *"assim que a pessoa clica em integrar, dispara o
sync na hora — janela recente primeiro"*, como regra para **todas** as integrações.

O que está em produção, por release:

| Release | O que entrou |
|---|---|
| v118 | **Shopee**: callback dispara o sync via `after()` (sem segurar o redirect), primeira sincronização fura a fila do cron, fase dupla (30 dias imediatos → alvo total), pedidos antes do sweep de catálogo no 1º sync, número real na tela + poll |
| v119 | **Mercado Livre**: kick + prioridade + fase dupla (30d → 366d) + **fencing por token no lease** (não existia) |
| v120 | **TikTok**: kick nos dois caminhos do callback (painel e convite), semente do sync unificada (morreram os literais 60d/15d duplicados), fase dupla (30d → 60d); fila financeira e ledger intocados |
| v121 | **Amazon**: a linha de estado nasce no callback (antes só na 1ª visita ao dashboard — o agendador nunca via a conta nova), kick, fase dupla (30d → 366d) |
| v122 | **Período não importado nunca exibe zero** nos 4 dashboards (`src/lib/coberturaPeriodo.ts`): filtro em período descoberto mostra o estado real com data e número, nunca cards zerados |
| v123 | **Fencing por token na Amazon** (espelho do ML): todos os checkpoints do passo + guarda no reopen — os 4 canais agora têm a mesma proteção |
| v124 | **Aviso "sua loja está 100% sincronizada — histórico de N meses completo"** nos 4 canais (`SincronizacaoCompleta.tsx`); dismiss por localStorage (não acompanha entre dispositivos — trade-off aceito e documentado no componente) |

**⚠️ Regra de histórico DECIDIDA pela Ana na noite de 27/08 (confirmada em dois canais,
substitui a fase dupla que saiu nas releases acima):** conta nova importa **o mês
vigente** — quem conecta no dia 17 vê os 17 dias do mês até ali, e daí em diante o
histórico cresce para frente com a loja sincronizando. Volumetria baixa para quem conecta
no começo do mês é **o esperado**, decisão dela. A fase 2 (aprofundamento retroativo em
background) e os knobs `*_HISTORY_DAYS` foram **descartados** — o código saiu do repo (o
git guarda, se um dia um plano com retroativo precisar ressuscitar). O helper é
`src/lib/integrations/inicioDoMes.ts` (fuso de Brasília), semente única por canal.
**Conexões existentes não foram tocadas**: o alvo já gravado delas segue valendo até
completar (travado por guarda de fonte nos 4 seeds).

**Consequências da regra:** comparativos com meses anteriores nunca existirão para conta
nova (não há dado retroativo — as telas mostram "o histórico importado começa em DD/MM",
nunca zero); o aviso de conclusão passou a dizer **"histórico desde DD/MM completo"**,
com dismiss único por conexão (sem meses na chave — o histórico cresce para frente e o
aviso não deve voltar); a decisão do Supabase **deixou de ter o backfill de 12 meses
pendurado nela** — vira só uma decisão de capacidade (banco em **466 MB** de 500 em
27/08, ~90% no workspace do sócio; o re-walk do reopen na Shopee/TikTok segue ~4 janelas
por ciclo e deixou de ter motivo para crescer).

**Pendências registradas:** (a) a verificação de ponta a ponta real (conectar loja nova →
dado na tela em 1–2 min) fica para a **próxima conexão real** — a Shopee do sócio
pós-Go Live é o candidato natural; **não simular**; (b) o 503 do dashboard da Amazon
quando não há canônico nenhum mantém a mensagem genérica — item de fila normal, fora
desta frente.

### 13. Briefing por canal — **fase 1 pronta em 27/08 (aguardando deploy)**

*Verificado em 27/08.* Decisão da Ana (27/08, com prints), **revendo a decisão de
23/08** que tinha padronizado um Briefing único global nos 4 canais: a entrada
"Briefing" da lateral de um canal levava ao briefing global e trocava o contexto
para "Todos os canais" — palavras dela: *"deveria ser da sua própria integração"*.

**Fase 1 (pronta):** uma implementação (`BriefingView`) em duas apresentações —
sem canal é o briefing global da Visão geral; com canal, a rota
`/{canal}/briefing` escopa insights (por `provider`), financeiro e narração do
NEXO (o `/api/central/briefing` já aceitava `escopo`) e mantém o seletor de
contexto no canal (contexto vem do pathname). O `/amazon/briefing` deixou de ser
alias do global. Canal **sem detector** mostra o estado honesto ("nenhuma
prioridade detectada ainda para este canal"), nunca "tudo sob controle" — os
detectores (ruptura, queda de vendas, margem) hoje só cobrem a Amazon.

**Fase 2 — Mercado Livre pronto (27/08, aguardando deploy):** os 3 detectores
reimplementados com o canônico do ML — ruptura via `stockRadar` do overview
(mesma classificação compartilhada da Amazon), velocidade via SQL canônico (7d
vs 7d anteriores, só vendas aprovadas, mesmos limiares) e margem via curva ABC
(que já aplica `contribution: null` sem custo). Regras do canal respeitadas:
**alíquota ausente = nenhuma margem avaliada** — vira uma pendência "Monitorar"
apontando o cadastro, nunca margem calculada sem imposto. Fingerprints carregam
a conta (`externalAccountId`) para dois vendedores ML no mesmo workspace não
colidirem. Junto veio um conserto no auto-resolve da reconciliação: a chave
passou de "tipo" para **(tipo, canal) de detector que rodou até o fim** — antes,
um detector que lançava ainda auto-resolvia os próprios insights, e com tipos
compartilhados a falha de um canal resolveria os insights abertos do outro.
**Fase 2 — Shopee e TikTok prontos (27/08, aguardando deploy):** os quatro
canais têm os três detectores. Especificidades respeitadas, não contornadas:
o contrato canônico de **Shopee e TikTok declara que lucro por SKU não é
derivável com segurança** (curva ABC com `profitAvailable: false`) — a margem
desses dois é avaliada **no nível da loja**, e só quando a autoridade do canal
permite (Shopee: `estimatedProfit` não-nulo = período coberto + escrow + todos
os componentes; TikTok: `profit` não-nulo = ledger LIQUIDADO cobrindo o período,
via `applyTiktokLedgerAuthority` já dentro do overview canônico). Alíquota
ausente = margem não avaliada com pendência **por loja**. Ruptura usa a
classificação compartilhada (`classificarCobertura`) nos quatro; velocidade sai
de um helper único sobre o canônico (`unidadesPorSku`), com o conjunto de
status de venda de cada canal por parâmetro. Fila financeira do TikTok
intocada (travado por teste). Fingerprints por loja/conta nos quatro.

### 14. Monitor Unificado — **concluído em 28/08, v134→v142**

Decisão da Ana: o **monitor da Amazon é A referência** e os outros três se
alinham a ele. Fechado em quatro etapas, cada uma pelo portão do cérebro:

- **E0 (v134)** — alerta de saturação do sync nos 4 monitores: linha discreta
  "Sincronizado há X min" e aviso âmbar quando a defasagem passa de **3× o
  ciclo** do canal (2min ML/Amazon, 10min Shopee/TikTok — `saturacaoDoSync.ts`,
  rota `/api/sync-estado`). **Silêncio em primeira sincronização é obrigatório
  e travado por teste** (sem `covered_from` ou `last_success_at`, nada aparece).
- **E1 (v135)** — ML contra a referência: o teto de 1000 pedidos detalhados
  passou a ser **comunicado** na tabela de rentabilidade (mesma frase da
  Amazon); o caminho legado declara `null`, nunca escopo inventado.
- **E2 (v141)** — TikTok elevado de tabela plana para cards+abas: 4 cards do
  período (receita, confirmados, com/sem extrato — régua de liquidação
  coluna-primeiro do ADR-026) e abas **Pedidos | Transações**, com a aba
  Transações **reusando** o extrato do `/financeiro` (mesma rota e componentes,
  paginação local à aba).
- **E3 (v142)** — Shopee, a maior: cards + abas **Composição | Pedidos**;
  Composição reusa o `FinancialSummaryPanel` do dashboard (cascata com escrow);
  **primeira busca do canal** (servidor, dentro da query paginada do canônico,
  com paginação honesta sob filtro — conta o universo filtrado); **período
  personalizado deixou de ser descartado** no contrato do módulo (`from`/`to`
  aditivos, de carona para inventário e ABC).

**O que ficou de fora por semântica, de propósito (não é lacuna):** as virtudes
próprias de cada canal foram preservadas e **travadas por teste** — filtros de
servidor exatos e paginação de servidor no TikTok, coluna Conciliação, extrato
Mercado Pago como "Transações" do ML (base pedido). A Shopee **não tem aba
Transações**: o extrato do canal não está implementado e aba vazia seria mentira
(omissão honesta; o caminho — `get_escrow_list`/`wallet_transaction_list` — é
frente própria aguardando decisão da Ana). `OrderProfitabilityTable` **não foi
adaptado para modo servidor** em nenhuma etapa; se a Rentabilidade entrar no
monitor de TikTok/Shopee um dia, exige testes dos dois modos (destaque do plano).
Tudo nasceu dentro da hierarquia de avisos (cards são métrica, não aviso).

**⚠️ Pendência técnica nomeada — régua `resultIncomplete` duplicada (Shopee):**
o monitor (`ShopeeModulePage.tsx`, `ShopeeMonitorContent`) replica a expressão
do dashboard (`ShopeeWorkspace.tsx`) que decide quando o lucro pode ser
afirmado. Dois lugares calculando dinheiro é como começa divergência. Quando a
Vitrine liberar o `ShopeeWorkspace.tsx` (frente de hierarquia), unificar num
helper único (candidato: `ShopeeWorkspaceModel`, puro) **com teste provando que
dashboard e monitor dizem o mesmo**. Ordem registrada pelo cérebro em 28/08.

### 15. Sync do ML parado 9h — as **três camadas** do mesmo defeito (28/08)

*Caso didático. Se você está vendo "timeout" num sync e chegou aqui procurando,
comece pelo item 3 — foi o que ninguém suspeitou.*

**O sintoma:** a conexão real do Mercado Livre da vendedora (`648425194`) ficou
`status='error'` das 11:34 às 20:11, com `last_error = "timeout exceeded when
trying to connect"`. O token expirou junto às 16:54 — **consequência, não
causa**: o refresh do ML só acontece dentro do passo de sync, e o passo não
rodava. A conexão do outro vendedor, no mesmo cron, sincronizava normalmente.

**As três camadas, cada uma produzindo o MESMO sintoma:**

1. **O scheduler não elegia conexão em `error`.** O predicado só considerava
   `pending`/`syncing`/`complete` — um erro transitório (timeout, 5xx) prendia a
   conexão para sempre. Corrigido com reeleição após backoff de 15 min
   (`mercadoLivreScheduler.ts`). **Auditoria dos 4 canais: só o ML tinha o
   buraco** — Shopee reelege após 5 min excluindo reauth/terminal por prefixo,
   TikTok tem `error` na mesma lista de `pending`, Amazon reelege após 30 min.
2. **O batch saía antes do primeiro passo.** Mesmo eleita, `runMercadoLivreSyncBatch`
   dava `break` quando o status era `error` — ela entrava e saía sem tocar em
   nada. A prova foi o `updated_at` congelado em 11:34 por 8 horas: se o passo
   tivesse rodado, o claim de lease (primeira escrita) o teria movido. Shopee e
   Amazon já faziam certo (a primeira roda o passo fora do laço; a segunda tem
   `if (step === 0)` explícito) e viraram o modelo.
3. **A causa raiz não era o canal: era o POOL DA APLICAÇÃO.** "timeout exceeded
   when trying to connect" é a mensagem do pool `pg` quando
   `connectionTimeoutMillis` estoura — **não** um erro do Mercado Livre. Medido
   para descartar o óbvio: o servidor tinha folga (17 conexões de 60, 1 ativa),
   então a contenção era local — `max: 5` na aplicação, com o cron disparando os
   quatro canais em paralelo e cada passo abrindo várias queries. Subido para
   10 (`src/lib/db.ts`), medido depois: 24 de 60 no servidor, timeout sumiu.

**Desfecho:** `status='complete'`, `last_error` NULL, e **o token renovou
sozinho dentro do passo** — nenhum refresh manual foi feito, porque o refresh
token do ML é rotativo e queimá-lo à mão é estrago que não se desfaz.

📌 **O que a próxima pessoa economiza:** "timeout" no `last_error` de um sync
**não** significa que o marketplace está lento. Antes de culpar o canal:
(a) confira se a mensagem é do driver do banco; (b) meça as conexões no servidor
**e** o `max` do pool da aplicação; (c) veja se o `updated_at` avança — se está
congelado, o passo nem começou, e o problema está acima dele.

📌 **A instrumentação que faltava** entrou junto: o passo do ML agora carrega um
rótulo de etapa (`inicio`/`produtos`/`buscar-pedidos`/`salvar-pedidos`/
`avancar-janela`/`custos-de-frete`) que vai para o log **com stack** e entra no
próprio `last_error` como prefixo — `[buscar-pedidos] timeout...`. O diagnóstico
custou horas porque o erro ia só para a coluna, sem log: os logs de produção não
mostravam absolutamente nada.

⚠️ **E um erro de método que vale mais que o bug:** a correção da camada 2 foi
reportada como "no ar" quando **não estava** — o release `v145` ficou preso em
`running`, nunca aplicou, e a máquina seguiu na versão anterior. O sinal lido
(`updated_at` mexendo) tinha outra causa (o `reverify` do mesmo cron). A defesa
está em `scripts/fly-deploy.sh` e documentada em
[`fly-io.md`](./fly-io.md#️-release-criado-não-é-release-no-ar-incidente-de-28082026):
**afirmar "está no ar" exige ter visto a versão nova na máquina** — health 200
passa igual na versão velha.

---

## 16. Primeira pintura e troca de período — medido na conta real (28/08/2026)

### O que foi medido, e em qual conta

⚠️ **Toda medição anterior de troca de período foi feita na conta demo.** A conta
real é 14 a 17 vezes mais lenta e faz o custo crescer com o período — a demo
esconde exatamente a variável que importa. Números e regra em
[ADR-017](./adr/ADR-017-orcamento-de-1s-e-leitura-agregada.md#lição-de-28082026-medição-em-conta-demo-não-representa-a-conta-dela).

A sonda é `scripts/overview-timing-probe.mjs` (somente leitura; roda o código
real de overview contra o banco de produção, com rodadas alternadas frio/quente).

| Conexão (workspace) | pedidos | hoje | 7 dias | 15 dias | 30 dias |
|---|---:|---:|---:|---:|---:|
| **UTILEIRA** · Shopee (`22ae3d9d`) | 22.292 | 133ms | 383ms | 767ms | **1457ms** |
| **CRYSTALFANCY** · ML (`22ae3d9d`) | 38.943 | 160ms | 198ms | 410ms | **690ms** |
| NEXAHUBBRASIL · ML (`1803d1fe`) | 192 | ~65ms | 184ms | 65ms | 52ms |
| Lojas Demo (`6c877b36`) | ~200 | ~80ms | ~80ms | ~80ms | ~90ms |

(medianas de 3 rodadas quentes alternadas; RTT desta máquina até o banco ~17ms,
embutido em cada consulta — no Fly, que fica na mesma metrópole do banco, a
gordura é menor)

### O aquecimento sequencial custa segundos, não milissegundos

Depois da primeira pintura, a tela busca os outros três períodos **em fila**. O
custo é a soma:

| Conexão | abrindo em "hoje" | em "7 dias" | em "15 dias" | em "30 dias" |
|---|---:|---:|---:|---:|
| UTILEIRA · Shopee | **2,6s** | 2,4s | 2,0s | 1,3s |
| CRYSTALFANCY · ML | 1,3s | 1,3s | 1,0s | 0,8s |

**Conclusão:** na Shopee real, quem clicar num outro período nos primeiros ~2,6s
espera igual — o pré-carregamento ainda não chegou nele. E o pior caso não é
cache frio: "30 dias" custa 1457ms **quente**, estourando o orçamento de 1s.

### Achados colaterais que mudam a premissa

1. **A Amazon não tem conexão ativa em nenhum workspace real.** Só existem linhas
   `connected` para as lojas demo. Os 22.005 pedidos da Amazon estão no canônico,
   mas a rota resolve a conexão antes de ler — então hoje o dashboard da Amazon
   não está lento, está **desconectado** (consistente com o token revogado). O
   custo de leitura dela só será comparável ao da UTILEIRA depois de reconectar.
2. **O pooler do Supabase está em modo `session` com `pool_size: 15`.** Duas
   sondas em paralelo (10 conexões cada, `db.ts` `max: 10`) derrubaram a segunda
   com `EMAXCONNSESSION`. Com uma máquina no Fly sobra folga; **durante um deploy,
   máquina velha e nova coexistem e somam 20 > 15**. É a mesma família do
   `"timeout exceeded when trying to connect"` da §15 e merece decisão própria.

### Pendências nomeadas (não bloqueiam pintura, mas são sinal)

- **`/api/central/briefing` é chamado duas vezes por canal** na abertura.
- **POST de 12,4s no TikTok** — não bloqueia a pintura, mas 12 segundos de
  narração indicam outra coisa acontecendo.
- **`/integrations/shopee/connect` levando 1.372ms** no meio da cascata —
  adiado por decisão do cérebro ("entender depois, não agora").

---

## 17. Onde a Amazon mora — e a lição de concluir olhando no lugar errado (28/08/2026)

### A Amazon NÃO está em `workspace_integrations`

A conexão da Amazon vive em **`workspace_accounts`** — a tabela específica dela,
**anterior ao modelo multicanal**. `workspace_integrations` só tem os canais
novos (ML, Shopee, TikTok).

O caminho de resolução confirma o desenho: `resolveConnection()` em
`amazonOverviewCanonical.ts` tenta **`currentAccount()` primeiro** (o contexto
que vem de `workspace_accounts`, via `withAccountContext`) e só cai em
`getIntegrations()` se não houver conta.

⚠️ **Quem investigar a Amazon procurando no lugar dos canais novos vai concluir
errado.** Foi o que aconteceu: consultei `workspace_integrations`, não achei
linha de `amazon` em nenhum workspace real e reportei *"a Amazon não tem conexão
ativa; o dashboard não está lento, está desconectado"*. Estava errado — a conta
está conectada desde 20/07 e servindo dado o tempo todo.

Outro detalhe da mesma tabela que já custou uma medição inteira: o
`refresh_token` está **cifrado** (`enc:v1:`). Quem ler com `SELECT` cru em vez de
`accountStore.getAccount()` recebe o valor protegido, toda chamada à SP-API
falha com *"reconecte a conta"*, e a conclusão sai invertida — na primeira
versão da sonda de etapas isso fez o `orderMetrics` parecer que "falha rápido",
inocentando justamente o principal suspeito.

### A lição, que é a segunda do mesmo tipo no mesmo dia

**Ausência encontrada no lugar errado não é ausência.** É irmã da lição de
algumas horas antes — *"ausência de escrita ≠ ausência de tentativa"* — e as
duas têm a mesma forma: uma conclusão forte tirada de uma fonte que **nunca
teria** a resposta.

A defesa é uma pergunta antes da conclusão: *"se a resposta fosse SIM, ela
apareceria aqui?"* Se não aparecer, o silêncio da consulta não é evidência de
nada. Vale para tabela, para log, para timestamp e para print de tela.

---

## 18. FRENTE PRÓPRIA: o catálogo da Amazon nunca foi sincronizado (28/08/2026)

Achado lateral do Delta durante a revisão do ADR-029, medido e confirmado. **Não
é o defeito de variação da Shopee** — é outra causa, no mesmo lugar da dor
(o custo não se prende ao que vende).

| Medida, no workspace real (`22ae3d9d`) | Valor |
|---|---:|
| Produtos Amazon em `workspace_channel_products` | **0** |
| Ids de produto que **aparecem em venda** | **71** |
| SKUs distintos vendidos | **71** |
| `products_total` / `products_synced_at` no sync | **0** / **nunca** |

O catálogo da Amazon **nunca rodou** nos três workspaces reais
(`products_synced_at IS NULL`). Os únicos produtos Amazon no canônico são **4 em
cada workspace de demonstração**.

**Consequência:** tudo que depende de casar venda com catálogo na Amazon está
sem base — cadastro de custo por produto, curva ABC por catálogo, radar de
estoque. As vendas existem (22 mil pedidos, 20 mil itens, todos com SKU); o
outro lado da junção é que está vazio.

⚠️ **Terceira surpresa da Amazon em dois dias**, e as três têm a mesma forma —
*o dado não está onde se supõe*:

1. a conexão mora em `workspace_accounts`, não em `workspace_integrations` (§17);
2. `orderMetrics` não é reproduzível pelo canônico porque a Amazon **omite** o
   valor de pedido `Pending` (ver `api-amazon-sp-api.md`);
3. o catálogo simplesmente **não existe** no canônico.

**Ainda não investigado** — registrado por ordem do cérebro para não se perder no
meio de outro ADR. Pergunta de partida: o passo de catálogo do sync da Amazon
existe e nunca foi elegível, ou não existe?

---

## Bloqueado por terceiros

- ~~**Solution Provider Portal (Amazon)**~~ — ✅ **app público APROVADO em
  03/09/2026** ("acesso global do Marketplace com base nas funções solicitadas").
  A revisão parada desde julho fechou em 1 dia depois da re-submissão com a
  landing v3.
- ~~**Brand Analytics**~~ — ❌ **CASO ENCERRADO em 03/09/2026: app pronto, CONTA
  sem Brand Registry.** Não é bloqueio de terceiros nem trabalho pendente nosso.
  Medido no token real: `403` específico do BA, com a Reports API respondendo
  `200` para relatório comum; e confirmado no Seller Central logado, onde
  `/analytics/dashboard/searchTerms` responde *"Acesso necessário"* e o menu não
  tem a seção Marcas — **nem o login dela vê**. Detalhe e tabela de medição em
  `docs/api-amazon-sp-api.md` → Changelog, 03/09.
  **A exigência é TRIPLA** (documentação oficial, verbatim): função de Brand
  Analytics no app + registro no Brand Registry + ser representante da marca.
  **Reabre** se ela registrar marca, ou quando conectarmos um cliente que já
  tenha Brand Registry. ⚠️ **E aí há um passo NOSSO, hoje sem urgência:** o
  app-dash ainda está na Central de desenvolvedores ANTIGA (perfil "Desenvolvedor
  privado", 8 funções marcadas, Brand Analytics **nem listado como opção**), com
  banner pedindo migração para o Portal de provedores de soluções — o portal novo,
  onde a aprovação de 03/09 aconteceu. Migrar a conta e anexar a função é
  pré-requisito para o BA de um cliente com marca. **Isto é condição de
  reabertura, não pendência ativa:** ninguém está esperando por isso hoje.
- ~~**Amazon Ads API**~~ — ✅ **aprovada em 25/08/2026** (3ª candidatura); o gasto
  está na tela desde o mesmo dia (seção 3).
- ~~**TikTok DSPR**~~ — ✅ aprovada em 07/08; as 4 qualificações aprovadas em 04/09.
- ~~**TikTok: App review + Listing review**~~ — ✅ **app público PUBLICADO no
  Service Market**; cliente real conectado por ele desde 12/09 (seção 4).
- **AbacatePay: homologação do cadastro** — as exigências do nosso lado (páginas
  legais públicas) foram atendidas e provadas em 22/09; a aprovação final e as
  credenciais são passo do gateway com a Ana (seção 10).
- ~~**KYC da Stripe (produção)**~~ — **superado pela decisão de gateway de 23/09**:
  a cobrança será pela AbacatePay. Ver seção 10.
- ~~**Shopee Go Live**~~ — ✅ **APROVADO em 02/09/2026** (apps ONLINE no console,
  conferido com a dona na tela). A validação Live está cumprida: credenciais de
  produção, push assinado e conta real conciliada ao centavo em 04/09. Ver
  seção 5 — o "under review" de 07/08 ficou 26 dias afirmado aqui depois de
  superado, e é o exemplo desta lista de por que estado de terceiro se mede.

---

## Decisões que valem para qualquer canal novo

1. **O banco não muda.** O modelo canônico é agnóstico: `workspace_channel_*` tem coluna
   `provider`. Canal novo grava nas mesmas tabelas — **sem migration** (ADR-001).
2. **Todo mapeamento de campo fica num arquivo só** (`<canal>Canonical.ts`), isolado do
   sync. É o que permite corrigir rápido quando a API real diverge da documentação.
3. **Tela sem dado não inventa número.** Enquanto não há ingestão, mostra-se o estado real
   ("conecte uma loja", "sincronização pendente") — nunca zeros que pareçam "sem vendas".
4. **Taxa desconhecida é `null`, não zero.** A diferença entre "não sei" e "é zero"
   atravessa todo o cálculo de lucro e a cobertura do dashboard.
5. **Mudança em canal replica para todos** os canais implementados, salvo quando for
   especificidade do marketplace. **Replicar é reimplementar com a API de cada um**, não
   copiar código.
6. **Custo tem vigência** (ADR-004). Trocar o custo hoje **não** altera o lucro de vendas
   passadas — é contabilidade correta, não bug. Mas os caches derivados de custo precisam
   ser invalidados nos quatro canais: `src/lib/costInvalidation.ts`.

---

## 🗄️ Infraestrutura de banco — cota e uso

**Cada número aqui traz a fonte e a data.** Isso não é formalidade: até 01/09/2026
este doc alimentava um limite de **500 MB** transcrito de painel em agosto, sem
data nem origem, e ele foi repetido o dia inteiro em decisões de expurgo, de
prioridade e de risco — inclusive numa matriz que quase virou "quanto histórico
da vendedora a gente apaga". Constante sem procedência envelhece em silêncio.

| o quê | valor | fonte | data |
|---|---|---|---|
| `pg_database_size` do banco da aplicação | **482 MB** | **medido** por SQL | 02/09/2026 01:53Z |
| soma de todos os bancos da instância | 496 MB | **medido** por SQL | 02/09/2026 01:53Z |
| WAL em disco | 128 MB | **medido** (`pg_ls_waldir`) | 02/09/2026 01:53Z |
| **Limite do plano** | **8 GB** de disco GP3 por projeto | **painel do Supabase, lido pelo cérebro** | 01/09/2026 |
| Disco provisionado hoje | **2 GB**, com auto-scale | painel do Supabase | 01/09/2026 |
| Plano | **Pro**, org "AninhaBe's Org", ciclo 01/09–01/10/2026 | painel do Supabase | 01/09/2026 |
| Compute | **Nano** (inalterado pelo upgrade) | medido: `max_connections` 60, `shared_buffers` 224 MB | 02/09/2026 |

O disco **escala sozinho** ao se aproximar do tamanho provisionado; o excedente
custa US$ 0,125/GB/mês. Ou seja: **não há mais teto rígido**, há custo marginal.

### ⚠️ Plano e compute são coisas separadas — e isso custou uma validação errada

O upgrade para Pro **não reinicia a instância nem muda os parâmetros**, porque o
compute continua Nano. Em 01/09/2026 tentou-se validar o upgrade pelo *uptime* e
pelos parâmetros de memória — **e o sinal não serve**: 48 dias de uptime
ininterrupto e `shared_buffers` idêntico eram compatíveis com o upgrade ter dado
certo. O sinal media **compute**; a pergunta era sobre **cota**.

**Não existe sinal de cota legível por SQL.** Conferido: nenhuma view, função ou
extensão devolve o limite do plano. Quem sabe é o painel, e só ele.

### O que foi aposentado com o upgrade

A **regra de parada por crescimento de disco** (parar um job em lote se o banco
crescer mais de 8 MB acumulados) foi criada quando a folga era de dezenas de
megabytes contra um teto rígido. Com 8 GB e auto-scale, **ela vira monitoramento
normal — sem freio.**

📌 O que ela deixa como método, e vale além do disco: **limite de
ordem-de-grandeza precisa de folga de ordem-de-grandeza.** O valor foi de 5 para
8 MB quando o alvo do job mudou, porque a 2,5× do previsto um alarme dispara por
variação legítima e ensina a ser ignorado.

## Ambiente e credenciais

- Produção: **Fly.io**, app `nexo`, região `gru` (São Paulo), em
  **`https://nexoaihub.com.br`** — ADR-015. Banco Supabase. Agendamento pelo
  **agendador interno** (ADR-019) somado ao workflow `cron.yml`; a máquina agendada
  nativa do Fly não serve, porque `--schedule` só aceita granularidade horária.
  ⚠️ `auto_stop_machines` fica **desligado** e `min_machines_running = 1`.
- ~~Render~~ — **desativado**. `sellercore.onrender.com` foi suspenso em 19/08 e devolve
  503. O identificador continua nas allowlists de OAuth (ver `AGENTS.md`), mas **não é
  mais um endereço vivo**: nada novo deve apontar para lá.
- Segredos **nunca** no repo: `.env.local` local, `fly secrets` em produção.
- **Tokens são cifrados no banco** (`enc:v1:`, AES-256-GCM, chave
  `INTEGRATION_TOKEN_KEY`). Sempre passar por `revealSecret()`
  (`src/lib/integrations/secrets.ts`) antes de usar. 📌 Mandar o texto cifrado como Bearer
  devolve **403**, e isso já foi diagnosticado errado como "a rede local está bloqueada".
- ⚠️ **Nunca dar refresh no token do ML fora do app.** O ML **rotaciona o refresh token a
  cada uso** — fazer isso invalida o token guardado em produção.
- Shopee hoje está configurada **apenas localmente** (chaves de sandbox). Em produção,
  quem **não** tem loja conectada vê "Configure as credenciais" — intencional, para não
  expor um botão que leva ao ambiente de teste.
- Temporários no disco `G:` (`TMP=G:/sc-temp`) — o `C:` vive cheio.
- **Stripe**: chaves de **teste** no `fly secrets`; nenhuma chave `live` configurada até o
  KYC sair (seção 10).
- **E-mail transacional**: SMTP da **Resend**, com os templates em português no provedor —
  é o que faz recuperação de senha e primeiro acesso chegarem.
- **Deploy**: `bash scripts/fly-deploy.sh` pelo Git Bash. `fly deploy` pelado sobe a
  imagem **sem** as `NEXT_PUBLIC_*` e quebra o login — elas são substituídas durante o
  `next build` e precisam entrar como `--build-arg`. Hoje (27/08) foram **cinco** deploys,
  da **v107** à **v111**.
- **DDL é fail-closed:** `ensureSchema()` lança `SCHEMA_BLOCKED`; migration só pelo
  `scripts/migrate-cli.mjs` (ver [`migrations.md`](./migrations.md)).

### Limites de infraestrutura — decisão dela, pendente

Levantado em 15/08 ao dimensionar escala (ADR-014):

| Item | Situação | Ação |
|---|---|---|
| Fly `shared-cpu-1x` | **1 GB** — 512 MB está descartado, foi o que matou o Render Free | reavaliar ao escalar usuários |
| Supabase Free | banco em **466 MB** contra limite de 500 MB (medido em 27/08; era 526 em 15/08 — encolheu) | perto do teto; **~90% é do workspace do sócio** — decidir entre upgrade (Pro, ~US$ 25/mês, 8 GB) e curadoria desse dado. A extensão do histórico para 12 meses (seção 12) espera essa decisão |

⚠️ **As tabelas legadas NÃO podem cair.** Foi cogitado dropar três delas (~266 MB) — todas
as três estão em uso, e `workspace_marketplace_orders` guarda os payloads brutos.
