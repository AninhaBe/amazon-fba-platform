# TODO — NEXO

Pendências combinadas da migração multicanal e melhorias. Atualize os checkboxes
conforme for concluindo.

> Itens marcados **"todos"** já estão feitos na **Amazon** (foi onde a auditoria
> rodou) e faltam nos demais canais. Continuam abertos até os quatro fecharem.

> Para **onde cada frente parou** (Shopee, Amazon, contas de teste) e o passo
> exato de retomada, veja `docs/estado-atual.md`. Este arquivo é a lista de
> tarefas; aquele é a foto da situação.

## Feature aprovada — Solicitar avaliação (Amazon)

Aprovada pela Ana em 13/09/2026; gatilho: **assim que o front da Amazon v3
fechar**. Validada em produção real no mesmo dia: acesso ok no app-dash,
teste unitário + em massa (10 solicitações no clips, zero recusas; rate
limit de 1/s não morde na escala atual; a janela de elegibilidade é
pós-**entrega**, não pós-pedido). Envios do teste registrados em
`G:/sc-temp/solicitacoes-de-avaliacao.md` até a 0034 ser aplicada.

- [ ] Janela da migration 0034 (`workspace_review_solicitations`, já
      commitada) + migrar o registro manual.
- [ ] Backend fase 3: rota de envio + elegibilidade no payload dos pedidos
      (3 estados validados por comportamento real: pode solicitar / cedo
      demais / já enviada).
- [ ] Front: botão na tabela de Pedidos da Amazon v3, após a Margem
      (pedido da Ana com print, 12/09), com os 3 estados.
- [ ] Fase automática (proposta; sem martelo da Ana ainda): venda entregue
      dispara sozinha no dia certo; o botão vira controle manual.

## Feature aprovada — Alerta de recompra por curva ABC

Aprovada pela Ana em 14/09/2026; gatilho: **depois do front da Amazon v3**
(entra na fila atrás de Solicitar avaliação). As regras de negócio — fórmula,
alvos de cobertura por curva, gatilhos — estão fixadas em
`docs/playbook-operacao-amazon.md` §2; a feature implementa aquilo, não
reinventa.

Resumo da conta: classificar produtos por faturamento acumulado (A = 80%,
B = +15%, C = +5%); média de vendas dos últimos 7 dias × 60 dias de cobertura
(curva A) ou × 30 (B/C) − estoque atual = quantidade a recomprar. Alerta quando
o item vende metade do estoque inicial ou a cobertura cai abaixo do alvo.

- [ ] Classificação ABC por produto (janela de faturamento a definir — 30 dias
      é o candidato; decidir medindo, não assumindo).
- [ ] Cálculo de cobertura e sugestão de recompra por SKU (vendas do sync +
      estoque FBA; contar estoque em trânsito quando o dado existir).
- [ ] Alerta na tela seguindo a hierarquia de avisos (informação com número e
      link, sem empilhar faixa; `null` ≠ `0`: produto sem venda nos 7 dias não
      é "recomprar zero", é sem dado suficiente).
- [ ] Multi-inquilino desde o nascimento: a conta roda por workspace, demo
      fora por nome.
- [ ] Amazon primeiro (estoque FBA é o dado que já temos confiável); levar aos
      outros canais é reimplementar com o dado de estoque de cada API, não
      copiar — medir o que cada canal entrega antes.

## Ação manual (precisa de você)

