# Estado atual — onde cada frente parou

**Última atualização: 16/08/2026.** Leia isto antes de continuar qualquer frente
em andamento; o "porquê" das decisões está nos docs de cada área e nos ADRs.

Este doc responde três perguntas: **o que está pronto**, **o que está no meio do
caminho** (com o passo exato para retomar) e **o que está bloqueado por
terceiros**. Quando uma frente terminar, mova a linha para "pronto" e apague o
detalhe operacional — este arquivo não é histórico, é foto do presente.

> **Cada seção diz quando foi verificada pela última vez.** Data velha não
> significa "errado"; significa **não reconferido**. Antes de agir sobre uma
> afirmação com data antiga, confirme — foi assim que três erros seguidos
> entraram nesta semana.

> **O produto se chama NEXO.** "SellerCore" é o nome antigo e continua nos
> identificadores de propósito (URL, contas, variáveis) — ver `AGENTS.md` antes de
> renomear qualquer coisa.

---

## Canais

| Canal | Situação | Verificado |
|---|---|---|
| **Amazon** | Em produção, vendendo, com Ads no ar. ⚠️ **As duas contas seguem com o refresh token revogado** — o app opera pelo `LWA_REFRESH_TOKEN` do ambiente. Ver "Amazon: autorização". | 16/08 |
| **Mercado Livre** | Em produção e sincronizando. Faturamento validado ao centavo contra o painel do ML. Saldo/liberação e auditoria de frete no ar. | 16/08 |
| **Shopee** | Implementação local completa (OAuth, dashboard multi-loja, ingestão fail-closed/retomável, settings por loja, remoção local). **Go Live: último estado comprovado é "under review" em 07/08** — reconferir no console antes de afirmar qualquer coisa. Credenciais, autorização e payload Live seguem **BLOCKED**. | 07/08 |
| **TikTok Shop** | OAuth, sync paginado, cron, modelo canônico, overview, Dashboard e Financeiro implementados. Ledger financeiro **destravado em 15/08** (ver abaixo). Conciliação financeira real segue parcial. | 15/08 |

**Baseline local de qualidade: 491 testes passando** (`node --experimental-strip-types
--test tests/*.test.mjs`, medido em 16/08). Evidência intermediária — não equivale a
validação live, visual ou autenticada do produto.

---

## O que mudou desde 11/08 (para quem leu a versão anterior)

Sessenta commits. Os que mudam como você deve trabalhar:

1. **Auditoria financeira da Amazon** — sete defeitos de cálculo corrigidos. O padrão
   que saiu dela vale para os quatro canais; ver a seção própria abaixo.
2. **Saldo e retenção** entraram na Amazon e no Mercado Livre — quanto está disponível,
   quanto está retido e **em que data cada venda cai**.
3. **"Pedidos a revisar"** no ML — auditoria de frete cobrado contra frete declarado.
4. **Ads da Amazon saíram do papel** — 6 campanhas no ar desde 12/08. A seção "pronto
   para ligar quando o estoque liberar" morreu.
5. **ADR-013 e ADR-014** — worker de sync separado do web; cache fora do processo e
   ingestão em fluxo.
6. **Esboço da landing** em `/landing`, rota pública, isolada do produto.
7. **Marca NEXO** — assinatura na tela de login e o nome em texto novo.

---

## Em andamento — retomar aqui

### 1. Paridade financeira entre canais — **a frente mais quente**

*Verificado em 16/08.*

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

### 2. Amazon: autorização revogada nas duas contas

*Verificado em 06/08 — **reconferir antes de agir**.*

`AO62LVXJMX3AA` (da Ana) e `A15NQMF7A6J1Y0` (do colega) retornam
`invalid_grant: refresh_token ... User may have revoked or didn't grant the permission`.

O `LWA_REFRESH_TOKEN` do ambiente **continua válido** — é por ele que os scripts leem
estoque, catálogo e preço de concorrente. Ou seja: o app tem um caminho funcionando e
outro quebrado.

Caminho recomendado (ver [`conexoes-que-expiram.md`](./conexoes-que-expiram.md)):
**self-authorization** pelo Solution Provider Portal / Seller Central, que a Amazon
indica para app privado e **não exige publicar o app**. Reconectar pelo OAuth atual
resolve na hora, mas pode cair de novo.

