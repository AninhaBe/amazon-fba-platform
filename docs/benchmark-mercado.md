# NEXO — Análise de mercado e benchmark

**23 de agosto de 2026** · Relatório interno · Ana Beatriz e Lucas
**Revisão 2** — refeito com foco no mercado brasileiro

---

> ⚠️ **Sobre a revisão.** A primeira versão comparava o NEXO com sellerboard, Helium 10 e
> Luca — produtos que o vendedor brasileiro médio não usa. A correção dela foi certa, e a
> falha mais grave foi omitir a **Koncili**, que é o concorrente mais próximo que existe
> no Brasil. Esta versão inverte o eixo: mercado brasileiro no centro, gringos como
> referência de produto, não como concorrência.

---

## Sumário executivo

O mercado brasileiro de software para vendedor de marketplace está dividido em quatro
caixas bem definidas, e **nenhuma delas é a do NEXO**:

| Caixa | Quem está lá | O que resolve |
|---|---|---|
| **Hub de integração** | Anymarket, Plugg.to, Ideris, Magis5, Base, Hub2b | publicar anúncio, receber pedido, sincronizar estoque |
| **ERP** | Bling, Tiny/Olist, Omie, Eccosys | nota fiscal, financeiro, expedição |
| **Conciliação de repasse** | **Koncili**, GE Finance, Letzee | *o marketplace me pagou o que devia?* |
| **Inteligência de mercado** | Nubimetrics, Real Trends | *o que vender e a que preço?* |

A pergunta que **ninguém** responde direito: *"quanto eu lucro de verdade neste SKU, neste
canal, comparado aos outros três — e por que caiu?"*

Hub cuida da operação. ERP cuida da obrigação. Koncili cuida da cobrança. Nubimetrics
cuida do mercado lá fora. **Decisão de margem, atravessando canais, ninguém cuida.**

📌 **E um dado que vale mais que a análise:** ao pesquisar ferramentas de TikTok Shop, uma
publicação especializada de 2026 afirma que *"Brasil e México sinalizaram interesse, mas
não há data de lançamento confirmada"*. O NEXO tem **3.501 pedidos reais de TikTok Shop
brasileiro** no banco, sincronizando a cada 2 minutos. O mercado de software ainda não sabe
que esse canal opera aqui.

---

## 1. O que o NEXO é hoje — sem otimismo

Retrato factual, medido no código em 23/08/2026:

| | |
|---|---|
| Canais integrados | **4** — Amazon (SP-API), Mercado Livre, Shopee, TikTok Shop |
| Telas · Rotas de API | 54 · 71 |
| Linhas de TypeScript | 42.083 |
| Testes automatizados | **559**, todos passando |
| Decisões de arquitetura | 24 ADRs · 36 documentos |

**No ar e funcionando:**

- Faturamento reconciliado contra o painel do canal **ao centavo** — em 23/08 batemos os
  R$ 493,74 do Seller Central em três fontes independentes, pedido a pedido, zero divergência.
- Lucro por venda com tarifa, custo, cupom resgatado e frete separados.
- Radar de estoque com cobertura em dias, Curva ABC, calculadora de margem.
- Sincronização a cada ~2 minutos nos quatro canais.
- **O NEXO** — IA que lê o banco e explica a causa, não só relata o número.

**O que ainda não é:**

- Sem nota fiscal, sem expedição, sem etiqueta. **Não é ERP e não pretende ser.**
- Sem gestão de anúncios — a Ads API da Amazon segue pendente desde 13/08.
- **Lucro por SKU só em 2 dos 4 canais.** TikTok e Shopee entregam lucro por pedido
  completo; o rateio de tarifa entre itens ainda não fecha com segurança neles.
- Shopee aguardando Go Live; TikTok aguardando App review.
- **Base instalada: duas contas reais.** Validado tecnicamente, não comercialmente.

---

## 2. O mercado brasileiro, caixa por caixa

### 2.1 Conciliação de repasse — **Koncili** *(o concorrente mais próximo)*

Primeiro software de conciliação de repasses de marketplace do Brasil. Confere se o
marketplace pagou o que devia, aponta divergência e emite relatório.