- [ ] **Cadastrar a Push URL da Shopee no console** — uma sentada só, com o
  cérebro junto. A ordem importa e há um risco conhecido no meio.

  **Antes de começar:** as migrations `0030` e `0031` já aplicadas, e a leva do
  push já no ar (o endpoint precisa responder quando o Verify bater).

  1. Console → app **NEXO** → **Set Push**.
  2. **Generate** no campo *Live Push Partner Key*. A chave aparece no input.
     ⚠️ **Não feche o formulário antes do Save**: fechar pode perder o valor
     gerado, e um novo *Generate* produz uma chave diferente — aí a que está no
     Fly deixa de valer e o canal fica mudo.
  3. Copiar a chave e rodar, sem passar por mim:

     ```
     fly secrets set SHOPEE_PUSH_PARTNER_KEY=<a chave> -a nexo
     ```

     A máquina reinicia sozinha; não precisa de deploy.
  4. **Call Back URL:** `https://nexoaihub.com.br/api/webhooks/shopee`
  5. **Verify** (botão ao lado). Só depois do passo 3 — sem a chave o endpoint
     rejeita tudo, de propósito (nasce fechado, não ecoando).
  6. **Deployment Service Area:** preencher e passar no verify próprio dele.
  7. **Toggles:** ligar **só os de status de pedido** por enquanto. São 29
     tipos; os demais entram depois de o primeiro funcionar.
  8. **Save.**

  ⚠️ **Se o Verify falhar no passo 5**, é quase certo que a base string do HMAC
  não é a que eu escolhi — a doc oficial não é alcançável do meu ambiente e as
  fontes de terceiro se contradizem. O endpoint foi feito para esse caso: ele
  **rejeita** e escreve no log qual das fórmulas candidatas *teria* batido. Me
  peça o log (`fly logs -a nexo | grep push-shopee`) e é uma linha para trocar.

- [ ] **Alerta de defasagem do sync e de push mudo no Grafana** — as séries
  existem e o servidor de métricas está **NO AR desde 03/09/2026**: o freio
  `METRICS_PORT=-1`, puxado no incidente de 29/08, foi solto depois que as três
  proteções contra empilhamento de raspagem foram confirmadas **pela resposta
  real** (cache de 60 s devolvendo o mesmo corpo; 8 raspagens concorrentes em
  34 ms). Falta criar as regras em fly-metrics.net, que exige o login da conta.

  **As duas regras, sem número digitado — comparando séries:**

  ```promql
  nexo_sync_idade_segundos > nexo_sync_limite_segundos
  nexo_push_idade_segundos > nexo_push_limite_segundos
  ```

  `for: 5m`, severidade *warning*. Os limites vêm do código
  (`cadenciaDoSync.ts`) e já saem como série: sync — Shopee 900 s, ML 1500 s,
  Amazon e TikTok 3000 s; push — 3600 s. Mudar a cadência muda o alerta no mesmo
  deploy.

  ⚠️ **A regra do PUSH sozinha gera falso positivo, e isso é conhecido.** Push só
  existe quando algo acontece: silêncio de madrugada é legítimo. A regra completa
  — *"só é mudo se a varredura gravou pedido depois do último push"* — mora em
  `defasagemDoSync.ts` e já vem pronta no campo `sync` do `/api/health`. Use a
  série do push para **gráfico e histórico**; para alarme, prefira o
  `/api/health` ou aceite o ruído noturno conscientemente.

  ⚠️ Conexão de demonstração já sai das séries na origem (`NOT LIKE '%demo%'`).

  📌 **Se o freio for puxado de novo** (`fly secrets set METRICS_PORT=-1`), estas
  regras param de receber dado e ficam silenciosamente verdes — alerta sem série
  não dispara. Quem puxar o freio precisa saber que está desligando o alarme
  junto.

- [ ] **Reconectar a Amazon** — as duas contas estão com o refresh token
  revogado (`invalid_grant`, confirmado em 06/08). Preferir **self-authorization**
  pelo Solution Provider Portal em vez do OAuth atual; motivo e caminho em
  `docs/conexoes-que-expiram.md`.
