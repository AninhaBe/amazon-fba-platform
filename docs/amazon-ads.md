# Amazon Ads — o que se aplica à conta NEXAHUB BR

Levantado em **02/08/2026**. O help hub do Seller Central **não documenta Ads**: o artigo
`G200663330` só redireciona para o suporte do Amazon Ads. As fontes reais são
`advertising.amazon.com/pt-br`.

## O que a conta pode usar hoje

| Formato | Requisito | Disponível para ela? |
| --- | --- | --- |
| **Sponsored Products** | Vendedor profissional; produto não pode ser adulto, usado, recondicionado ou de categoria fechada | ✅ **sim** |
| **Sponsored Brands** | "vendedores profissionais **inscritos no Registro de Marcas**" | ❌ não — produtos são Genérico |
| **Sponsored Display / Stores** | Proprietário de marca registrada | ❌ não |

**Consequência prática: só existe Sponsored Products.** Todo o resto depende de Brand
Registry, e os anúncios dela são Genérico por decisão de negócio (ver
`anuncios-sempre-generico` na memória). Não perder tempo estudando Sponsored Brands.

## Mecânica

- **Leilão de CPC**: paga só no clique, e o lance é escolhido por você.
- **Orçamento diário mínimo no Brasil: R$ 50** (guia oficial de conceitos básicos).
- **Segmentação automática**: a Amazon casa o anúncio com as buscas usando os dados do
  próprio anúncio. É por isso que **título, marcadores e termos de busca alimentam o Ads** —
  anúncio mal preenchido segmenta mal.
- **Segmentação manual**: o guia recomenda **no mínimo 30 palavras-chave**, começando em
  correspondência **ampla** e refinando depois para **frase** e **exata**.

## Pré-condições que a documentação assume e ninguém avisa

1. **Estoque comprável.** Oferta sem estoque não é a Oferta em destaque, e sem Oferta em
   destaque o Sponsored Products não veicula. Com os 6 SKUs zerados, campanha ligada hoje
   não entrega nada.
2. **Anúncio em conformidade.** Anúncio suprimido não aparece nem organicamente. Corrigir
   **título (75 caracteres)** e **capa (fundo branco, sem texto)** antes de pagar por
   clique — ver [amazon-politicas.md](./amazon-politicas.md).
3. **Oferta em destaque**: "os vendedores devem atender aos requisitos baseados em
   desempenho para se qualificarem". Em ASIN Genérico exclusivo dela não há disputa, mas a
   oferta precisa estar comprável.

## Créditos de publicidade — Incentivos para Novos Vendedores (`GXMJ38VA95GUN5XU`)

**Não exige Brand Registry.** É o único benefício do programa que a conta dela alcança.

> "Novos vendedores que utilizarem os Sponsored Products **dentro de 90 dias** após listarem
> sua primeira oferta comprável podem receber até **R$ 5.300** em Créditos de Publicidade."

| Você gasta em Sponsored Products | Recebe de crédito |
| --- | --- |
| R$ 265 – R$ 1.059,99 | **R$ 265** |
| R$ 1.060 – R$ 5.299,99 | **R$ 1.060** |
| R$ 5.300 ou mais | **R$ 5.300** |

Os degraus são **fixos, não proporcionais**: gastar R$ 1.059 rende R$ 265; gastar R$ 1.060
rende R$ 1.060. Vale planejar o gasto para cruzar o degrau, não parar rente a ele.

**Regras de prazo:**

- A oferta comprável deve ser listada **após 20/02/2026**.
- Usar Sponsored Products **dentro de 90 dias** da listagem do primeiro ASIN comercializável.
- O crédito aparece no Gerenciador de campanhas em até **2 semanas** após cumprir o
  requisito — e há **apenas 30 dias para gastá-lo**.