| | |
|---|---|
| Canais | Mercado Livre, Magalu, Amazon, Shopee, Americanas, Via (Casas Bahia/Ponto/Extra) |
| Modelo | software + serviço de conciliação assistida |
| Presença | parceiro oficial no Centro de Parceiros do Mercado Livre |

**Onde encosta no NEXO:** os dois leem repasse, tarifa e pedido dos mesmos canais. A
sobreposição técnica é grande.

**Onde separa, e é a diferença que importa:**

| Koncili responde | NEXO responde |
|---|---|
| *"o marketplace me pagou certo?"* | *"eu deveria estar vendendo isto?"* |
| divergência de repasse — olha para trás | margem por SKU e canal — olha para frente |
| conciliação financeira | decisão comercial |

⚠️ **É a caixa de onde a ameaça viria.** Quem já lê repasse dos seis marketplaces está a
um passo de somar custo do produto e virar margem. Concorrentes na mesma caixa: **GE
Finance** e **Letzee**.

### 2.2 Hub de integração — **Anymarket, Plugg.to, Ideris, Magis5, Base, Hub2b**

Conectam a loja a dezenas de marketplaces — Plugg.to declara mais de 70.

| | |
|---|---|
| Força | publicar anúncio em massa, sincronizar estoque, centralizar pedido |
| Limite | **operação, não margem.** Sabem que o pedido entrou; não sabem se valeu a pena |
| Preço | sob consulta — nenhum publica tabela |

📌 **Não competem com o NEXO. Convivem.** O hub coloca o anúncio no ar; o NEXO diz qual
anúncio deveria sair.

### 2.3 ERP — **Bling, Tiny/Olist, Omie, Eccosys**

O que a maioria dos vendedores brasileiros já paga.

| | |
|---|---|
| Preço (Tiny/Olist) | R$ 59 a R$ 849/mês, quatro faixas |
| Força | nota fiscal, estoque, expedição, hub nativo |
| Limite | conciliar repasse e apurar margem por SKU é onde são fracos |

🔴 **O movimento mais perigoso deste relatório:** o **Olist já lançou agentes de IA** que
deixam o usuário *"conversar com os dados"* e pedir relatório por prompt. É exatamente a
direção do NEXO — vindo de quem já tem a base instalada e a nota fiscal do cliente.

### 2.4 Inteligência de mercado — **Nubimetrics** e **Real Trends**

Olham o mercado do Mercado Livre de fora: quem vende, quanto, a que preço, em sete países.
Real Trends entrega share, receita, unidades e sazonalidade, exportável em Excel, CSV ou
API.

**Não competem.** Respondem *"o que vender"*; o NEXO responde *"o que estou ganhando com o
que já vendo"*. Vendedor sério usa os dois.

### 2.5 Conteúdo e calculadora — **GoSmarter, E-Commerce Brasil**

Não são software, mas ocupam a busca. *"Como calcular lucro real no marketplace"* e
*"calculadora de lucro marketplace"* são conteúdos que rankeiam — e é exatamente a dor que
o NEXO resolve.

📌 **Leitura de aquisição:** existe demanda de busca provada para a dor, atendida hoje por
artigo e planilha. Isso é oportunidade de entrada, não concorrência.

---

## 3. As referências gringas — o que servem (e o que não servem)

Não são concorrentes aqui. Servem como **prova de que o modelo funciona** e como régua de
preço.

| | Para que serve olhar |
|---|---|
| **sellerboard** (US$ 15–63/mês) | prova que existe negócio em "só lucro real", monocanal. É a régua de preço mental de quem vende na Amazon. |
| **Helium 10** (US$ 39–399/mês) | mostra que vendedor paga caro por pesquisa — e roda **junto** com o sellerboard, porque nenhum resolve os dois lados |
| **Luca, Triple Whale Moby** | a categoria de IA agêntica sobre dados de venda, no mundo Shopify/DTC |
| **HiveHQ, Kixmon, Dashboardly** | atendem lucro de TikTok Shop — **em inglês, sem tarifa brasileira** |

📌 **A frase mais importante que a pesquisa devolveu:**

