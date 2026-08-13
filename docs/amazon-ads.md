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
| Manual Exata - Martelo Borracha | `A01357752UOKBP340AQ6T` | `B0HBGQNBD4` | manual, 8 palavras exatas | R$ 0,35–0,90 | R$ 10 |
| Auto - Clips 320 | `A09432513MF2JZKXFKXGB` | `B0HBGLBL6Y` | automática | R$ 0,35 | R$ 15 |
| Auto - Protetor Kit 8 | `A06494282F1XLCQPDJD30` | `B0H9SFW8KR` | automática | R$ 0,35 | R$ 10 |

As 8 palavras da manual do martelo são as **mesmas** bloqueadas como negativa exata na
automática — é o que impede o par de disputar o próprio clique. Se migrar termos novos
para a manual, negativar na automática **na mesma hora**.

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
| Auto - Martelo | R$ 0,35 | **R$ 0,84** | R$ 0,84 |
| Auto - Clips 320 | R$ 0,35 | **R$ 0,61** | R$ 0,61 |
| Auto - Protetor Kit 8 | R$ 0,35 | **R$ 1,29** | R$ 1,29 |
| Manual Exata - Martelo | — | inalterada | — |

O orçamento **não** foi aumentado: teto é rede de proteção, e aumentá-lo com 1% de
uso não destrava volume nenhum. Só mexer quando o gasto encostar em ~50% do teto.

`Ajuste de lance para o topo da pesquisa` segue em **0%** nas quatro. É o
multiplicador mais caro e compra posição, não aprendizado — só depois de o CTR
provar conversão.

⚠️ **A margem que sustenta esses lances depende da tarifa zerada.** A promoção
"O FBA agora é GRÁTIS" está ativa e é temporária. Com ela, martelo tem R$ 37,38 de
margem, clips R$ 13,08 e protetor R$ 12,54. Quando acabar, clips e protetor ficam
apertados nesses preços — o plano de subir preço deixa de ser oportunidade e vira
necessidade. Conferir a data de término no card do Seller Central.

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