**Situação da conta (12/08/2026):** o estoque FBA chegou — **263 unidades vendáveis em 5
SKUs** (martelo 118, clips 92, kitprote-8 35, kitprote-32 16, kitprote-16 2). A oferta
comprável existe, então o relógio dos 90 dias está correndo. **A data exata da primeira
oferta comprável continua não confirmada** — está na página do programa de Incentivos para
Novos Vendedores no Seller Central, e é ela que define o prazo real. Conferir antes de
contar com o benefício.

O console mostra o benefício como **"até US$ 1.000"** (equivalente aos R$ 5.300 desta
tabela); é a mesma oferta, só exibida em dólar.

### O outro benefício (fora de alcance hoje)

**Bônus de nova marca (NBB):** R$ 300.000 em crédito, aplicado como **5% de desconto na
comissão** sobre até R$ 6.000.000 em vendas, por até 1 ano. **Exige Brand Registry** — marca
registrada, concluída em até 6 meses após a primeira oferta comprável. Incompatível com a
estratégia Genérico atual; registrar como fica é a decisão que destrava isso.

## Roteiro recomendado (ordem importa)

1. **Repor estoque.** Sem isso, nada do resto importa.
2. **Corrigir título e capa** dos SKUs que vão ser anunciados.
3. **Uma campanha automática**, lance baixo, um grupo por produto. Deixar rodar **2 a 3
   semanas** sem mexer — é coleta de dados, não performance.
4. **Colher os termos de busca** no relatório: o que converteu vira campanha manual em
   correspondência **exata**; o que gastou sem converter vira **palavra-chave negativa**.
5. **Comparar ACOS com a margem real** — o custo já está cadastrado no SellerCore, então a
   margem por SKU é conhecida. ACOS acima da margem = prejuízo por clique.
6. **Não anunciar os 6 de uma vez.** Começar pelo de melhor margem e maior estoque.

## Campanhas no ar (criadas em 12/08/2026)

Conta **NEXAHUB BR**, `merchantId AO62LVXJMX3AA`, `entityId ENTITY16D5M3ZYVBEMC`.
Todas Sponsored Products, **lances dinâmicos somente redução**, ajuste por canal 0%,
início 12/08 sem data de término. Total: **R$ 50/dia**.

| Campanha | ID | Produto | Segmentação | Lance | Orçamento |
|---|---|---|---|---|---|
| Auto - Martelo Borracha | `A09902661J0ZF8TYDHJC8` | `B0HBGQNBD4` | automática (8 negativas exatas) | R$ 0,35 | R$ 15 |
| Manual - Martelo Borracha | `A01357752UOKBP340AQ6T` | `B0HBGQNBD4` | manual, grupos Exata + Frase | R$ 0,33–0,90 | R$ 10 |
| Auto - Clips 320 | `A09432513MF2JZKXFKXGB` | `B0HBGLBL6Y` | automática | R$ 0,35 | R$ 15 |
| Auto - Protetor Kit 8 | `A06494282F1XLCQPDJD30` | `B0H9SFW8KR` | automática | R$ 0,35 | R$ 10 |

As 8 palavras da manual do martelo são as **mesmas** bloqueadas como negativa exata na
automática — é o que impede o par de disputar o próprio clique. Se migrar termos novos
para a manual, negativar na automática **na mesma hora**.

A negativa é **só exata**. Negativar em frase mataria também as variações que o grupo
Frase existe para capturar.

**Não anunciamos o kitprote-32**: R$ 44,33 de preço contra R$ 38,28 de custo é 13,6% de
margem bruta, que a comissão de 15% já consome. Ou o custo está errado, ou o preço está.
O **kitprote-16 não tem custo cadastrado**, então a margem dele é desconhecida.

### Pegadinhas observadas na criação (12/08)

- **O lance sugerido muda depois de adicionar o produto.** Antes do produto a tela mostra
  um valor genérico (R$ 0,98); com o martelo dentro, a sugestão real era R$ 0,33. Nunca
  aceitar o número que aparece antes de o produto entrar.
