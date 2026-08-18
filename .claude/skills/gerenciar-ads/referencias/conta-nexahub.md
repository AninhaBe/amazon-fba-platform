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
- `kitprote-32` — R$ 44,33 de preço contra R$ 38,28 de custo = 13,6% de margem bruta, que a
  comissão de 15% já consome. Ou o custo está errado, ou o preço está.
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
