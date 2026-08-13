# Estado atual — onde cada frente parou

**Última atualização: 11/08/2026.** Leia isto antes de continuar qualquer frente
em andamento; o "porquê" das decisões está nos docs de cada área e nos ADRs.

Este doc responde três perguntas: **o que está pronto**, **o que está no meio do
caminho** (com o passo exato para retomar) e **o que está bloqueado por
terceiros**. Quando uma frente terminar, mova a linha para "pronto" e apague o
detalhe operacional — este arquivo não é histórico, é foto do presente.

---

## Canais

| Canal | Situação |
|---|---|
| **Amazon** | Em produção. ⚠️ **As duas contas estão com o refresh token revogado** — ver "Amazon: autorização" abaixo. |
| **Mercado Livre** | Em produção e sincronizando. Faturamento validado ao centavo contra o painel do ML. |
| **Shopee** | Implementação local cobre OAuth, dashboard e módulos multi-loja, ingestão fail-closed/retomável, configuração por loja e remoção somente local. **Go Live submetido em 07/08, em análise** no último estado comprovado; credenciais, autorização e payload Live seguem **BLOCKED**. |
| **TikTok Shop** | OAuth, sync paginado, cron, modelo canônico e overview estão implementados. Sidebar, Dashboard, Financeiro e módulos com filtros por loja/período estão no código. Parser de pedidos/produtos foi confrontado com amostras reais; a conciliação financeira real segue parcial e retomável. QA autenticado está **BLOCKED** por ownership duplicado e pelo ledger 0005 ainda não aplicado neste ambiente. |

**Baseline local de qualidade:** 353 testes passavam após os reworks de TikTok
e Shopee. Esse número é evidência intermediária e continua sujeito ao gate final;
não equivale a validação live, visual ou autenticada do produto.

---

## Em andamento — retomar aqui

### 1. TikTok Shop: **pipeline implementado — concluir validação financeira real**

**Onde está:** custom app publicado, loja do parceiro autorizada, token e
`shop_cipher` no banco. Sync de pedidos e produtos, scheduler, cron e overview
canônico estão implementados. O parser foi exercitado contra respostas reais BR;
isso valida os campos observados, não todos os estados possíveis da API.

| | |
|---|---|
| App | `SellerCore Conexao Parceiro` · service_id `7671696361289074452` · key `6kt9seens0iip` |
| Categoria | Custom · Catalog / Product Listing (**as outras duas foram rejeitadas** — ver abaixo) |
| Loja | Crystal Fancy · `7494291387899806731` · BR · conectada 10/08 00:57 |
| Escopos | `order.info`, `finance.info`, `product.basic`, `authorization.info` — todos Active |
| Link de convite | `/api/tiktok/invite` (autenticado) devolve a URL assinada, válida 30 dias |

⚠️ **A autorização vence em 07/11/2026 — são 90 dias, não 365 como a Shopee.**

**PRÓXIMO PASSO, exatamente:** executar o procedimento autenticado e sem mutação
de [`tiktok-qa-evidence.md`](./tiktok-qa-evidence.md), deixar a fila financeira
retomável convergir e comparar origem, ledger e overview. A validação deve
distinguir extratos liquidados de estimativas ainda não conciliadas.

1. **`statusObservados`** — o `MAPA_STATUS` em `tiktokCanonical.ts` veio da doc em
   prosa, não do OAS (que declara `status` como string sem enum). Se aparecer
   status fora do mapa, ele cai em `pending` silenciosamente.
2. **`linhasOriginais` vs `itensAgrupados`** — o TikTok emite uma linha por
   unidade; `agruparItens` junta por `product_id::sku_id`. Se a contagem não
   bater com o pedido real, "unidades vendidas por SKU" nasce errado.

