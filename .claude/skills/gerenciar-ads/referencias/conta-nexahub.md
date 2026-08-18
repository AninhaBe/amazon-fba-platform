# A conta NEXAHUB BR

`merchantId AO62LVXJMX3AA` · `entityId ENTITY16D5M3ZYVBEMC` · login `admin@sellercore.test`

⚠️ **Nunca usar `A15NQMF7A6J1Y0`** — é a conta do colega. O acesso autorizado a ela é
**somente leitura**, e nunca para Ads.

---

## Campanhas no ar (criadas em 12–13/08/2026)

Todas Sponsored Products · **lances dinâmicos somente redução** · ajuste por canal 0% ·
início 12/08 · sem data de término.

| Campanha | ID | ASIN | Segmentação | Orçamento |
|---|---|---|---|---|
| Auto - Martelo Borracha | `A09902661J0ZF8TYDHJC8` | `B0HBGQNBD4` | automática (1 negativa exata) | R$ 15 |
| Manual - Martelo Borracha | `A01357752UOKBP340AQ6T` | `B0HBGQNBD4` | Exata (8) + Frase (10) | R$ 10 |
| Auto - Clips 320 | `A09432513MF2JZKXFKXGB` | `B0HBGLBL6Y` | automática | R$ 15 |
| Manual - Clips 320 | `A01608831T9MN9I9KPAYF` | `B0HBGLBL6Y` | Exata (14) + Frase (14) | R$ 10 |
| Auto - Protetor Kit 8 | `A06494282F1XLCQPDJD30` | `B0H9SFW8KR` | automática | **R$ 5** (cortado em 16/08) |
| Manual - Protetor Kit 8 | `A06695151U462T3OKRJIU` | `B0H9SFW8KR` | Exata (12) + Frase (12) | R$ 10 |

**Total: 6 campanhas, R$ 65/dia** de teto.

**Não anunciados:**
- `kitprote-32` — R$ 44,33 de preço contra R$ 38,28 de custo = **R$ 6,05 (13,6%)**.
  ⚠️ A decisão de não anunciar veio de assumir 15% de comissão, o que tornaria a margem
  negativa. **Com a comissão zerada de hoje, a margem é positiva** — reavaliar se vale
  anunciar enquanto a promoção durar. O custo de R$ 38,28 continua alto demais para o
  preço; vale conferir se está certo.
- `kitprote-16` — **sem custo cadastrado**, então a margem é desconhecida.

---

## Margens

### 🔴 Hoje esta conta NÃO paga comissão nem tarifa de FBA

**Verificado na Transactions API em 17/08/2026.** Uma venda real do `kitprote-8` devolve
uma linha só:

```
Pedido R$ 44,22
  ProductCharges → OurPricePrincipal   R$ 22,11
```

Não existe lançamento de `Commission` nem de `FBAPerUnitFulfillmentFee`. O vendedor recebe
o preço cheio.

📌 **Não repetir o erro de assumir 15% de comissão.** Já errei duas vezes com isso: disse a
ela que "paga comissão" e calculei o `kitprote-32` como margem **negativa** de R$ 0,60
quando na verdade é **+R$ 6,05** (44,33 − 38,28). Ela corrigiu as duas vezes.

**Como conferir sem discutir:** puxar `/finances/2024-06-19/transactions` e olhar os
`breakdownType` presentes. ⚠️ O campo do valor é `breakdownAmount.currencyAmount`, **não**
`.amount` — usar o nome errado devolve 0,00 em tudo e parece que não há cobrança nenhuma.

⚠️ **Isso é temporário** (promoção de vendedor novo). Quando acabar, TODA margem desta
página muda e os lances precisam ser recalculados. Conferir a data de término no card do
Seller Central.

⚠️ **Estas margens dependem da tarifa zerada.** A promoção "O FBA agora é GRÁTIS" (vendedor
novo) está ativa e é **temporária**. Quando acabar, clips e protetor ficam apertados nestes
preços. Conferir a data de término no card do Seller Central antes de decidir lance com
base em margem.

| Produto | Preço | Custo | Margem |
|---|---|---|---|
| **martelo-borracha** | R$ 27,90 *(ver histórico)* | R$ 5,84 | R$ 22,06 |
| kit-clips-320 | R$ 22,11 | R$ 6,82 | R$ 15,29 |
| kitprote-8 | R$ 22,11 | R$ 9,57 | R$ 12,54 |