⚠️ **Contas:** usar `AO62LVXJMX3AA` (dela). A `A15NQMF7A6J1Y0` é **do colega** e o
acesso autorizado é **somente leitura**.

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

**Ads API: solicitada em 13/08 como Direct Advertiser, ainda não aprovada.** Teste sem
navegador: montar a URL de consentimento com `ADS_CLIENT_ID` e
`scope=advertising::campaign_management`; enquanto pendente volta
`invalid-parameter-bad-scope`. Depois de aprovada, preencher `ADS_REFRESH_TOKEN` e
`ADS_PROFILE_ID` e parar de depender do navegador.

⚠️ **Visualizações/sessões não funcionam no produto.** `/amazon/desempenho` existe e o
código está pronto, mas `GET_SALES_AND_TRAFFIC_REPORT` responde **403**: exige o papel
**Brand Analytics**, que o app não tem e que **não aparece como caixa de seleção** —
precisa ser pedido nominalmente em caso de suporte (candidatura travada; ver "Bloqueado").

### 4. TikTok Shop: ledger destravado, validação financeira a concluir

*Verificado em 15/08.*

**Onde está:** custom app publicado, loja do parceiro autorizada, token e `shop_cipher`
no banco. Sync de pedidos e produtos, scheduler, cron e overview canônico implementados.

| | |
|---|---|
| App | `SellerCore Conexao Parceiro` · service_id `7671696361289074452` · key `6kt9seens0iip` |
| Categoria | Custom · Catalog / Product Listing (as outras duas foram rejeitadas — ver abaixo) |
| Loja | Crystal Fancy · `7494291387899806731` · BR · conectada 10/08 |
| Escopos | `order.info`, `finance.info`, `product.basic`, `authorization.info` — todos Active |

✅ **A autorização NÃO vence.** Verificado no Partner Center em 14/08 (*Authorization
details · Active*): `Authorization period: Unlimited (Extended)`. A loja estendeu em
09/08. Authorization ID `7671858184827848468`. Só cai se o vendedor desautorizar.

**Três defeitos financeiros corrigidos entre 13 e 15/08** — vale conhecer o padrão,
porque todos eram silenciosos:

1. **As três chamadas financeiras nunca funcionaram** — parâmetros inexistentes e
   `sort_field` obrigatório ausente.
2. **Token de página vazio era tratado como erro**, quando é o fim normal da paginação —
   a trava derrubava toda leitura financeira.
3. **O statement travou 85 rodadas** lendo `raw.status` quando a API manda
   `payment_status`. Como o parser lançava **antes** de qualquer contador de erro,
   `error_count` ficava em 0 e o cron reportava sucesso.

📌 **Lição que vale para qualquer canal:** cron "com sucesso" e dado parado ao mesmo tempo
é sinal de exceção lançada antes do contador de erro, não de API vazia.

**Cron:** o orçamento do TikTok era `180_000ms` contra `20_000ms` dos outros canais e
derrubava o container (502 em tempos variados — 37s, 75s, 100s: não era timeout, o
processo morria). Baixado para `60_000ms`.

**PRÓXIMO PASSO:** executar o procedimento autenticado e sem mutação de
[`tiktok-qa-evidence.md`](./tiktok-qa-evidence.md), deixar a fila financeira convergir e
comparar origem, ledger e overview — distinguindo extrato liquidado de estimativa.

Dois pontos a conferir nessa passada:

- **`statusObservados`** — o `MAPA_STATUS` em `tiktokCanonical.ts` veio da doc em prosa,
  não do OAS (que declara `status` como string sem enum). Status fora do mapa cai em
  `pending` **silenciosamente**.
- **`linhasOriginais` vs `itensAgrupados`** — o TikTok emite uma linha por unidade;
  `agruparItens` junta por `product_id::sku_id`. Se a contagem não bater com o pedido
  real, "unidades vendidas por SKU" nasce errado.