Os módulos `tiktokSync.ts`, `tiktokScheduler.ts`, a rota de cron e
`tiktokOverviewCanonical.ts` já existem; não devem voltar a ser descritos como backlog.
No produto, a sidebar TikTok inclui Dashboard e Financeiro, e as superfícies de
monitor, catálogo, produtos, estoque e curva ABC preservam a loja selecionada e
somente os filtros visíveis aplicáveis. Isso está implementado e testado
localmente, mas ainda não foi validado como fluxo autenticado no navegador.

**Bloqueios do QA TikTok — situação em 13/08/2026:**

- ✅ **Migration 0005 aplicada.** Foi preciso corrigir quatro defeitos antes: o SQL
  do contrato nunca havia executado contra um Postgres (dois erros de tipo), faltava
  a coluna `contract_hash` que o código lê, e a runtime role exigida não existe neste
  banco. Ver [`migrations.md`](./migrations.md) e
  [ADR-012](./adr/ADR-012-contrato-0005-sem-runtime-role.md). O Financeiro do TikTok
  deixou de ser `SCHEMA_BLOCKED`.
- 🔴 **Ownership duplicado continua.** A loja `7494291387899806731` está conectada
  pelas duas contas de teste (`admin@sellercore.test` → `1803d1fe`, e
  `admin2@sellercore.test` → `22ae3d9d`), e **os 11.759 pedidos foram ingeridos nas
  duas** (janela 11/06 a 11/08). O harness falha fechado enquanto houver dois donos.
  Resolver exige escolher um workspace e apagar a cópia do outro — operação
  destrutiva, ainda não autorizada.

**Pendência separada:** as categorias **Accounting** e **Order Management** foram
**rejeitadas** — *"The Company Number that you entered was inconsistent with the
company number on your Company registration document"*. Não bloqueia o parceiro
(o app publicou por Product Listing), mas bloqueia listar o serviço nas categorias
certas e submeter Analytics & Reporting.

**O `cnpj.pdf` foi aberto em 13/08/2026 e o mistério acabou.** O documento diz:

| Campo do comprovante | Valor |
|---|---|
| Número de inscrição | `66.106.202/0001-20` |
| **Nome empresarial (razão social)** | `66.106.202 ANA BEATRIZ DE OLIVEIRA` |
| Título do estabelecimento (nome fantasia) | `********` — **não há** |
| Porte | ME · abertura 06/04/2026 |

O número no formulário está certo. **O que não bate é o nome:** é empresário
individual, então a razão social é "CNPJ + nome da titular", e **não existe nome
fantasia registrado** — "NEXAHUB" é nome de loja, não aparece em nenhum registro
oficial. Ao reenviar, o campo de empresa precisa dizer exatamente
`66.106.202 ANA BEATRIZ DE OLIVEIRA`, não "NEXAHUB".

Mesma lição vale para qualquer cadastro que peça razão social — foi assim que o
registro da Amazon Ads API foi preenchido em 13/08 (ver [`amazon-ads.md`](./amazon-ads.md)).


### 2. Shopee: implementação local pronta; Live **BLOCKED**

Em 07/08 o console mostrou *"Application to go live is under review: audit
results will be sent to your email within 24 hours"*. Esse é o último estado
externo comprovado; não há nesta retomada evidência de aprovação, credenciais de
produção, autorização de loja real ou payload Live. Portanto o Go Live e a
validação contra dados reais permanecem **BLOCKED**, não validados.

**Estado local comprovado:** transporte HTTP falha fechado para HTTP não-ok e
resposta não-JSON; o catálogo percorre todos os status em sweep paginado e
retomável, sem tombstone em tentativa incompleta; seleção e settings de imposto
são isolados por `connection_id`; dashboard e módulos suportam múltiplas lojas;
e `/integracoes` remove credenciais, sincronização e dados dependentes somente
do SellerCore, sem chamar a OpenAPI nem revogar acesso no marketplace. Esses
itens ainda não constituem validação live, visual ou autenticada.

**O que foi declarado** (o formulário não guarda rascunho: o preenchimento de
06/08 se perdeu e foi refeito do zero):

