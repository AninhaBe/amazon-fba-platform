# NEXO — Análise de mercado e benchmark

**23 de agosto de 2026** · Relatório interno · Ana Beatriz e Lucas

---

## Sumário executivo

O NEXO ocupa hoje uma posição que **nenhum concorrente ocupa por inteiro**: lucro real por venda, consolidado entre Amazon, Mercado Livre, Shopee e TikTok Shop, com uma camada de IA que explica *por que* o número mudou.

Cada metade dessa frase existe no mercado. **As duas juntas, não.**

- Quem faz lucro real bem (**sellerboard**) é monocanal Amazon.
- Quem faz multicanal bem (**Bling, Tiny/Olist, Anymarket**) é ERP: trata pedido, nota e estoque — não margem por SKU depois de tarifa, cupom e frete.
- Quem faz inteligência de mercado (**Nubimetrics, Real Trends**) olha para fora, não para dentro da sua operação.
- Quem faz IA agêntica sobre dados (**Luca, Triple Whale Moby**) é do mundo DTC/Shopify e não fala marketplace brasileiro.

⚠️ **E há um dado que vale mais que qualquer análise:** ao pesquisar ferramentas de TikTok Shop, uma publicação especializada de 2026 afirma que *"Brasil e México sinalizaram interesse, mas não há data de lançamento confirmada"*. O NEXO tem **3.501 pedidos reais de TikTok Shop brasileiro** no banco, sincronizando a cada 2 minutos.

O mercado de software ainda não sabe que esse canal existe aqui. **Essa é a janela.**

---

## 1. O que o NEXO é hoje — sem otimismo

Antes de comparar, o retrato factual, medido no código em 23/08/2026:

| | |
|---|---|
| Canais integrados | **4** — Amazon (SP-API), Mercado Livre, Shopee, TikTok Shop |
| Telas | 54 |
| Rotas de API | 71 |
| Linhas de TypeScript | 42.083 |
| Testes automatizados | **559**, todos passando |
| Decisões de arquitetura registradas | 24 ADRs |
| Documentação | 36 documentos |

**O que está de fato no ar e funcionando:**

- Faturamento reconciliado contra o painel do canal, **ao centavo**. Em 23/08 batemos os R$ 493,74 do Seller Central contra o NEXO em três fontes independentes, pedido a pedido, com zero divergência.
- Lucro por venda com tarifa, custo do produto, cupom resgatado e frete separados.
- Radar de estoque com cobertura em dias e velocidade por SKU.
- Curva ABC, calculadora de margem, monitor de repasses.
- Sincronização a cada ~2 minutos nos quatro canais.
- **O NEXO** — camada de IA (Gemini) que lê o banco e narra a operação explicando causas, não só relatando números.

**O que ainda não é:**

- Sem Nota Fiscal, sem expedição, sem etiqueta. **Não é ERP e não pretende ser.**
- Sem gestão de anúncios (a API de Ads da Amazon segue pendente de aprovação desde 13/08).
- Shopee implementada mas aguardando Go Live; TikTok aguardando App review.
- Base instalada: **duas contas reais**. É produto validado tecnicamente, não comercialmente.

---

## 2. O mapa competitivo

### 2.1 Lucro real monocanal — **sellerboard** é o padrão a bater

O concorrente mais perigoso, porque faz exatamente uma coisa e faz bem: dizer quanto sobra depois de tarifa, devolução, armazenagem, PPC e custo do produto.

| | |
|---|---|
| Preço | US$ 15/mês (anual) até 3.000 pedidos; US$ 63/mês em 50.000 |
| Força | profundidade em lucro; barato por pedido (US$ 0,038 a 500 pedidos/mês) |
| Limite | **só Amazon** |

📌 **A leitura que importa:** o preço deles é a âncora do mercado. Um vendedor que já usa sellerboard vai comparar o NEXO com US$ 15/mês, não com o custo de um ERP.

### 2.2 Suíte completa — **Helium 10** e **Jungle Scout**

30+ ferramentas: pesquisa de produto, palavra-chave, listagem, PPC.

| | |
|---|---|
| Preço | de US$ 39 a US$ 399/mês |
| Força | pesquisa de mercado e palavra-chave, onde o NEXO é fraco |
| Limite | reconhecidamente rasos em lucro — *"deixam lacunas que ferramentas especializadas preenchem melhor"* |