**Pendência separada:** as categorias **Accounting** e **Order Management** foram
**rejeitadas** — *"The Company Number that you entered was inconsistent with the company
number on your Company registration document"*.

**O `cnpj.pdf` foi aberto em 13/08 e o mistério acabou:**

| Campo do comprovante | Valor |
|---|---|
| Número de inscrição | `66.106.202/0001-20` |
| **Nome empresarial (razão social)** | `66.106.202 ANA BEATRIZ DE OLIVEIRA` |
| Título do estabelecimento (nome fantasia) | `********` — **não há** |

O número está certo; **o que não bate é o nome**. É empresário individual, então a razão
social é "CNPJ + nome da titular", e **não existe nome fantasia registrado** — "NEXAHUB" é
nome de loja e não aparece em registro oficial. Ao reenviar, o campo de empresa precisa
dizer exatamente `66.106.202 ANA BEATRIZ DE OLIVEIRA`.

📌 Mesma lição para qualquer cadastro que peça razão social — foi assim que o registro da
Amazon Ads API foi preenchido em 13/08.

### 5. Shopee: implementação local pronta; Live **BLOCKED**

*Verificado em 07/08 — **o estado externo precisa ser reconferido no console**.*

Em 07/08 o console mostrou *"Application to go live is under review: audit results will be
sent to your email within 24 hours"*. Esse é o último estado externo comprovado. Não há
evidência de aprovação, credenciais de produção, autorização de loja real ou payload Live.

**Estado local comprovado:** transporte HTTP falha fechado para HTTP não-ok e resposta
não-JSON; o catálogo percorre todos os status em sweep paginado e retomável, sem tombstone
em tentativa incompleta; seleção e settings de imposto são isolados por `connection_id`;
dashboard e módulos suportam múltiplas lojas; `/integracoes` remove credenciais e dados
dependentes **somente do nosso lado**, sem chamar a OpenAPI nem revogar acesso no
marketplace.

⚠️ **Declaramos UM IP** (`74.220.49.18`, medido). O Render publica as faixas
`74.220.49.0/24` e `74.220.57.0/24`, mas a Shopee **rejeita CIDR** — só aceita endereço
avulso, e 256 endereços não cabem no limite de 2000 caracteres. Se o Render migrar dentro
da faixa, as chamadas passam a ser **bloqueadas em silêncio**. Reconferir o IP depois de
qualquer mudança de plano ou região.

**Depois da aprovação** (a Shopee devolve `partner_id` e key de produção):
1. Definir no Render: `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY` (a de Live) e
   `SHOPEE_ENV=live`.
2. O sócio da Ana (que tem loja Shopee) abre `/api/integrations/shopee/connect` e
   autoriza. ⚠️ **A loja cai no workspace de quem estiver logado** — decidir antes quem
   autoriza.
3. O cron assume; o dashboard enche sozinho.
4. **Revisar `shopeeCanonical.ts` nesse dia** — o mapeamento foi escrito contra a
   documentação, sem resposta real para conferir. Está isolado nesse arquivo exatamente
   para isso.

### 6. Marca NEXO e landing

*Verificado em 16/08.*

- ✅ **Assinatura NEXO** na tela de login (`NexoWordmark.tsx` + bloco no `globals.css`).
  A 1ª versão recriava a *cena* do vídeo de referência (parede escura atrás das letras) e
  virou um retângulo preto colado numa página clara — lia como banner, não como marca.
  Refeita sem fundo próprio.
- 🚧 **Landing em `/landing`** — esboço navegável, rota pública, isolada do produto
  (`AppShell` não renderiza a sidebar lá). Estrutura do dub.co, efeitos do midday.ai;
  mapa em [`landing-nexo.md`](./landing-nexo.md).
  - Prontas: vitrine animada da tela do produto (com cursor navegando) e a animação da
    conciliação financeira.
  - **Faltam duas animações pedidas:** pesquisa de mercado da Amazon e aviso de dia de
    repasse.
  - ⚠️ **Fidelidade pendente:** os cards reais têm borda superior colorida, a sidebar tem
    seções (PAINÉIS/CATÁLOGO/FERRAMENTAS) e existe uma faixa VENDAS/UNIDADES/TICKET/ROI
    que o mockup não tem.