| Campo | Valor |
|---|---|
| URL do produto | `https://sellercore.onrender.com` |
| Conta de teste | `contato.anabeatrizoliver+trial@gmail.com` |
| Brief Introduction | 497/500, em inglês, dizendo que a conta de teste é workspace de demonstração com dados sintéticos |
| Screenshots | 3 — integrações com os 3 canais, dashboard `/shopee`, rentabilidade por pedido |
| Test / Live Redirect URL Domain | `https://sellercore.onrender.com` nos dois |
| APP IP | `74.220.49.18` — **medido**, não chutado (ver `api-shopee.md`) |
| Enable IP Whitelist | ligado |
| Database / Other Servers | "IP address(es) unavailable" + justificativa |

⚠️ **Declaramos UM IP.** O Render publica as faixas `74.220.49.0/24` e
`74.220.57.0/24`, mas a Shopee **rejeita CIDR** — só aceita endereço avulso, e
256 endereços não cabem no limite de 2000 caracteres. Se o Render migrar dentro
da faixa, as chamadas passam a ser **bloqueadas em silêncio**. Reconferir o IP
depois de qualquer mudança de plano ou região do serviço.

⚠️ **O whitelist restringe a OpenAPI ao IP declarado.** Se ainda houver teste de
sandbox a partir de outra máquina, essas chamadas podem passar a ser recusadas.

**Depois da aprovação** (a Shopee devolve `partner_id` e key de produção):
1. Definir no Render: `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY` (a de Live) e
   `SHOPEE_ENV=live`.
2. O sócio da Ana (que tem loja Shopee) abre `/api/integrations/shopee/connect`
   e autoriza. ⚠️ **A loja cai no workspace de quem estiver logado** — um usuário
   = um workspace, sem compartilhamento. Decidir antes quem autoriza.
3. O cron assume; o dashboard enche sozinho.
4. **Revisar `shopeeCanonical.ts` nesse dia** — o mapeamento de campos foi
   escrito contra a documentação, sem resposta real para conferir. Está isolado
   nesse arquivo exatamente para isso. Avaliar junto o `invoice_data.pending_reason`
   novo (ver changelog de 29/07 em `api-shopee.md`).

### 3. Amazon: autorização revogada nas duas contas

`AO62LVXJMX3AA` (da Ana) e `A15NQMF7A6J1Y0` (do colega) retornam
`invalid_grant: refresh_token ... User may have revoked or didn't grant the
permission`. Confirmado por chamada real em 06/08.

O `LWA_REFRESH_TOKEN` do ambiente **continua válido** — foi por ele que se
conseguiu ler o estoque FBA. Ou seja: o app tem um caminho funcionando e outro
quebrado.

Caminho recomendado (ver [`conexoes-que-expiram.md`](./conexoes-que-expiram.md)):
**self-authorization** pelo Solution Provider Portal / Seller Central, que a
Amazon indica para app privado e **não exige publicar o app**. Reconectar pelo
OAuth atual resolve na hora, mas pode cair de novo.

**Pendência aberta em 07/08 — lucro da Amazon pelo canônico.** `/api/sales` e
`/api/order-profitability` já caem no modelo canônico quando o workspace não tem
nenhuma conta SP-API (ver [`architecture/read-and-cache.md`](./architecture/read-and-cache.md)).
`/api/profit` **não** — ele carrega `refunds`, `reimbursements` e `netProceeds`,
que só a Transactions API tem. Preencher com zero violaria a regra `null ≠ 0`;
fazer direito exige tornar esses campos nuláveis e ensinar o dashboard da Amazon
e o monitor a mostrar "—" em vez de R$ 0,00. Enquanto isso, a central mostra
faturamento e pedidos e deixa o lucro explicitamente indisponível, em vez de
derrubar o card inteiro.

### 4. Contas de avaliação ativas