⚠️ **O cupom de 10% (09/08–08/09) só desconta se o comprador resgatar** — e a taxa de
resgate nesta conta é **R$ 0,00**. O pedido de 15/08 do clips saiu a R$ 22,11 **cheio**.
**Não assumir o preço com cupom ao calcular margem: usar o valor do pedido.**

⚠️ **Cupom não aparece na Pricing API** — o preço que ela devolve é o cheio.

### Histórico de preço do martelo

| Data | Preço | Motivo |
|---|---|---|
| até 14/08 | R$ 43,22 | preço original |
| 15/08 | R$ 31,90 | `competitiveSummary` mostrou que era o mais caro de oito |
| **16/08 ~12h20** | **R$ 27,90** | segunda queda; submissionId `1d5af093f66545e0872d3675f569c9eb` |

**Resultado medido:** CTR da `Manual - Martelo` foi de **1,27% → 6,78%**. Preço estava
descartado como causa a partir daí.

📌 **A especificação real do nosso martelo** (`B0HBGQNBD4`, via `catalog/2022-04-01` com
`includedData=attributes,dimensions`): cabeça **7,5 × 24,5 cm · 250 g**, cabo de madeira,
cabeça maciça preta. Por **peso** o comparável é o MTX 225g (R$ 15–17) — sugere que estamos
caros. Por **cabeça** (75 mm) seríamos o maior de todos (Vonder vai até 50 mm a R$ 34,90) —
sugere o contrário. **A comparação é ambígua, não conclusiva.**

---

## O gargalo real do martelo

Com preço, anúncio e página já testados, o que sobra:

- **Zero avaliação.** Martelo de borracha é commodity; sem prova social perde para marca
  conhecida no empate.
- **Sem marca** (`Genérico`, por decisão dela: buy box fechada) contra Vonder e MTX,
  estabelecidas.
- **BSR vazio** — sem posição de vendas na categoria ainda.

**Amazon Vine é a alavanca seguinte, e está bloqueada:** exige Brand Registry. Decidir se
vale registrar marca é a decisão que destrava isso — e destrava também o NBB (R$ 300 mil em
crédito como 5% de desconto na comissão).

---

## Créditos de publicidade

**Incentivos para Novos Vendedores** (`GXMJ38VA95GUN5XU`) — **não exige Brand Registry**, é
o único benefício do programa que esta conta alcança.

| Você gasta em Sponsored Products | Recebe de crédito |
|---|---|
| R$ 265 – R$ 1.059,99 | R$ 265 |
| R$ 1.060 – R$ 5.299,99 | **R$ 1.060** |
| R$ 5.300 ou mais | R$ 5.300 |

📌 **Os degraus são fixos, não proporcionais.** Gastar R$ 1.059 rende R$ 265; gastar
R$ 1.060 rende R$ 1.060. **Vale planejar o gasto para cruzar o degrau**, não parar rente a
ele.

**Prazos:** usar Sponsored Products dentro de **90 dias** da primeira oferta comprável; o
crédito aparece em até 2 semanas após cumprir o requisito, e há **apenas 30 dias para
gastá-lo**.

⚠️ **A data exata da primeira oferta comprável continua não confirmada** — está na página
do programa no Seller Central, e é ela que define o prazo real.

**Ritmo necessário para o degrau de R$ 1.060:** ~R$ 11,80/dia em 90 dias.

| Data | Gasto acumulado | Ritmo |
|---|---|---|
| 14/08 | R$ 10,79 | R$ 3,60/dia — 1/3 do alvo |
| 16/08 | R$ 54,73 | R$ 10,19/dia — 86% do alvo |
| 16/08 (só o dia) | R$ 12,63 | **acima do alvo** |

---

## Ligações com o NEXO

- **Margem por produto** (`/produtos` + curva ABC) é o **teto do ACOS aceitável**.
- **Histórico de ranking** (ADR-009/011) mostra o efeito do anúncio no BSR — a campanha
  deveria empurrar a posição para baixo (melhor) em poucos dias.
- **Histórico de oferta** (ADR-010) explica queda de veiculação por ruptura de estoque.

## Fontes