- ⛔ **Renomear a URL não está autorizado** — ver `AGENTS.md`.

📌 **Duas lições caras desta frente**, registradas para não repetir:

1. **Quando ela manda um repositório de referência, leia o código antes de codar.** Três
   iterações foram perdidas construindo a partir de screenshot. O midday é **serifado,
   pequeno e com bordas retas** — o oposto do que eu tinha feito de memória.
2. **Turbopack serve CSS velho.** Duas vezes o print "não mudou nada" era cache: o CSS
   servido tinha **zero** ocorrências das classes novas. Validar pelo CSS servido, não
   pelo print; matar o processo e apagar `.next` resolve.

### 7. Contas de avaliação ativas

*Verificado em 06/08.*

| Conta | Para quê | Prazo |
|---|---|---|
| `contato.anabeatrizoliver+trial@gmail.com` | Conta trial que a **Shopee** usa para avaliar o produto. Workspace com dados sintéticos: 186 pedidos ML + 133 Amazon + 214 Shopee. | sem prazo |
| `emmanuvitorio@gmail.com` | Teste de uma pessoa conhecida. | **06/08 → 26/08/2026** |

Gestão pelo script `scripts/trial-account.mjs` (`ACTION=status|create|extend|delete`).
Ao vencer, a conta **para de abrir** (HTTP 403 `TRIAL_EXPIRED`) — nada é apagado
automaticamente, de propósito: bloqueio é reversível, exclusão não. A exclusão exige
`CONFIRM=SIM`.

⚠️ **O demo envelhece em 15 minutos.** O seed grava `covered_to = now()`, e a checagem de
cobertura exige que `covered_to` alcance o fim do período pedido (tolerância de 15 min).
Canal real passa porque o cron roda a cada 5 min; o workspace demo não sincroniza nunca.
Resultado: pouco depois de cada seed os cards voltam a dizer "Sincronização ainda não
cobre todo o período". **É verdade** — o dado é mesmo daquele instante — e deixar limpo
exigiria mentir sobre a cobertura. Se o texto incomodar numa avaliação, rode o seed de novo.

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

## Bloqueado por terceiros

- **Solution Provider Portal (Amazon)** — candidatura travada, caso `21250777631`. Sem
  ele, a Amazon nunca vira canal vendável a terceiros (só uso próprio via
  self-authorization). É o mesmo caminho que destravaria **Brand Analytics**.
- **Amazon Ads API** — solicitada em 13/08, ainda não aprovada. Enquanto isso o
  acompanhamento é pelo navegador.
- ~~**TikTok DSPR**~~ — ✅ **aprovada em 07/08**. As próximas etapas (Listing review, App
  review, Publish) dependem de trabalho nosso, não de espera.
- **TikTok: categorias Accounting e Order Management** — rejeitadas por divergência de
  razão social; reenviar com o nome do CNPJ (ver seção 4).
- **Shopee Go Live** — último estado comprovado é "under review" em 07/08. A validação
  Live depende de aprovação, credenciais de produção, autorização de loja real e
  observação de payloads reais.

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

## Ambiente e credenciais

- Produção: Render (`sellercore.onrender.com`), banco Supabase, cron por GitHub Actions a
  cada 5 min (ADR-003).
- Segredos **nunca** no repo: `.env.local` local, painel do Render em produção.
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
- **DDL é fail-closed:** `ensureSchema()` lança `SCHEMA_BLOCKED`; migration só pelo
  `scripts/migrate-cli.mjs` (ver [`migrations.md`](./migrations.md)).

### Limites de infraestrutura — decisão dela, pendente

Levantado em 15/08 ao dimensionar escala (ADR-014):

| Item | Situação | Ação |
|---|---|---|
| Render Free | 512 MB | Standard (2 GB, ~US$ 25/mês) antes de escalar usuários |
| Supabase Free | banco em **526 MB** contra limite de 500 MB | avaliar upgrade |

⚠️ **As tabelas legadas NÃO podem cair.** Foi cogitado dropar três delas (~266 MB) — todas
as três estão em uso, e `workspace_marketplace_orders` guarda os payloads brutos.