| Conta | Para quê | Prazo |
|---|---|---|
| `contato.anabeatrizoliver+trial@gmail.com` | Conta trial que a **Shopee** usa para avaliar o produto (candidatura ISV e Go Live). Workspace com dados sintéticos: 186 pedidos ML + 133 Amazon + 214 Shopee. | sem prazo |
| `emmanuvitorio@gmail.com` | Teste de uma pessoa conhecida. | **20 dias: 06/08 → 26/08/2026** |

Gestão pelo script `scripts/trial-account.mjs` (`ACTION=status|create|extend|delete`).
Ao vencer, a conta **para de abrir** (HTTP 403 `TRIAL_EXPIRED`) — nada é apagado
automaticamente, de propósito: bloqueio é reversível, exclusão não. A exclusão
existe mas exige `CONFIRM=SIM`.

Os dados sintéticos do workspace demo vêm de `scripts/_demo-seed.mjs`
(idempotente). Eles existem para que o avaliador da Shopee veja um produto com
dados, não telas vazias.

⚠️ **O demo envelhece em 15 minutos.** O seed grava `covered_to = now()`, e a
checagem de cobertura exige que `covered_to` alcance o fim do período pedido
(tolerância de 15 min). Canal real passa porque o cron roda a cada 5 min; o
workspace demo não sincroniza nunca. Resultado: pouco depois de cada seed os
cards voltam a dizer "Sincronização ainda não cobre todo o período". É verdade —
o dado é mesmo daquele instante — e deixar limpo exigiria mentir sobre a
cobertura. Se o texto incomodar numa avaliação, rode o seed de novo na hora.

### 5. Amazon Ads — pronto para ligar quando o estoque liberar

Os 5 anúncios foram verificados em 06/08 (`scripts/listing-health.mjs`): todos
`BUYABLE` + `DISCOVERABLE`, sem erro nem aviso, 6–7 imagens cada. **Não há nada a
corrigir em título ou foto** — o que falta é só estoque vendável.

Recomendação registrada: começar por **martelo-borracha** (maior volume e o que
mais liberou), campanha **automática**, R$ 50/dia, 2–3 semanas sem mexer; depois
transformar os termos que converteram em campanha manual exata. Plano completo,
créditos e regras em [`amazon-ads.md`](./amazon-ads.md).