Muitos vendedores rodam **Helium 10 + sellerboard juntos**. Isso é sintoma: ninguém resolve os dois lados.

### 2.3 ERP e hub brasileiro — **Bling, Tiny/Olist, Anymarket**

O que a maioria dos vendedores brasileiros já paga.

| | |
|---|---|
| Preço (Tiny/Olist) | R$ 59 a R$ 849/mês, quatro faixas |
| Força | nota fiscal, estoque, expedição, integração com dezenas de canais |
| Limite | **operação, não decisão**. Conciliar repasse e apurar margem por SKU é onde eles são fracos |

⚠️ **Movimento a vigiar:** o Olist já lançou agentes de IA que deixam o usuário "conversar com os dados". É exatamente a direção do NEXO, vindo de quem tem base instalada. **É a maior ameaça deste relatório.**

### 2.4 Inteligência de mercado — **Nubimetrics** e **Real Trends**

Olham o mercado do Mercado Livre: o que vende, quem vende, a que preço, em sete países.

**Não competem com o NEXO** — competem com a aba de Pesquisa. São complementares, e vendedores sérios usam junto.

### 2.5 IA agêntica sobre dados — **Luca, Triple Whale Moby, Polar**

A categoria que mais se parece com onde o NEXO quer chegar: uma camada que encontra a causa por trás de um número e empurra o achado.

📌 **E aqui está a frase mais importante que a pesquisa devolveu:**

> *"Marketplace tooling stays largely pre-agentic in 2026."*

Ou seja: o ferramental de marketplace segue **pré-agêntico**. A IA que raciocina sobre dados de venda existe — no mundo Shopify/DTC americano. Marketplace, e muito menos marketplace brasileiro, ainda não tem.

### 2.6 TikTok Shop — o vácuo

| | |
|---|---|
| O problema reconhecido | o Seller Center **não mostra lucro líquido**: não sabe custo, embalagem, comissão de afiliado nem margem por SKU |
| Tamanho do erro | a receita real pode ficar **18% a 35% abaixo do GMV** depois de tarifa, devolução e comissão |
| Quem atende | HiveHQ, Kixmon, Dashboardly — **todos americanos**, nenhum fala português ou entende tarifa brasileira |

---

## 3. Onde o NEXO se encaixa

```
                    MONOCANAL                  MULTICANAL
                 +-------------------+   +----------------------+
   OPERAÇÃO      |                   |   | Bling, Tiny/Olist,   |
   (NF, estoque) |                   |   | Anymarket            |
                 +-------------------+   +----------------------+
   DECISÃO       | sellerboard       |   |                      |
   (lucro,       | Helium 10         |   |        NEXO          |
    margem)      |                   |   |                      |
                 +-------------------+   +----------------------+
```

**O quadrante inferior direito está vazio.** Lucro real por SKU, atravessando quatro canais, em português, com as regras fiscais e tarifárias brasileiras.

### As três perguntas que só o NEXO responde hoje

1. **"Quanto eu lucrei no total, somando todos os canais?"** — o ERP soma faturamento, não lucro; o sellerboard só vê Amazon.
2. **"Qual canal me dá mais margem no mesmo produto?"** — exige normalizar tarifa, frete e imposto de quatro marketplaces no mesmo modelo. É o trabalho mais caro que já foi feito aqui, e o mais difícil de copiar.
3. **"Por que caiu?"** — em 23/08 o NEXO respondeu sozinho: *"o Mercado Livre zerou as vendas porque está com 0 anúncios ativos de 14 cadastrados"*. Nenhum concorrente brasileiro faz isso.

---

## 4. O que o NEXO poderia se tornar

### Cenário A — **Camada de lucro multicanal** *(recomendado)*

Ser o que o sellerboard é para a Amazon, mas para os quatro canais brasileiros. Conviver com o ERP em vez de competir: **o Bling emite a nota, o NEXO diz se valeu a pena.**

- **Por que:** é o que já está construído. Falta distribuição, não produto.
- **Preço plausível:** R$ 79–R$ 249/mês por faixa de pedidos, ancorado abaixo do ERP e acima do sellerboard convertido.
- **Risco:** o Olist chegar antes com o agente de IA que já anunciou.

### Cenário B — **O software de TikTok Shop no Brasil**

Ser o primeiro a resolver lucro de TikTok Shop em português.

