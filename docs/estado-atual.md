# Estado atual — onde cada frente parou

**Última atualização: 06/08/2026.** Leia isto antes de continuar qualquer frente
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
| **Shopee** | Código completo (conexão + dashboard + ingestão). **Falta o Go Live** para conectar loja real — ver abaixo. |
| **TikTok Shop** | Backlog. App existe no Partner Center; revisão de privacidade (DSPR) reapresentada em 04/08, aguardando resposta. Ver [`tiktok-shop-integracao.md`](./tiktok-shop-integracao.md). |

---

## Em andamento — retomar aqui

### 1. Shopee: Go Live (caminho crítico)

**Onde parou:** o formulário de Go Live estava **preenchido mas NÃO submetido**
no console (open.shopee.com → App List → SellerCore → botão Go-Live).

Preenchido: URL live, usuário/senha da conta trial, Brief Introduction (476/500)
e **um screenshot anexado** (o print da tela de integrações mostrando os três
canais conectados).

**Faltava:** anexar um segundo print e apertar **Submit**.

> Recomendação registrada na conversa: o segundo print deve ser o **dashboard da
> Shopee** (`/shopee` logado na conta trial, que tem dados demo), e **não** o da
> Amazon — o da Amazon aparece zerado e enfraquece a candidatura.

⚠️ **Antes de submeter, o deploy de 07/08 precisa estar no ar.** Até ele, a conta
trial mostrava ao avaliador da Shopee duas telas erradas:

1. `/shopee` caía em *"Credenciais da Shopee ausentes"*. A tela checava
   `SHOPEE_PARTNER_ID`/`KEY` do servidor **antes** de checar se a loja estava
   conectada — e em produção essas chaves não existem, de propósito. Como o
   overview lê só do modelo canônico, credencial do servidor agora habilita
   apenas **conectar** loja nova, não **ver** o canal.
2. A central (`/`) não tinha Shopee: nem card, nem série no gráfico, nem vendas
   na lista consolidada. Agora tem, no mesmo padrão dos outros canais.

**Depois da aprovação** (a Shopee devolve `partner_id` e key de produção):
1. Definir no Render: `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY` (a de Live) e
   `SHOPEE_ENV=live`.
2. O sócio da Ana (que tem loja Shopee) abre `/api/integrations/shopee/connect`
   e autoriza.
3. O cron assume; o dashboard enche sozinho.
4. **Revisar `shopeeCanonical.ts` nesse dia** — o mapeamento de campos foi
   escrito contra a documentação, sem resposta real para conferir. Está isolado
   nesse arquivo exatamente para isso.

Também pendente no console: **IP Whitelist** com os IPs de saída do Render (fica
fora do formulário de Go Live, provavelmente no Security Dashboard). Sem ele os
dados do comprador vêm mascarados e **não sai NF-e**.

### 2. Amazon: autorização revogada nas duas contas

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

### 3. Contas de avaliação ativas

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

### 4. Amazon Ads — pronto para ligar quando o estoque liberar

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

### 5. Estoque FBA a caminho

Em 06/08 às 17h: **279 unidades no FBA, 34 vendáveis** (de manhã era 1 — está
liberando: martelo 27, kitprote-32 5, clips 2). O resto está em
`pendingTransshipmentQuantity` — a Amazon redistribuindo entre centros. Remessa
`FBA19KNGKSMZ` com status `RECEIVING` no `GRU8`.

Para acompanhar: `scripts/monitor-estoque.cmd` (duplo clique) sobe um painel em
`http://localhost:4310` com atualização automática e botão de consulta manual.
Usa o token do ambiente, então funciona mesmo com o OAuth revogado.

---

## Bloqueado por terceiros

- **Solution Provider Portal (Amazon)** — candidatura travada, caso
  21250777631. Sem ele, a Amazon nunca vira canal vendável a terceiros (só uso
  próprio via self-authorization).
- **TikTok DSPR** — questionário de privacidade sob análise desde 04/08.
- **Shopee Go Live** — depende do item 1 acima ser submetido.

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