⚠️ **Visualizações/sessões não funcionam no SellerCore hoje.** A página
`/amazon/desempenho` existe e o código está pronto, mas
`GET_SALES_AND_TRAFFIC_REPORT` responde **403 Forbidden**: exige o papel
**Brand Analytics**, que o app não tem. Peculiaridade confirmada em issues do
repositório oficial da Amazon (#1989, #3018): esse papel **não aparece como
caixa de seleção** junto aos outros — precisa ser pedido nominalmente em caso no
suporte de desenvolvedores. O perfil de desenvolvedor e os demais papéis já
existem e funcionam (pedidos, listings, FBA, financeiro). Enquanto isso, os
números estão no Seller Central → Relatórios de Negócios.

### 6. Estoque FBA a caminho

Em 06/08 às 17h: **279 unidades no FBA, 34 vendáveis** (de manhã era 1 — está
liberando: martelo 27, kitprote-32 5, clips 2). O resto está em
`pendingTransshipmentQuantity` — a Amazon redistribuindo entre centros. Remessa
`FBA19KNGKSMZ` com status `RECEIVING` no `GRU8`.

Para acompanhar: `scripts/monitor-estoque.cmd` (duplo clique) sobe um painel em
`http://localhost:4310` com atualização automática e botão de consulta manual.
Usa o token do ambiente, então funciona mesmo com o OAuth revogado.

---

### 7. Amazon: o que mudou em 09/08 e o que ficou pendente

**Feito e no ar:**

- **Preços +11,1%** nos 5 SKUs (`kitprote-8/16/32`, `kit-clips-320`,
  `martelo-borracha`) → R$ 22,11 / 43,22 / 44,33 / 22,11 / 43,22. A propagação da
  oferta levou **~2h**, enquanto atributos do mesmo PATCH saíram em minutos.
- **Cupom de 10%** criado nos mesmos 5, válido **09/08 a 08/09**, orçamento
  R$ 400 (desliga sozinho a 80%). Com ele o preço final volta ao de antes.
  ⚠️ A **taxa de resgate é R$ 0,00** nesta conta.
- **Atributos** `item_shape: Redondo` e `size: 3 cm` nos 3 kits de protetor.

**Pendências:**

1. ⚠️ **O `size: 3 cm` pode estar errado.** As dimensões já cadastradas dizem
   `40 × 40 × 30 mm` e o título diz "para pés até 4 cm" — provavelmente 4 cm é o
   diâmetro e 3 cm a altura. Confirmar com a vendedora e corrigir.
2. **Desconto no preço está bloqueado** para esta conta: exige ≥1 avaliação de
   vendedor e nota ≥3,5. Por isso foi cupom, não desconto.
3. **Amazon Vine indisponível** — exige Brand Registry, e os anúncios são
   `Genérico`. É o maior acelerador de review no lançamento; decidir se vale
   registrar marca.
4. `martelo-borracha` e `kit-clips-320` seguem com material/formato/tamanho
   vazios.

**Ferramenta nova, fora do repo:** skill `pesquisa-produto-amazon` em
`~/.claude/skills/` — analisa nicho por termo (menor preço FBA via
`competitiveSummary` em lote, BSR, margem) e compara produtos por atributo e
dimensão (`comparar.mjs`). Não faz parte do SellerCore.

---

## Bloqueado por terceiros

- **Solution Provider Portal (Amazon)** — candidatura travada, caso
  21250777631. Sem ele, a Amazon nunca vira canal vendável a terceiros (só uso
  próprio via self-authorization).
- ~~**TikTok DSPR**~~ — ✅ **aprovada em 07/08/2026**. Deixou de ser bloqueio;
  as próximas etapas (Listing review, App review, Publish) dependem de trabalho
  nosso, não de espera.
- **TikTok ownership + migration 0005** — QA autenticado exige resolver o owner
  duplicado por uma operação explícita e aplicar a migration financeira com a
  autorização e os guards do runner. Nenhuma das duas ocorreu nesta sessão.
- **Shopee Go Live** — submetido em 07/08 no último estado comprovado; a
  validação Live depende da aprovação, das credenciais de produção, da
  autorização de uma loja real e da observação de payloads reais.

---

## Decisões que valem para qualquer canal novo

1. **O banco não muda.** O modelo canônico é agnóstico: `workspace_channel_*`
   tem coluna `provider`. Canal novo grava nas mesmas tabelas — **sem migration**
   (ADR-001).
2. **Todo mapeamento de campo fica num arquivo só** (`<canal>Canonical.ts`),
   isolado do sync. É o que permite corrigir rápido quando a API real diverge da
   documentação.
3. **Tela sem dado não inventa número.** Enquanto não há ingestão, mostra-se o
   estado real ("conecte uma loja", "sincronização pendente") — nunca zeros que
   pareçam "sem vendas".
4. **Taxa desconhecida é `null`, não zero.** A diferença entre "não sei" e "é
   zero" atravessa todo o cálculo de lucro e a cobertura do dashboard.
5. **Mudança em canal replica para todos** os canais implementados, salvo quando
   for especificidade do marketplace.

---

## Ambiente e credenciais

- Produção: Render (`sellercore.onrender.com`), banco Supabase, cron por GitHub
  Actions a cada 5 min (ADR-003).
- Segredos **nunca** no repo: `.env.local` local, painel do Render em produção.
- Shopee hoje está configurada **apenas localmente** (chaves de sandbox). Em
  produção, quem **não** tem loja conectada vê "Configure as credenciais" — 
  intencional, para não expor um botão que leva ao ambiente de teste. Quem **já
  tem** conexão (a conta trial, com dados demo) vê o canal normalmente: as
  chaves do servidor habilitam conectar, não visualizar.
- Temporários no disco `G:` (`TMP=G:/sc-temp`) — o `C:` vive cheio.