- **Sem sugestão, o padrão é R$ 2,75.** Foi o caso do kitprote-8. Com margem de ~R$ 9,
  esse lance exigiria 30% de conversão para empatar.
- **Exata custa ~3x a automática**: "martelo de borracha" sugeria R$ 1,20 em exata contra
  R$ 0,33 na automática.
- **O ASIN pai não é anunciável.** `B0H9QCVBPC` aparece como `Ineligible` — Sponsored
  Products anuncia ofertas, ou seja, os filhos. Para ver desempenho por variação, adicione
  os filhos no mesmo grupo; o relatório sai por ASIN filho.
- **O fluxo "campanhas prontas para lançar"** (`/cb/sp/presets`) pré-seleciona todos os
  ASINs com orçamento e lance escolhidos pela Amazon. Não usar.
- **O orçamento mínimo não é R$ 50/dia.** Esse número é a *recomendação* (US$ 10 ou
  equivalente); o mínimo aceito é o equivalente a US$ 1. A tela sugere R$ 40 e aceita menos.

### Lances recalibrados em 13/08 (15h30)

Em ~19h de veiculação as quatro campanhas somaram **134 impressões, 1 clique e
R$ 0,55** — 1% do orçamento de R$ 50/dia. O limitador não era orçamento, era
**lance**: R$ 0,35 ganhava pouquíssimo leilão, e 120 impressões/dia não produzem
CTR legível (o esperado seria 0,2 clique/dia). Subimos para o sugerido de cada
grupo, exceto onde a margem não aguentava:

| Campanha | Antes | Depois | Sugerido pela Amazon |
|---|---|---|---|
| Auto - Martelo | R$ 0,35 | ~~R$ 0,84~~ ⚠️ | R$ 0,84 |
| Auto - Clips 320 | R$ 0,35 | **R$ 0,61** | R$ 0,61 |
| Auto - Protetor Kit 8 | R$ 0,35 | **R$ 1,29** | R$ 1,29 |
| Manual Exata - Martelo | — | inalterada | — |

O orçamento **não** foi aumentado: teto é rede de proteção, e aumentá-lo com 1% de
uso não destrava volume nenhum. Só mexer quando o gasto encostar em ~50% do teto.

⚠️ **CORREÇÃO (17/08/2026): a mudança da `Auto - Martelo` NUNCA foi aplicada.** Ao abrir
o grupo de anúncios em 17/08, os quatro grupos de segmentação automática estavam em
**R$ 3,00** — o default alto da criação, não os R$ 0,84 anotados aqui. Ficou assim por 4
dias, pagando **R$ 1,92 por clique** (9× a sugestão de R$ 0,33 da Amazon) e consumindo 25%
do gasto da conta com o pior CTR.

Corrigido em 17/08: os quatro para **R$ 0,50**, e **Substitutos pausado** — essa
segmentação sozinha trazia 1.799 das 2.390 impressões, todas de página de concorrente.

📌 **Lição:** anotar a mudança não prova que ela foi salva. **Conferir o CPC real
(custo ÷ cliques) contra o lance anotado** — se o CPC passa do lance com dinâmico em
"somente redução", o lance anotado está errado. Foi assim que este defeito apareceu.

`Ajuste de lance para o topo da pesquisa` segue em **0%** nas quatro. É o
multiplicador mais caro e compra posição, não aprendizado — só depois de o CTR
provar conversão.

⚠️ **A margem que sustenta esses lances depende da tarifa zerada.** A promoção
"O FBA agora é GRÁTIS" está ativa e é temporária. Com ela, martelo tem R$ 37,38 de
margem, clips R$ 13,08 e protetor R$ 12,54. Quando acabar, clips e protetor ficam
apertados nesses preços — o plano de subir preço deixa de ser oportunidade e vira
necessidade. Conferir a data de término no card do Seller Central.

### Estrutura completada em 13/08 (17h)