> *"Marketplace tooling stays largely pre-agentic in 2026."*

O ferramental de marketplace segue **pré-agêntico**. A IA que raciocina sobre dado de venda
existe — no DTC americano. Marketplace, e muito menos marketplace brasileiro, ainda não
tem. O Olist é a exceção que confirma a corrida.

---

## 4. Onde o NEXO se encaixa

```
                       OPERAÇÃO                    DECISÃO
                +----------------------+  +------------------------+
   OLHA         | Hubs: Anymarket,     |  | Nubimetrics,           |
   PARA FORA    | Plugg.to, Ideris,    |  | Real Trends            |
                | Magis5, Base         |  |                        |
                +----------------------+  +------------------------+
   OLHA         | ERP: Bling, Tiny,    |  |                        |
   PARA DENTRO  | Omie                 |  |        NEXO            |
                | Koncili (repasse)    |  |                        |
                +----------------------+  +------------------------+
```

**O quadrante "olha para dentro + decisão" está vazio.** Lucro real por SKU, atravessando
quatro canais, em português, com tarifa e imposto brasileiros.

### As três perguntas que só o NEXO responde hoje

1. **"Quanto eu lucrei somando todos os canais?"** — o ERP soma faturamento, não lucro; a
   Koncili concilia repasse, não margem.
2. **"Qual canal me dá mais margem no mesmo produto?"** — exige normalizar tarifa, frete e
   imposto de quatro marketplaces no mesmo modelo. É o trabalho mais caro já feito aqui, e
   o mais difícil de copiar. ⚠️ **Hoje vale para Amazon e Mercado Livre**; TikTok e Shopee
   ainda entregam lucro por pedido, não por SKU.
3. **"Por que caiu?"** — em 23/08 o NEXO respondeu sozinho: *"o Mercado Livre zerou as
   vendas porque está com 0 anúncios ativos de 14 cadastrados"*. Nenhum concorrente
   brasileiro faz isso.

---

## 5. O que o NEXO poderia se tornar

### Cenário A — **A camada de decisão sobre o ERP que a pessoa já tem** *(recomendado)*

Conviver, não competir. **O Bling emite a nota, o hub publica o anúncio, o NEXO diz se
valeu a pena.**

- **Por que:** o vendedor brasileiro já paga ERP e não vai trocar. Entrar como camada é
  entrada barata; entrar como substituto é guerra perdida.
- **Preço plausível:** R$ 79–R$ 249/mês por faixa de pedidos — abaixo do ERP, acima do
  sellerboard convertido.
- **Risco:** o Olist chegar antes com o agente de IA que já anunciou.

### Cenário B — **O software de TikTok Shop no Brasil** *(cunha de entrada)*

Primeiro a resolver lucro de TikTok Shop em português.

- **Por que:** vácuo comprovado. A imprensa especializada nem sabe que o canal opera aqui,
  e os americanos não tratam tarifa brasileira.
- **Risco:** canal novo, base pequena, integração ainda dependendo do App review.
- **Leitura:** porta de entrada, não negócio inteiro. Entra pelo TikTok, cresce para os
  quatro.

### Cenário C — **Copiloto de operação** *(o destino, não o começo)*

Responder pergunta aberta: *"se eu baixar o martelo 10%, ainda tenho margem?"*

⚠️ **Ainda não.** Em 23/08 achamos **três lugares** dividindo percentual por base errada.
Dar poder de consulta a um modelo que lê números assim multiplica o erro. Primeiro o
determinístico confiável.

### Cenário D — **Conciliação de repasse** *(competir com a Koncili)*

**Não recomendo como foco.** É a caixa onde há incumbente estabelecido, é trabalho de
auditoria, e o valor percebido é "recuperar o que me devem" — teto baixo comparado a
"vender melhor". Mas **vigiar**: se a Koncili somar custo do produto, vira concorrente
direto da noite para o dia.

---

## 6. Riscos reais