- `docs/amazon-ads.md` — levantamento da conta, créditos, campanhas no ar
- `docs/amazon-ads-especialista.html` / `.pdf` — 18 páginas: leilão, correspondências,
  matemática do lance, colheita, benchmarks 2026, COSMO/Rufus, glossário PT↔EN
- `docs/amazon-politicas.md` — título ≤75 chars, capa fundo branco sem texto
- [Guia de conceitos básicos](https://advertising.amazon.com/pt-br/library/guides/getting-started-with-sponsored-ads)
- [Guia para novos anunciantes](https://advertising.amazon.com/pt-br/library/guides/new-advertiser-success-guide)
- [Políticas de anúncios patrocinados](https://advertising.amazon.com/pt-br/resources/ad-policy/sponsored-ads-policies)

---

## Reprecificação da linha de protetores — 18/08/2026, ~00h30

Disparada por ela: *"38,28 é o preço de custo, não faz sentido ficar sem margem"*. Estava
certa — e o problema não era o custo.

**O custo por unidade é idêntico entre os kits** (`9,57÷8 = 38,28÷32 = R$ 1,196`). O
cadastro estava coerente. **O que quebrava era a escada de preços.**

| un | Antes | R$/un | Problema |
|---|---|---|---|
| 8 | 22,11 | 2,76 | ok |
| 16 | 43,22 | 2,70 | 6 centavos de desconto sobre o kit de 8 — não incentiva subir |
| 24 | 45,90 | 1,91 | colado no de 16: R$ 2,68 a mais por 8 unidades a mais |
| 32 | 44,33 | 1,39 | 🔴 **mais barato que o de 24** — inversão |

### Concorrência (preço FBA por unidade, medido em 17/08)

| un | Nós (antes) | Concorrentes |
|---|---|---|
| 8 | 2,76 | 1,24 · 2,38 · 3,03 · 3,54 · 5,11 |
| 16 | 2,70 | 0,87 · 1,31 · 3,21 · 4,37 · 4,49 · 6,55 |
| 24 | **1,91** | 2,46 · 2,50 · 2,92 — **éramos o mais barato de todos** |
| 32 | **1,39** | 2,50 (concorrente direto a R$ 79,99) |

⚠️ Descartado: um kit de 32 a R$ 18,90 que é **feltro adesivo**, não capa de silicone.
**Comparar só equivalente** — a lição do martelo.

### Aplicado

| SKU | De | Para | R$/un | submissionId |
|---|---|---|---|---|
| kitprote-16 | 43,22 | **37,90** | 2,37 | `93e7e5e4772d490a9ef977e1cca9b354` |
| kitprote-24 | 45,90 | **51,90** | 2,16 | `73ddc89467ca4c04bcb74d8cd3e7f3a3` |
| kitprote-32 | 44,33 | **59,90** | 1,87 | `50620737271c48d1b74144b004bcfd6d` |

Margem do kit 32: R$ 6,05 → **R$ 21,62 (36%)**, ainda 25% abaixo do concorrente direto.

📌 **Lição:** quando a margem de um SKU não fecha, conferir **preço por unidade em toda a
linha** antes de culpar o custo. Custo proporcional entre tamanhos indica cadastro certo;
preço que não escala junto indica tabela mal montada.

⚠️ **`kitprote-16` continua sem custo cadastrado** — margem desconhecida.

### Como mudar preço pela API

```
PATCH /listings/2021-08-01/items/{seller}/{sku}?marketplaceIds={mp}
{ "productType": "<ler do proprio SKU, nao assumir>",
  "patches": [{ "op":"replace", "path":"/attributes/purchasable_offer",
    "value":[{ "currency":"BRL", "marketplace_id":"<mp>", "audience":"ALL",
               "our_price":[{"schedule":[{"value_with_tax": 59.90}]}] }] }] }
```

Rodar com `&mode=VALIDATION_PREVIEW` antes (devolve `status: VALID`) e só então aplicar.
Propagação da oferta leva **~2h**.

### Vendas por SKU em 45 dias (contexto da decisão)

| SKU | Pedidos | Unid |
|---|---|---|
| kit-clips-320 | 6 | 6 |
| kitprote-8 | 2 | 3 |
| kitprote-32 | 1 | 1 |
| martelo-borracha | 1 | 1 |

📌 Os kits 16/24/32 **não têm campanha e quase não vendem**. Subir o preço deles custa
pouco em ranqueamento, porque não estavam ranqueando. O que rankeia hoje é onde há
tráfego: clips, kitprote-8 e martelo.

---

## 🎯 Preços-alvo e a escada de subida

**Fonte: DANFE da remessa ao FBA, 02/08/2026** (`Remessa para Depósito Temporário`,
NF 000.000.001 série 420, chave `3526 0866 1062 0200 0120 5542 0000 0000 0111 3680 6269`,
total R$ 10.158,10 / 279 unidades).

⚠️ **Os valores unitários dessa nota são o PREÇO DE VENDA PRETENDIDO**, confirmado por ela
em 18/08. **Não são custo** — os custos cadastrados são muito menores (kitprote-8: nota
R$ 47,90 × custo R$ 9,57).

📌 Reforço externo: o kit 32 está na nota a **R$ 78,90**, e o concorrente FBA equivalente
vende a **R$ 79,99**. O alvo bate com o mercado.

| SKU | Alvo (nota) | Em 18/08 | Falta |
|---|---|---|---|
| kit-clips-320 | 19,90 | **22,11** | ✅ já passou do alvo |
| kitprote-16 | 38,90 | 37,90 | −3% |
| martelo-borracha | 38,90 | 27,90 | +39% |
| kitprote-32 | 78,90 | 59,90 | +32% |
| kitprote-8 | 47,90 | **24,90** | +92% |

### A estratégia dela, nas palavras dela

> *"vender mais barato pra atrair vendas e ir subindo no algoritmo, e com isso, ir
> aumentando aos poucos o preço"*

Preço de entrada baixo → volume → ranqueamento → **sobe o preço aos poucos**.

⚠️ **Eu errei contra isso em 18/08**, subindo três preços no dia 11 da lua de mel com
lógica de maturidade. Ela corrigiu. **Fase de lançamento inclina para conversão, não para
margem** — ver capítulo 25 do guia `amazon-ads-do-zero-ao-especialista`.

### O gatilho para cada degrau

Não é tempo. São **três condições juntas**:

1. Vendas constantes por **7 dias seguidos** no preço atual
2. **Conversão mantida** — se a CVR cair mais de um terço, subiu demais: voltar
3. Idealmente uma avaliação nova desde o último degrau

**Tamanho do degrau: 10–15%.** Nunca saltar direto ao alvo — mata a conversão que
comprou o ranqueamento.

### A prova de que funciona

O **kit-clips-320** subiu de R$ 19,90 → R$ 22,11 e **continuou convertendo a 25–40%**,
o dobro do benchmark. É a evidência local de que subir preço com ranqueamento consolidado
não derruba a conversão.

### Aplicado em 18/08/2026

| SKU | De | Para | % | submissionId |
|---|---|---|---|---|
| kitprote-8 | 22,11 | **24,90** | +12,6% | `9d94b844e11045178e071c81f1946c71` |

Escolhido por ter o maior gap para o alvo (+117%) **e** o melhor ROAS da conta (15,11 na
`Auto - Protetor Kit 8`) — vendia bem justamente por estar barato demais.

⛔ **Não mexer agora:** `martelo` (preço acabou de cair para destravar teste) e
`kitprote-32` (acabou de subir). Os dois precisam de dado limpo antes do próximo degrau.

### Estoque em 18/08 (para dimensionar o faturamento)

| SKU | Vendável | +trânsito | Preço | Valor |
|---|---|---|---|---|
| martelo | 118 | 1 | 27,90 | R$ 3.320 |
| kit-clips-320 | 89 | 1 | 22,11 | R$ 1.990 |
| kitprote-32 | 15 | 2 | 59,90 | R$ 1.018 |
| kitprote-8 | 31 | 6 | 24,90 | R$ 921 |
| kitprote-16 | 2 | 0 | 37,90 | R$ 76 |

**265 unidades.** Aos preços atuais ≈ R$ 7.325; **aos preços-alvo ≈ R$ 10.158**.
A diferença de ~R$ 2.900 é exatamente o que a escada de preços vai capturar.

⚠️ `kitprote-16` com **2 unidades** — vai romper. Ruptura derruba ranqueamento (ver guia
orgânico, cap. 23).