- **Por que:** o vácuo é comprovado — a imprensa especializada nem sabe que o canal opera aqui, e os americanos não atendem tarifa brasileira.
- **Risco:** canal novo, base pequena, e a integração ainda depende do App review.
- **Leitura:** é uma **cunha de entrada**, não um negócio inteiro. Entra pelo TikTok, cresce para os quatro.

### Cenário C — **Copiloto de operação** *(o destino, não o começo)*

O NEXO deixa de narrar e passa a responder pergunta aberta: *"se eu baixar o martelo 10%, ainda tenho margem?"*.

⚠️ **Ainda não.** O `docs/ai-agent-harness.md` já registra o porquê: em 23/08 achamos **três lugares** dividindo percentual por base errada. Dar poder de consulta a um modelo que lê números assim multiplica o erro em vez de corrigi-lo. Primeiro o determinístico confiável — que é o trabalho que vem sendo feito.

### Cenário D — **Inteligência de mercado**

Competir com Nubimetrics. **Não recomendo.** Exige capturar dado de mercado inteiro, é outro negócio, e o ativo do NEXO é o dado interno do vendedor.

---

## 5. Riscos reais

| Risco | Gravidade | Leitura |
|---|---|---|
| **Olist/Bling adicionarem lucro por SKU + IA** | 🔴 Alta | Têm base instalada e já anunciaram agentes de IA. É a ameaça número um. |
| Dependência de aprovação de terceiros | 🟠 Média | Ads API pendente desde 13/08; Shopee Go Live e TikTok App review parados. Nada disso está sob controle. |
| Base instalada de duas contas | 🟠 Média | O produto funciona; falta prova de que alguém paga. |
| sellerboard abrir para marketplace BR | 🟡 Baixa | Foco declarado em Amazon; entrada exigiria regra fiscal brasileira. |
| Custo da IA por cliente | 🟡 Baixa | Hoje uma chamada por dia por workspace, com cache. Escala linearmente e é previsível. |

---

## 6. Recomendação

**Cenário A como negócio, cenário B como porta de entrada.**

Ordem sugerida:

1. **Fechar o básico do TikTok** — 20 SKUs vendidos e **zero com custo cadastrado**. O motor de lucro já existe; falta o cadastro. Menor esforço, maior efeito.
2. **Destravar as aprovações** — Ads, Shopee Go Live, TikTok App review. Tudo depende de terceiros, e três frentes estão paradas esperando.
3. **Provar com um cliente pagante que não seja de vocês.** É o dado que falta.
4. **Só então** o harness de IA — quando os números que ele lê forem confiáveis.

📌 **O que não fazer agora:** competir com ERP, competir com Nubimetrics, ou soltar IA com poder de consulta sobre números que ainda estão sendo corrigidos.

---

## Fontes

- [Sellerboard vs Helium 10 (RevenueGeeks)](https://revenuegeeks.com/sellerboard-vs-helium10/)
- [Helium 10 vs sellerboard (G2)](https://g2.com/compare/helium-10-vs-sellerboard)
- [Sellerboard Review 2026 (BagEngine)](https://bagengine.com/articles/sellerboard-review)
- [Olist ERP (Tiny) 2026 — recursos, integrações e preço](https://gefersonalencar.com.br/2026/08/12/olist-erp-tiny-2026-analise/)
- [Melhor ERP para Marketplace 2026 (GoSmarter)](https://gosmarter.com.br/melhor-erp-para-marketplace/)
- [Nubimetrics — Central de Parceiros do Mercado Livre](https://centrodepartners.mercadolivre.com.br/apps/nubimetrics)
- [Real Trends Brasil](https://www.real-trends.com/br/)
- [How to Track Net Profit on TikTok Shop (HiveHQ)](https://www.hivehq.ai/blog/how-to-track-net-profit-on-tiktok-shop)
- [15 Best TikTok Shop Tools 2026 (Dashboardly)](https://www.dashboardly.io/post/best-tiktok-shop-tools)
- [9 Best Agentic Analytics Tools for Ecommerce (Luca)](https://ask-luca.com/blogs/agentic-analytics-tools)
- [Painel do Seller Shopee 2026 (GoSmarter)](https://gosmarter.com.br/painel-seller-shopee-2026-metricas/)

**Fontes internas:** `docs/estado-atual.md`, `docs/ai-agent-harness.md`, `docs/adr/` (24 decisões), e medições no banco de produção em 23/08/2026.