| Risco | Gravidade | Leitura |
|---|---|---|
| **Olist/Bling somarem margem por SKU + IA** | 🔴 Alta | Base instalada e agentes de IA já anunciados. Ameaça nº 1. |
| **Koncili somar custo do produto** | 🔴 Alta | Já lê repasse de seis marketplaces. Falta um campo para virar margem. |
| Aprovações fora do nosso controle | 🟠 Média | Ads pendente desde 13/08; Shopee Go Live e TikTok App review parados. |
| Base de duas contas | 🟠 Média | O produto funciona; falta prova de que alguém paga. |
| Hub adicionar camada de margem | 🟡 Baixa | Foco deles é volume de integração, não profundidade financeira. |
| Custo da IA por cliente | 🟡 Baixa | Uma chamada por dia por workspace, com cache. Previsível. |

---

## 7. Recomendação

**Cenário A como negócio, cenário B como porta de entrada.**

1. **Destravar lucro por SKU no TikTok e na Shopee.** Hoje os dois declaram
   `profitAvailable: false` — *"lucro por SKU não é derivável com segurança do contrato
   canônico atual"*. **Não é falta de custo cadastrado** (isso é dado do vendedor, e todo
   concorrente da categoria exige o mesmo); é o rateio de tarifa entre itens do pedido que
   ainda não fecha nesses dois canais. Enquanto não fechar, o argumento mais forte do
   produto — comparar margem do mesmo SKU entre canais — só vale para Amazon e ML.
2. **Destravar as aprovações** — Ads, Shopee Go Live, TikTok App review. Três frentes
   paradas esperando terceiros.
3. **Um cliente pagante que não seja de vocês.** É o dado que falta.
4. **Só então** o harness de IA.

📌 **O que não fazer agora:** virar ERP, virar hub, competir com Nubimetrics, ou soltar IA
com poder de consulta sobre números que ainda estão sendo corrigidos.

---

## Fontes

**Brasil**

- [Koncili — conciliação financeira de marketplaces](https://www.koncili.com/)
- [Koncili — Central de Parceiros do Mercado Livre](https://centrodepartners.mercadolivre.com.br/apps/koncili)
- [Conciliação financeira em marketplaces e o impacto nas margens (E-Commerce Brasil)](https://www.ecommercebrasil.com.br/artigos/conciliacao-financeira-em-marketplaces-e-o-impacto-silencioso-nas-margens)
- [Os 5 melhores hubs de integração de marketplace em 2026 (Linx)](https://www.linxcommerce.com.br/os-5-melhores-hubs-de-integracao-de-marketplace-em-2026/)
- [Melhores hubs de integração com suporte a múltiplos marketplaces (Base)](https://base.com/pt-BR/blog/melhores-hubs-integracao-marketplaces/)
- [Magis5 — hub de integração](https://magis5.com.br/)
- [Olist ERP (Tiny) 2026 — recursos, integrações e preço](https://gefersonalencar.com.br/2026/08/12/olist-erp-tiny-2026-analise/)
- [Melhor ERP para Marketplace 2026 (GoSmarter)](https://gosmarter.com.br/melhor-erp-para-marketplace/)
- [Como calcular o lucro real no marketplace (GoSmarter)](https://gosmarter.com.br/como-calcular-lucro-real-marketplace/)
- [Nubimetrics — Central de Parceiros do Mercado Livre](https://centrodepartners.mercadolivre.com.br/apps/nubimetrics)
- [Real Trends Brasil](https://www.real-trends.com/br/)

**Referências internacionais** *(régua de produto e preço, não concorrência local)*

- [Sellerboard vs Helium 10 (RevenueGeeks)](https://revenuegeeks.com/sellerboard-vs-helium10/)
- [Sellerboard Review 2026 (BagEngine)](https://bagengine.com/articles/sellerboard-review)
- [How to Track Net Profit on TikTok Shop (HiveHQ)](https://www.hivehq.ai/blog/how-to-track-net-profit-on-tiktok-shop)
- [9 Best Agentic Analytics Tools for Ecommerce (Luca)](https://ask-luca.com/blogs/agentic-analytics-tools)

**Fontes internas:** `docs/estado-atual.md`, `docs/ai-agent-harness.md`, `docs/adr/` (24
decisões), e medições no banco de produção em 23/08/2026.