O deck de treinamento (`MVP_Amazon_Slides`) especifica, **por produto**: 1 campanha
automática + 1 campanha manual, e a manual com **dois grupos de anúncios** — um em
correspondência exata e outro com as **mesmas palavras** em frase. Faltavam o grupo
Frase do martelo e as duas manuais inteiras. Agora estão no ar:

| Campanha | ID | Grupo | Lance padrão | Palavras |
|---|---|---|---|---|
| Manual - Martelo Borracha | `A01357752UOKBP340AQ6T` | Manual Exata | R$ 0,90 | 8 exatas |
| ” | ” | Frase - Martelo Borracha | R$ 0,90 | 10 em frase |
| Manual - Clips 320 | `A01608831T9MN9I9KPAYF` | Exata - Clips 320 | R$ 0,33 | 14 exatas |
| ” | ” | Frase - Clips 320 | R$ 0,50 | 14 em frase |
| Manual - Protetor Kit 8 | `A06695151U462T3OKRJIU` | Exata - Protetor Kit 8 | R$ 0,85 | 12 exatas |
| ” | ” | Frase - Protetor Kit 8 | R$ 0,60 | 12 em frase |

Total agora: **6 campanhas, R$ 70/dia** de teto.

Três armadilhas que apareceram e valem para qualquer criação futura:

- **O grupo novo nasce com lance padrão R$ 2,75**, mesmo quando todas as palavras têm
  lance próprio. Só morde se você adicionar um alvo sem lance depois — mas nasce errado
  em **todo** grupo criado por essa tela. Corrigir na lista de grupos logo após criar.
- **Campanha nova nasce em "lances dinâmicos - aumento e redução"**, não herda a
  configuração das outras. A do protetor veio assim e foi trocada para somente redução
  antes de publicar.
- **Frase pode ser mais barata que exata.** No protetor, "ponteira de cadeira" sugeria
  R$ 1,60 em exata e R$ 0,33 em frase. Não presumir a ordem — ler a sugestão de cada uma.

Onde a sugestão passava de ~R$ 1,00, o lance foi baixado para o **piso da faixa que a
própria Amazon exibe** (ex.: R$ 1,89 → R$ 1,14), não para um número arbitrário: fora da
faixa o anúncio simplesmente não entra no leilão, que é exatamente o erro que o dia 13
já custou.

`clip`/`clipe` puxam sugestões de `nail clippers` e `hair clippers` no autocomplete da
Amazon. Em exata e frase isso fica contido; **se algum dia virar ampla, negativar antes**.

### Quando agir, ao monitorar

Ordem de checagem; parar na primeira que casar:

1. Campanha fora de "Em veiculação" → **investigar**, nada mais importa.
2. Impressões ~zero por 2+ dias → **lance** baixo demais.
3. Gasto ≥50% do teto → **subir orçamento**.
4. 500+ impressões e 0 clique → problema é a **página** (preço, foto, título).
5. 15+ cliques e 0 venda → problema é a **página do produto**.
6. Termo com 3+ pedidos → migrar para manual exata **e negativar na automática**.
7. Termo com 10+ cliques e 0 pedido → **negativa exata**.

CTR só significa alguma coisa a partir de **~500 impressões**. Abaixo disso é ruído
e não se conclui nada.

A skill `monitorar-ads` (em `.claude/skills/`, **não versionada** porque o
`.gitignore` ignora `/.claude`) automatiza essa leitura e guarda a linha de base.

### Próximos passos

1. **A partir de 13/08:** só observar. Não mexer em lance nem orçamento por 2–3 semanas —
   é fase de coleta. Sinais de problema: 500+ impressões com 0 clique (preço ou foto) ou
   muitos cliques sem venda (página do produto).
2. **Em 2–3 semanas:** relatório de termos de busca → termo com 3+ pedidos vira exata na
   manual; termo com 10+ cliques e 0 pedidos vira negativa exata. Repetir a cada 15 dias.
3. **Pendente:** criar as manuais exatas do **Clips 320** e do **Protetor Kit 8**, com os
   termos colhidos (não chutados), reequilibrando os R$ 50/dia.