- [x] **Shopee: submeter o Go Live** — submetido em 07/08 e **APROVADO**.
  ⚠️ Este item dizia **BLOCKED por dependência externa** até 04/09/2026, e a
  aprovação foi conferida no console em **02/09** com a dona do produto na tela.
  Ficou dois dias afirmando um bloqueio que não existia — e o canal está em
  produção desde então, com ponto seguro registrado (`f50e3b9`/v270). Corrigido
  ao registrar o TikTok, porque a mesma pergunta ("quem ainda diz que isto está
  bloqueado?") revelou os dois. **Estado de terceiro que só se mede abrindo
  painel envelhece calado, e o pendente que sobrevive à causa vira mentira.**
- [ ] **Amazon: `superseded_at` carrega DOIS significados — dívida assumida em 06/09/2026.**
  Desde a correção do cancelamento, a coluna significa **"a tarifa real chegou"**
  *e* **"o pedido foi cancelado"**. Para todo leitor de hoje o efeito é idêntico
  (a estimativa não vale mais), e foi por isso que valeu a pena — mas é
  exatamente a família de *"coluna que dois escritores tocam tem dois
  significados"* do `AGENTS.md`, que já custou 11 horas sem varredura no ML.

  **CRITÉRIO DE MORTE — quando isto vira trabalho:** no dia em que alguém
  precisar distinguir os dois casos (auditar quantas estimativas a realidade
  substituiu vs. quantas o cancelamento matou; medir a pontaria da tarifa
  calculada; ou explicar na tela por que um número sumiu). Aí a resposta é
  **coluna de motivo por migration**, não um `LIKE` no `provider_fee_code`.

  ⚠️ E aí a pergunta obrigatória se aplica inteira: **quem lê isso agora?**
  Hoje o `status` do próprio pedido responde qual foi — a distinção é
  recuperável, só não é direta. Enquanto ninguém precisar, isto é dívida
  registrada; sem registro central, dívida apodrece em silêncio.

- [ ] **Amazon: o card de Repasse passa a dizer o que a API já sabe.**
  ⚠️ **Aprovado pela dona do produto depois de um incidente real:** ela perguntou
  *"os saques que estou fazendo estão indo pra onde?"* e a medição respondeu que
  **não estavam indo** — sete transferências com `FundTransferStatus: Failed`
  para uma conta PF (final 550), incluindo as quatro que o painel dela exibia
  como "pagamentos recentes" de 01/09 (R$ 153,85 / 89,81 / 44,33 / 27,90). O
  painel mostrava a TENTATIVA; o desfecho só existia na API. Conta trocada por
  ela para a PJ no CNPJ; R$ 382,44 seguem represados e devem reprocessar
  sozinhos depois da validação bancária.

  📌 **A frente existe por isso:** o dado que teria avisado "repasse falhou"
  semanas antes já estava na API e não estava em lugar nenhum da tela.

  **Spec, e ela sai inteira de `listFinancialEventGroups` — dado provado pela
  medição de 05/09/2026, não hipótese:**

  | campo | de onde | cuidado |
  |---|---|---|
  | **Disponível** | soma dos grupos `Pending` | eram R$ 382,44 na medição |
  | **Em maturação** | grupos `Open` | ⚠️ **pode ser NEGATIVO** (havia um de −R$ 128,90: tarifa maior que venda no período). A tela precisa exibir sem parecer defeito |
  | **Última transferência** | `FundTransferStatus` + `FundTransferDate` + valor | é o campo que responde a pergunta dela |

  ⚠️ **SEM "próximo repasse ~dia X", e isto é decisão, não esquecimento.** A API
  não publica data futura: `FundTransferDate` só aparece DEPOIS da tentativa.
  Daria para inferir pela cadência dos grupos anteriores, mas os desta conta são
  irregulares (05/07, 16/08, 29/08, 01/09) e a tela estaria chutando.
  **Data errada de dinheiro é pior que data nenhuma.** Quem for implementar e
  sentir falta da data: a ausência é o desenho.

  📌 E o `TraceId` (código de rastreio bancário) só vem em algumas: 1 de 9 na
  medição. Quando existir, vale exibir — é o que casa com o extrato do banco.
  Quando não existir, ausência, nunca traço vazio fingindo rastreio.

  Entra na fila normal — **não fura** App review do TikTok, relatório do
  cancelamento da Amazon nem a remedição de IO.

- [ ] **TikTok: desligar o app custom** — o público é o único daqui para frente.
  ⚠️ **NÃO HÁ MIGRAÇÃO.** Decisão da dona do produto em 11/09/2026, verbatim:
  *"pode desligar o custom do tiktok, vamos usar a aplicacao do tiktok que foi
  aprovada (public)"*. A loja que está conectada pelo custom era **sonda** —
  serviu para medir o que a API entrega, nunca foi produção. Qualquer vendedor,
  inclusive o dono dela, integra a própria loja do zero pelo botão.
  📌 **Até 11/09 este item descrevia outra coisa** ("a loja reautoriza pelo app
  público", link de convite com `?app=publico`). Aquilo não vai acontecer, e
  fica registrado para ninguém achar que a etapa sumiu sem explicação.
  **Já feito:** toda autorização nova vai pelo público, a ausência das
  credenciais do público é **recusa** (nunca fallback para o custom), e
  `tiktokConfigured()` responde pelo público — é ela que habilita o cartão em
  `/integracoes`.
  **O que falta, na ordem, e ela não inverte:**
  1. medir V2 (as três `TIKTOK_PUBLIC_*` **dentro do processo**) e V3 (escopos
     `finance.info` e `order.info` ativos no público — escopo **não** herda do
     custom) — **com a sonda ainda viva**, para descobrir problema enquanto
     ainda há loja conectada para medir;
  2. um vendedor integra pelo botão, ponta a ponta, e a conexão nasce com
     `app='publico'` — é a prova que nunca existiu: token do público
     **assinando**, não só montando URL;
  3. a sonda sai do banco (`removeTiktokShop` apaga **só** a linha de
     credencial: pedidos, ledger e checkpoints continuam consultáveis);
  4. `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET` e `TIKTOK_SERVICE_ID` saem do Fly,
     **passo da dona do produto**;
  5. o custom sai do código: `src/lib/integrations/tiktokApps.ts` colapsa, o
     parâmetro `app` fica com um valor só e morre junto, e os dois scripts que
     exigem as variáveis antigas (`scripts/tiktok-qa-evidence.mjs`,
     `scripts/tiktok-reprocess-real.mjs`) apontam para o público.
  ⚠️ **3 antes de 4, sempre.** Sem as credenciais do custom a sonda para de
  assinar **e de renovar** — o token dela expira em 15/09 e ela viraria uma
  conexão que erra a cada ciclo, para sempre.
  ✅ **A condição de desligamento é uma CONSULTA, não uma lembrança:** o custom
  sai quando não houver nenhuma linha com `app = 'custom'` em
  `workspace_tiktok_shops`. É exatamente para isso que a coluna da migration
  `0033` existe.
  📌 Duas vias de credencial já custaram um `undefined` em produção na Amazon.
  A convivência aqui tem prazo declarado no próprio módulo, e a guarda
  `tests/convivenciaDoTikTokTemPrazo` cobra que ele continue escrito — mas
  guarda nenhuma faz a migração acontecer: **este item faz.**

- [ ] **TikTok: MEDIR o que a qualificação Finance abriu de verdade.** As 4
  qualificações do Partner Center ficaram verdes em 04/09/2026 (Finance 18:28,
  Marketing 18:31, Shipping 18:35, com a Catalog que já estava). ⚠️ **Permissão
  concedida não é dado entregue:** antes de desenhar a conciliação financeira,
  sondar na loja conectada o que `finance` responde — `settlements`,
  `statements`, `payments` — **e com que atraso**, que é a regra da dona
  (cada API tem seu próprio calendário). 📌 Teste decisivo de graça: o
  `payments` falhava com `UNKNOWN_ERROR` desde 27/08 e a causa registrada era a
  FORMA do dado (`amount` como objeto). Se ele passar a responder agora, a causa
  era permissão e o changelog precisa ser corrigido; se continuar falhando, era
  forma e continua sendo. Não é urgente — entra depois da remedição de IO.

- [ ] **Shopee: confirmar IP Whitelist no ambiente Live** depois da aprovação;
  sem ela os dados do comprador vêm mascarados e não sai NF-e.
- [ ] **Mercado Livre Ads: habilitar o escopo no DevCenter** (`advertising` /
  `product_ads`). ⚠️ **Adicionar escopo força re-autorização** de quem já está
  conectado — não é mudança silenciosa. A conta também precisa qualificar:
  reputação amarela ou melhor, 15 dias de operação, mínimo de vendas e nenhuma
  fatura em atraso.
- [ ] **Renomear as telas de consentimento de "SellerCore" para NEXO** nos quatro
  canais. Ela viu na autorização do Ads: *"apareceu SellerCore Ads quer permissão,
  mas é NEXO o nome e você sabe"*. É o texto **mais público** do produto.

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

- [ ] 🔴 **A TELA DE CONSENTIMENTO DOS CANAIS DIZ "SellerCore".** Achado por ela em
  25/08/2026, ao autorizar a Amazon Ads: *"apareceu SellerCore Ads quer permissão, mas é
  NEXO o nome"*.

  Isto **não** é o caso dos identificadores que o `AGENTS.md` manda preservar. É o texto
  mais público que existe no produto: **todo cliente lê esse nome antes de entrar**, na
  hora de conectar a conta dele. Um vendedor que nunca ouviu falar de "SellerCore" vê uma
  empresa desconhecida pedindo acesso à conta de anúncios — é o pior momento possível para
  gerar dúvida.

  - [ ] **Amazon Ads** — `developer.amazon.com` → Security Profiles → perfil
        `SellerCore Ads` → editar o **nome de exibição**.
        ⚠️ **NÃO tocar em Client ID, Client Secret nem "Reset Secret"** enquanto estiver
        lá. O nome é etiqueta e troca sem quebrar nada; resetar o segredo derruba a
        integração que levou 12 dias e três candidaturas para sair.
  - [ ] **Shopee** — conferir o nome exibido no consentimento do app.
  - [ ] **TikTok Shop** — idem, no app `SellerCore Conexao Parceiro`.
  - [ ] **Mercado Livre** — conferir no DevCenter.

  📌 Vale conferir os quatro de uma vez: o custo é o mesmo e o problema é idêntico.

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

## Anúncio nos outros canais (Amazon entregue em 25/08/2026)

A Amazon já desconta anúncio do lucro e mostra Ads, ACOS e TACOS
([ADR-025](docs/adr/ADR-025-anuncio-entra-no-lucro.md)). **Os outros três não** —
e enquanto for assim, a comparação de margem entre canais é **injusta com a
Amazon**, que é a única exibindo o custo real.

A tabela `workspace_ad_metrics` já nasceu com coluna `provider`: o segundo canal
tem de ser um `INSERT`, não uma tabela nova. Pesquisado em 25/08/2026 — os três
têm API:

- [ ] **Mercado Livre — Product Ads.** Depende do escopo no DevCenter (ver "Ação
  manual"). É o próximo, por ser o canal com mais volume depois da Amazon.
- [ ] **TikTok Shop — GMV Max.** A integração de pedidos já existe; falta a API de
  anúncio.
- [ ] **Shopee — AdsManager.** Bloqueado pelo mesmo Go Live que trava o resto.

⚠️ **Replicar aqui é reimplementar com a API de cada um, não copiar o arquivo da
Amazon.** Cada canal tem janela de atribuição, granularidade e semântica de custo
próprias — a única coisa compartilhada é a tabela e a forma dos cards.

- [ ] **Decidir se o "Ads" do TikTok vem da API ou do `fee_type: ads`.** O TikTok
  desconta publicidade **no repasse**, então parte já pode estar em
  `workspace_channel_order_fees`. Se vier dos dois lugares, é gasto contado duas
  vezes — a mesma trava que já existe na Amazon precisa ser conferida lá.

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

## Dashboard da Amazon na conta demo em estado de falha (27/08/2026) — achado, NÃO corrigido

Encontrado pelo QA do vídeo do App review, na conta de demonstração
(workspace `fa6b806b`), enquanto a última milha do seed era fechada. **Não foi
tocado**: sair corrigindo rota de canal no meio da entrega do narrador seria
misturar duas frentes, e o vídeo pode ser gravado contornando a aba.

- [x] ~~**`/amazon` mostra Faturamento "—" e cai em estado de falha (3 recargas),
  enquanto a Visão geral exibe R$ 5.169,20 do MESMO canal.**~~
  **CORRIGIDO em 27/08.** A causa não era a SP-API estourar: o workspace demo não
  tem linha em `workspace_accounts`, e `withAccountContext` respondia **409
  "Conecte uma conta Amazon"** antes de o handler rodar. `/api/amazon/dashboard`
  ganhou `onMissingAccount` servindo o MESMO handler (o corpo já lia tudo do
  canônico). Medido depois: a demo devolve **R$ 5.169,20 em 83 pedidos** — o
  número que a Visão geral já mostrava. Conta real com token caído **tem** linha
  em `workspace_accounts`, então o ramo nunca roda e nada mudou para ela.
  Travado por `tests/dashboardAmazonSemConta.test.mjs`. Diagnóstico original: As duas telas leem
  por caminhos diferentes: a central consolida pelo canônico (banco), e o
  dashboard do canal ainda depende de rota que fala com a SP-API. A conexão
  `amazon:demo` é sintética — não tem `refreshToken` válido —, então a chamada
  externa falha e a aba inteira entra em erro em vez de cair para o canônico que
  já tem o dado na mão.

  **Hipótese a confirmar antes de mexer** (não medida ainda): a rota de vendas
  ou a de lucro estourando para a conexão demo. Conferir qual das duas, e se o
  erro é `REAUTH_REQUIRED` ou falha de rede.

  **Por que importa além da demo**: se o mesmo caminho não tem fallback para o
  canônico, qualquer conta real com token caído perde a aba do canal inteira em
  vez de mostrar o que já foi importado — o que contraria "tela sem dado mostra
  o estado real", e não "estado de falha".

  ⚠️ Ao corrigir, lembrar de `docs/adr/` antes: o fallback para o canônico é
  decisão de arquitetura, não detalhe de implementação.

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

## Vigia de defasagem — linha no /admin (pendência futura, NÃO agora)

- [ ] O vigia por canal já responde em `/api/health` (campo `sync`) e alimenta o
  alerta do Grafana. Falta uma linha na tela do `/admin` mostrando o mesmo
  resumo, para quem está olhando o produto não precisar abrir o monitoramento.
  **Decidido em 02/09/2026 que isto NÃO entra agora**: o alarme já toca no
  Grafana, e a tela é conveniência, não cobertura.

  ⚠️ Ao fazer: o resumo é agregado por canal e **não pode passar a exibir
  `connection_id`** — `/admin` tem allowlist de e-mail no servidor, então ali
  seria admissível, mas a peça é a mesma que serve o `/api/health`, que é
  público. Ver a lição "poder LER entre inquilinos ≠ poder DEVOLVER" no
  `AGENTS.md`.

## Infra / performance

- [x] ~~**Aproximar app e banco**~~ — RESOLVIDO pela migração para o Fly em São
  Paulo (região `gru`, ADR-015). Era o motivo de existir da migração: o Render
  estava em Oregon e o Supabase em São Paulo, ~180ms por query.
- [x] ~~Pinger externo em `/api/health`~~ — desnecessário no Fly:
  `auto_stop_machines = false` e `min_machines_running = 1` no `fly.toml`.
- [ ] **Consolidar as idas ao banco do dashboard da Amazon.**

  ⚠️ **O "antes" é 30 idas em 4 ondas, não 28.** O 28 foi medido ANTES de o
  gasto com anúncio entrar no lucro (30/08/2026); `anuncioDoCanal` acrescenta
  **2 consultas por produtor** (soma do período + `MIN(day)`), e **3** quando o
  canal não grava na tabela de campanha e a leitura cai na de produto — é o caso
  do Mercado Livre. Comparar o depois contra o 28 inventaria um ganho de duas
  consultas que nunca existiu.

  O que a medição achou:
  - `getCosts` roda **3 vezes** na mesma carga — mesma consulta, mesmo
    resultado, rotas diferentes;
  - das 10 do overview, **8 são independentes** entre si e rodam em fila
    indiana;
  - das 4 ondas, **2 são artificiais**: o early-return de conta vazia e o Ads,
    que espera o overview sem depender dele;
  - **novo, achado em 30/08:** a mesma requisição pergunta a
    `workspace_ad_metrics` **duas vezes** — `adsDoPeriodo` na rota (para os
    cards de anúncio) e `anuncioDoCanal` dentro do canônico (para o lucro).
    São 5 consultas de anúncio por carga, e duas delas fazem quase a mesma
    pergunta.

  **Critério de aceite, e ele não é "menos consultas":** a tela mostra
  EXATAMENTE os mesmos números de antes, provados lado a lado na conta real, no
  mesmo período, **campo por campo** — não só o total. Otimização que muda
  número é defeito com outro nome.

  **O instrumento existe e a foto do ANTES já foi tirada:**
  `scripts/dashboard-diff-campo-a-campo.mjs`. Ele captura os campos do dashboard
  na conta REAL (recusa a demo), compara campo a campo e **falha alto** dizendo
  qual campo e os dois valores. Também mede o dado de baixo: se o substrato
  mudou entre as capturas, ele diz "esta comparação não vale" em vez de culpar a
  otimização.

  ⚠️ **MEÇA NA MESMA JANELA EM QUE VOCÊ MUDA — e não guarde a foto.**

  A foto do antes é **instrumento, não artefato**: ela precisa sobreviver da
  captura até a comparação, não do projeto inteiro. Se o trabalho atravessar
  dias, **recapture o antes** com o código que estiver em produção naquele
  momento, em vez de confiar num arquivo velho — e sempre dá para recapturar,
  porque o código antigo está vivo enquanto a mudança não subir.

  Foto velha não é só desnecessária, é **pior**: entre a captura e a comparação o
  DADO muda (venda nova, tarifa que chegou, custo cadastrado), então um antes de
  três dias atrás compara períodos que já não existem. Guardar por muito tempo
  cria a ilusão de rigor e entrega ruído — e é por isso que o script mede a
  impressão digital do substrato e recusa a comparação quando ele mudou.

  📌 **A foto NÃO entra no repositório.** Dado financeiro de produção no
  histórico do git é para sempre: não se apaga sem reescrever história e vaza
  para qualquer clone. O que entra no repo é o **script** que gera a foto — ele é
  reproduzível e não carrega dado. Vale como princípio, não como caso isolado:
  instrumento de medição nasce, mede e morre; o gerador fica.

## Portão automático de testes (criado em 30/08/2026)

- [x] **Primeiro workflow de CI do projeto** — `.github/workflows/testes.yml`:
  tsc, eslint, suíte, testes de integração com Postgres descartável e build. Até
  aqui a suíte só rodava quando alguém lembrava.
- [ ] **`src/app/page.tsx:188` — `setState` síncrono dentro de efeito**
  (`Calling setState synchronously within an effect can trigger cascading
  renders`). É o **único** erro de lint da árvore versionada, e é ANTERIOR ao
  portão. Enquanto ele existir, a primeira execução do CI fica vermelha.

  ⚠️ Não silenciei e não afrouxei o passo de lint para o portão "nascer verde":
  gate que começa complacente nunca endurece depois. A escolha é: consertar
  antes de ligar, ou deixar a primeira execução vermelha e tratar isto como o
  primeiro achado do portão — que é, aliás, exatamente o tipo de coisa que
  ninguém via sem ele.
- [ ] **Cota do Actions.** O `cron.yml` morreu em 21/08/2026 com os 2.000
  min/mês esgotados. O portão roda só em `push` na `main` e em `pull_request`,
  com `cancel-in-progress` e `timeout-minutes` — mas se a cota apertar, o
  primeiro corte é o `build` (passo mais lento), e isso é decisão, não algo para
  fazer no susto.

## Tarifa estimada — o lote de 20 que não ligou (31/08/2026)

- [ ] **Descobrir o corpo de `getMyFeesEstimates` e voltar a 3 chamadas.**
  A operação existe e aceita **20 itens por chamada** (confirmado na doc via
  MCP), mas `POST /products/fees/v0/feesEstimate` com `FeesEstimateByIdRequest`
  devolveu erro nesta conta, e a doc **não traz o corpo exato**. Chutar o formato
  seria inventar contrato de API — o erro que esta semana inteira custou caro.

  Enquanto isso, cada chave vai pelo endpoint de **um ASIN**, que já era provado
  no repo (`src/lib/fees.ts`, usado pela calculadora). O custo sobe de **3 para
  47 chamadas** na janela de 30 dias — ainda **bounded**, porque a dedup por
  `(ASIN, preço)` acontece antes: 1.617 linhas viram 47 chamadas, não 1.617.

  A assinatura de `estimarTarifasEmLote` **já é de lote**, então ligar é trocar o
  miolo, não reescrever o chamador.

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