4. **Confirmar a data da primeira oferta comprável** para saber o prazo real dos 90 dias.

## Ligações com o SellerCore

- **Margem por produto** (`/produtos` + curva ABC) é o teto do ACOS aceitável.
- **Histórico de ranking** (ADR-009/011) mostra o efeito do anúncio no BSR — a campanha
  deveria empurrar a posição para baixo (melhor) em poucos dias.
- **Histórico de oferta** (ADR-010) explica queda de veiculação por ruptura de estoque.

## Fontes

- [Sponsored Products](https://advertising.amazon.com/pt-br/solutions/products/sponsored-products)
- [Sponsored Brands](https://advertising.amazon.com/pt-br/solutions/products/sponsored-brands)
- [Guia de conceitos básicos para anúncios patrocinados](https://advertising.amazon.com/pt-br/library/guides/getting-started-with-sponsored-ads)
- [Guia de Sponsored Products para novos anunciantes](https://advertising.amazon.com/pt-br/library/guides/new-advertiser-success-guide)
- [Políticas de anúncios patrocinados](https://advertising.amazon.com/pt-br/resources/ad-policy/sponsored-ads-policies)
- Seller Central `G200663330` (só redireciona)

## Endpoints da Ads API usados pelo NEXO

Host: `https://advertising-api.amazon.com` (`ADS_API_HOST`). Todo request leva
três cabeçalhos: `authorization: Bearer <token>`,
`Amazon-Advertising-API-ClientId` e `Amazon-Advertising-API-Scope` (o
`profileId`).

| Endpoint | Onde | Para quê |
|---|---|---|
| `POST /auth/o2/token` (`api.amazon.com`) | `amazonAdsAuth.ts` | troca o refresh token por access token |
| `GET /v2/profiles` | `scripts/ads-profiles.mjs` | descobre o `profileId` do anunciante |
| `POST /reporting/reports` | `amazonAdsSync.ts` | **cria** o relatório (assíncrono) |
| `GET /reporting/reports/{reportId}` | `amazonAdsSync.ts` | consulta status; `COMPLETED` traz a URL |
| `GET <url do relatório>` | `amazonAdsSync.ts` | baixa o GZIP e grava as métricas |

**Corpo do pedido de relatório** — o que importa e por quê:

```jsonc
{
  "startDate": "2026-07-26", "endDate": "2026-08-25",
  "configuration": {
    "adProduct": "SPONSORED_PRODUCTS",
    "groupBy": ["campaign"],
    "columns": ["date", "campaignId", "campaignName",
                "impressions", "clicks", "cost", "purchases30d", "sales30d"],
    "reportTypeId": "spCampaigns",
    "timeUnit": "DAILY",     // ⚠️ sem isto o relatório volta SOMADO
    "format": "GZIP_JSON"
  }
}
```

⚠️ **`timeUnit: "DAILY"` + `date` nas colunas é o que dá granularidade diária.**
Sem os dois, a API devolve um total do período inteiro — e a tela não consegue
responder ao filtro de 7/15/30 dias, porque não há como recortar o que já veio
somado. O primeiro relatório desta conta foi pedido sem `DAILY` e teve de ser
refeito.

⚠️ **`purchases30d` / `sales30d` são vendas ATRIBUÍDAS ao anúncio**, na janela de
30 dias — **não** é o faturamento do canal. Confundir os dois inverte o ACOS.

**Content-type do POST:** `application/vnd.createasyncreportrequest.v3+json`.
Não é `application/json`; com o genérico a API recusa.


## Changelog observado — Ads API

- **2026-08-31** — **As DUAS tabelas de anúncio dão números diferentes de
  propósito, e a fonte de verdade do GASTO é `workspace_ad_metrics`.** Medido na
  conta dela, mesma janela: `workspace_ad_metrics` = **R$ 447,97** e
  `workspace_ad_product_metrics` = **R$ 397,16**. A diferença é ~11%.

  | tabela | grão | responde |
  |---|---|---|
  | `workspace_ad_metrics` | campanha × dia | **quanto gastei** — é o total |
  | `workspace_ad_product_metrics` | produto × campanha × dia | **em quê** — é um recorte |

  **A prova de que um contém o outro**, campanha a campanha por dia: o custo por
  produto é sempre **menor ou igual** ao da campanha, nunca maior. E a campanha
  `213167782978574` tem custo de campanha R$ 0,50 e R$ 1,20 em dois dias com
  custo por produto **R$ 0,00** nos dois. Gasto que a Amazon não atribui a um
  SKU existe e **não aparece** no grão de produto.

  ⚠️ **SOMAR `ad_product_metrics` COMO TOTAL SUBESTIMA O GASTO** — e isso deixa a
  margem otimista, que é a direção errada do erro.

  📌 **Onde isso está acontecendo hoje (31/08/2026):** `adsMultiCanal.ts` monta o
  total por canal da aba de Ads com `SUM(m.cost)` sobre
  `workspace_ad_product_metrics`. Na conta dela, a aba mostra ~R$ 397 onde o
  gasto real é ~R$ 448. `anuncioDoCanal.ts` (o card de Ads do dashboard) está
  **certo**: prefere `workspace_ad_metrics` e só cai no grão de produto quando
  não há linha de campanha — o que é o caso do Mercado Livre, que só grava o
  grão de produto. ⚠️ Essa queda é **silenciosa**: se um dia faltar linha de
  campanha da Amazon num período que tem linha de produto, o total encolhe ~11%
  sem avisar.



*Mais recente primeiro. Registrar aqui na hora de esbarrar num comportamento novo.*

### 25/08/2026 — a Reporting API **entrega o dia corrente**

Medido, não suposto. Relatório `spCampaigns` de `25/08` a `25/08`, pedido às
~17h20: aceito e **COMPLETED em 105 segundos**, com 6 linhas, R$ 17,53 de gasto
e 17 cliques.

⚠️ **Isto desmente o que eu tinha escrito no código e mandado para produção.**
A `janela()` do `amazonAdsSync.ts` pedia até *ontem*, e o card do dashboard
exibia o texto *"A Amazon publica o gasto do dia só no dia seguinte"* — afirmação
minha, nunca testada. Corrigido no mesmo dia.

**O que é verdade sobre o dia corrente:**

| | |
|---|---|
| Gasto (`cost`, `clicks`, `impressions`) | **real e já pago** — mas cresce até a meia-noite |
| Venda atribuída (`purchases30d`, `sales30d`) | entra **depois** do clique; hoje sai ~zero |

Por isso a tela **mostra** o gasto de hoje (esconder um custo já pago é pior) com
o aviso *"Hoje ainda está somando"*, e o ACOS do dia sai `—` com *"a venda
atribuída ao clique de hoje entra depois"* — nunca 0% e nunca um ACOS
catastrófico às 9h da manhã.

### 25/08/2026 — o tempo do relatório varia com o tamanho da janela

| Janela | Tempo até `COMPLETED` |
|---|---|
| 30 dias, diário (81 linhas) | **~11 minutos** |
| 1 dia (6 linhas) | **105 segundos** |

Nos dois casos passa por `PENDING` → `PROCESSING` → `COMPLETED`. Continua longe
demais para uma requisição de tela: o desenho de dois passos (pedir num ciclo,
colher noutro) segue valendo.

### 25/08/2026 — gasto com anúncio **não** é tarifa de pedido

Os únicos `fee_type` gravados em `workspace_channel_order_fees` são `commission`,
`refund` e `fulfillment`. Anúncio é cobrança de conta e **só** existe pela Ads
API — o card que procurava `/advertis|productads/` no extrato exibiu
"R$ 0,00 · Nenhuma despesa com anúncios" durante todo o período em que a conta
gastava R$ 312,98.
