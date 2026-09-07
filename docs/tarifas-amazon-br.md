# Tarifas da Amazon Brasil — regra oficial para estimar tarifa de pedido

**Por que este arquivo existe.** Enquanto a Amazon não posta a tarifa oficial de um
pedido (pendente ou recém-confirmado), o NEXO estima a tarifa pela **regra publicada
pela própria Amazon** — permitido pela exceção nomeada do
[ADR-027](adr/ADR-027-tarifa-estimada-ate-a-liquidacao.md). Este arquivo versiona
essa regra com fonte e data de captura. Quando a Amazon mudar a tabela, atualize
aqui **com data** e registre no changelog no fim.

Ordem de preferência das fontes de estimativa (implementada em
`src/lib/integrations/amazonTarifaEstimada.ts`): **observada > tabela > api**.
Este arquivo é a fonte da modalidade **tabela**.

---

## 1. Comissão (tarifa de indicação) por categoria

**Fonte:** https://venda.amazon.com.br/precos (página pública)
**Capturado em:** 01/09/2026 — leitura direta da página ao vivo, verbatim.
(A versão de 31/08 deste arquivo continha erros de reconstrução — ver changelog.)

O percentual incide sobre o **preço total de venda do produto (preço final do
comprador)**, com **tarifa mínima por item** — cobra-se
`max(percentual × preço, mínimo)`.

| Categoria | Comissão | Mínimo por item |
|---|---|---|
| Comidas e bebidas | 10% | R$ 1,00 |
| Eletrodomésticos de linha branca | 11% | R$ 1,00 |
| Saúde e cuidados pessoais | 12% | R$ 1,00 |
| Bebidas alcoólicas | 11% | R$ 1,00 |
| Pneus e rodas | 10% | R$ 1,00 |
| Indústria e Ciência | 12% | R$ 2,00 |
| Produtos para bebês | 12% | R$ 2,00 |
| Produtos para animais de estimação | 12% | R$ 2,00 |
| Eletroportáteis de cuidado pessoal | 12% | R$ 2,00 |
| Cozinha | 12% | R$ 2,00 |
| Jardim e Piscina | 12% | R$ 2,00 |
| Brinquedos e jogos | 12% | R$ 2,00 |
| TV, áudio e cinema em casa | 10% | R$ 2,00 |
| PC | 12% | R$ 2,00 |
| Eletrônicos portáteis | 13% | R$ 2,00 |
| Peças e acessórios automotivos | 12% | R$ 2,00 |
| Casa | 12% | R$ 2,00 |
| Beleza | 13% | R$ 2,00 |
| Beleza de luxo | 14% | R$ 2,00 |
| Celulares | 11% | R$ 2,00 |
| Câmera e fotografia | 11% | R$ 2,00 |
| Videogames e consoles | 11% | R$ 2,00 |
| Esportes, aventura e lazer | 12% | R$ 2,00 |
| Ferramentas e Construção | 11% | R$ 2,00 |
| Papelaria e Escritório | 13% | R$ 2,00 |
| Bagagem e acessórios de viagem | 14% | R$ 2,00 |
| Roupas e acessórios | 14% | R$ 2,00 |
| Calçados, bolsas e óculos escuros | 14% | R$ 2,00 |
| Relógios | 13% | R$ 2,00 |
| Joias | 14% | R$ 2,00 |
| Livros | 15% | R$ 2,00 |
| Acessórios para eletrônicos e para PC | 15% até R$ 100,00; 10% no excedente | R$ 2,00 |
| Móveis | 15% até R$ 200,00; 10% no excedente | R$ 2,00 |
| Vídeo e DVD | 15% | R$ 2,00 |
| Música (CDs, LPs etc.) | 15% | R$ 2,00 |
| Instrumentos musicais e acessórios | 12% | R$ 2,00 |
| Demais categorias | 15% | R$ 2,00 |

⚠️ **Regra de implementação combinada com o backend:** o mapeamento
categoria→percentual é **explícito** — categoria não mapeada **não** cai
automaticamente em "demais 15%"; ela fica sem estimativa (null) e aparece
apontada na tela. Fallback silencioso esconderia categoria errada.

### Divergência aberta: a página diz 13%, o extrato mediu 12%

Medição do backend em 01/09/2026, sobre comissões REAIS decompostas (pedidos de
uma linha, preço conhecido, janela de 60 dias):

| Categoria (nossa raiz) | Efetiva medida | Página hoje |
|---|---|---|
| Papelaria e Escritório | 12,03% (1.274 pedidos) | 13% |
| Beleza | 12,01% (103) | 13% |
| Roupas/Moda | 14,03% (701) | 14% ✓ |
| Ferramentas | 11,56% (283) | 11% (≈, raiz mistura folhas) |
| Cozinha / Saúde / Jardim / Pet / Brinquedos | 12,0x% | 12% ✓ |

Hipóteses (não resolvidas): tarifa promocional/negociada da conta, mudança
recente da página, ou a nossa raiz de classificação não corresponde à categoria
de cobrança da Amazon. **A ordem `observada > tabela` protege o caso**: ASIN com
histórico usa o percentual que a Amazon de fato cobrou; a tabela só alcança ASIN
sem histórico, onde o número publicado hoje (13%) é o melhor disponível — e a
primeira venda real substitui.

## 2. Tarifa de logística FBA (por unidade)

**Fonte:** https://sellercentral.amazon.com.br/help/hub/reference/201112670?locale=pt-BR
(Seller Central → "Tarifas de logística do FBA para pedidos da Amazon";
exige login de vendedor)
**Capturado em:** 01/09/2026, na sessão da conta NEXAHUB BR

Cobrada **por unidade**, com base em **preço, peso e dimensões** do produto.

### 2.1 Tabela (R$ por unidade)

Para preço **abaixo de R$ 79**, a tarifa é **fixa por faixa de preço,
independente do peso** (célula mesclada na tabela original):

| Faixa de preço | Tarifa |
|---|---|
| < R$ 30 | 5,65 |
| R$ 30 a 49,99 | 5,85 |
| R$ 50 a 78,99 | 6,05 |

Para preço **R$ 79 ou mais**, varia por peso e faixa de preço:

| Peso | 79–99,99 | 100–119,99 | 120–149,99 | 150–199,99 | > 200 |
|---|---|---|---|---|---|
| 0 a 100 g | 10,05 | 12,05 | 14,05 | 15,05 | 15,55 |
| 100 a 200 g | 10,45 | 12,45 | 14,45 | 15,45 | 16,05 |
| 200 a 300 g | 10,95 | 12,95 | 14,95 | 15,95 | 16,55 |
| 300 a 400 g | 11,45 | 13,45 | 15,45 | 16,95 | 17,15 |
| 400 a 500 g | 11,95 | 13,95 | 15,95 | 17,05 | 17,85 |
| 500 a 750 g | 12,05 | 14,05 | 16,05 | 18,45 | 18,55 |
| 750 g a 1 kg | 12,45 | 14,45 | 16,45 | 19,05 | 19,25 |
| 1 a 1,5 kg | 12,95 | 14,95 | 16,95 | 19,45 | 20,35 |
| 1,5 a 2 kg | 13,05 | 15,05 | 17,05 | 19,95 | 21,35 |
| 2 a 3 kg | 14,05 | 16,05 | 18,05 | 20,05 | 22,35 |
| 3 a 4 kg | 15,05 | 17,05 | 19,05 | 21,95 | 23,35 |
| 4 a 5 kg | 16,05 | 18,05 | 20,05 | 22,95 | 24,35 |
| 5 a 6 kg | 24,05 | 27,05 | 29,05 | 30,05 | 30,35 |
| 6 a 7 kg | 25,05 | 28,05 | 30,05 | 31,05 | 33,35 |
| 7 a 8 kg | 26,05 | 29,05 | 31,05 | 32,05 | 35,35 |
| 8 a 9 kg | 27,05 | 30,05 | 32,05 | 33,05 | 37,35 |
| 9 a 10 kg | 35,05 | 40,05 | 46,05 | 51,05 | 51,35 |
| Kg adicional | 3,05 | 3,05 | 3,05 | 3,50 | 3,50 |

### 2.2 Regras de cálculo do peso (verbatim da página)

- **Peso para tarifa = maior entre peso unitário e peso dimensional + 20 g de
  embalagem** (peso de embalagem padronizado pela Amazon).
- **Peso dimensional** = comprimento × largura × altura em cm ÷ 6.000 (IATA).
- Em divergência entre a medida do vendedor e a da Amazon, **vale a da Amazon**.
- Limite: produtos até 22 kg; embalagem até 105×105×105 cm, soma ≤ 200 cm.
- Todas as tarifas **já incluem impostos**.

⚠️ A página também diz "total arredondado para cima para o quilograma inteiro
mais próximo", o que conflita com as faixas sub-quilo da própria tabela. E o
exemplo 3 da página (12,62 kg, faixa 150–199,99) dá R$ 61,85, enquanto a
tabela lida literalmente dá 51,05 + 3×3,50 = 61,55. **Interpretação a validar
contra tarifas observadas** — na dúvida, a fonte `observada` (tarifa que a
Amazon de fato cobrou naquele ASIN) tem precedência sobre a tabela.

### 2.3 Promoção vigente (afeta a conta da Ana)

A partir de **01/08/2026**, renovável mensalmente até 31/01/2027: **isenção de
100% das tarifas de logística, coleta e armazenagem nos primeiros 30 dias**
para novos vendedores FBA; depois, tarifa fixa de logística para preço ≥ R$ 79
e isenção de coleta/armazenagem, condicionado a investir ≥ 3,5% da receita em
Amazon Ads. **É por isso que as tarifas FBA observadas na conta podem ser
menores que a tabela (ou zero)** — mais um motivo para `observada > tabela`.

### 2.4 Outras tarifas FBA (registro, não entram na estimativa por pedido)

- **Remoção:** R$ 0,99–3,60/unidade por faixa de peso (+R$ 0,17/kg adicional).
- **Armazenagem:** R$ 75,00/m³ (volume < 0,01 m³) ou R$ 37,50/m³ (≥ 0,01 m³),
  média diária, cobrada no mês seguinte.
- **Armazenagem a longo prazo:** R$ 525,00/m³ para inventário > 365 dias.

---

## Changelog observado

- **07/09/2026** — **Primeiras tarifas FBA cobradas na conta.** Medição de
  `finances/2024-06-19/transactions`, janela de 90 dias (série começa em
  10/08/2026): 59 pedidos postados, todos `AFN` confirmados por `orders/v0/orders`
  (72 de 72). Comissão **R$ 0,00 em 59 de 59** — não existe linha `Commission`.
  `FBAPerUnitFulfillmentFee` cobrada em **2 de 59**, R$ 5,65 cada, ambas no SKU
  `kitprote-8` (ASIN `B0H9SFW8KR`, preço R$ 21,90), em **05/09 e 06/09** — as
  primeiras de toda a série; agosto teve 43 pedidos e nenhuma. Total de tarifas:
  R$ 16,08 sobre R$ 1.672,01, ou **0,96%**.

  Os R$ 5,65 são **exatamente a tarifa de tabela da §2.1 para preço < R$ 30**, ou
  seja: não é tarifa diferente, é a isenção não se aplicando àqueles dois pedidos.

  ⚠️ **A causa é o estágio de liquidação, não o fim do benefício.** Cruzando
  `transactionStatus` com a presença da tarifa nas 59 transações `Shipment`:

  | status | tem tarifa FBA | transações |
  |---|---|---|
  | `RELEASED` | não | 26 |
  | `DEFERRED_RELEASED` | não | 26 |
  | `DEFERRED` | não | 5 |
  | `DEFERRED` | **sim** | **2** |

  **Nenhuma transação já liquidada foi cobrada — 52 de 52 em zero.** As duas
  cobranças estão em transações ainda `DEFERRED`, ou seja, em trânsito. A tarifa
  aparece bruta no estágio diferido; a isenção é aplicada na liberação.

  Duas evidências independentes de que o benefício seguia ativo **no mesmo dia da
  primeira cobrança** (05/09): as duas transações `ServiceFee` daquela data —
  `Subscription` e `FBAStorageBilling` — foram faturadas em **R$ 0,00**. Se a
  janela tivesse virado, a armazenagem seria cobrada.

  Descartado antes disso: a condição de Ads da §2.3 está cumprida com folga
  (`workspace_ad_metrics`: R$ 445,92 em agosto e R$ 138,37 em setembro, 30–37% da
  receita contra o mínimo de 3,5%).

  **O que falsifica:** acompanhar os dois pedidos até liberarem —
  `701-4225468-1122630` e `702-7604013-7281816`. Se saírem de `DEFERRED` **com** a
  tarifa, a isenção deixou de cobrir logística e o cenário "sem isenção" passa a
  ser o número corrente. Se liberarem em zero, era artefato do estágio diferido.
  Registrado como pendência em
  `docs/plans/pesquisa-de-catalogo-de-fornecedor.md` §8, porque muda decisão de
  compra de estoque.

  📌 **Lição de método:** somar tarifa por pedido sem olhar `transactionStatus`
  mistura número final com número em trânsito. A primeira leitura desta mesma
  medição concluiu "duas cobranças novas, a janela pode ter virado" — e a
  diferença entre as duas conclusões era uma coluna.
- **01/09/2026** — Tabela FBA capturada da página de ajuda do Seller Central
  (201112670) na sessão da conta NEXAHUB BR, a pedido da Ana: "essa é a tabela
  que você precisa usar como regra pra calcular as tarifas de cada pedido antes
  da amazon fornecer esse dado". Registrada a promoção de isenção vigente e as
  duas ambiguidades da própria página (arredondamento e exemplo 3 divergente).
- **01/09/2026 (2)** — Seção 1 refeita com leitura ao vivo e verbatim da página
  pública. A versão de 31/08 (escrita neste arquivo em 01/09, de memória de uma
  captura anterior) continha erros de reconstrução: Beleza e Papelaria como 12%
  (página diz 13%), Games consoles como 8% (página diz 11%), mínimos R$ 1,00
  onde a página diz R$ 2,00, e tetos de faixa 750/1.500 (página diz 100/200).
  Detectado porque o backend comparou as duas capturas e elas divergiam entre
  si. Registrada a divergência página (13%) vs extrato medido (12%) em
  Papelaria e Beleza — em aberto.
- **31/08/2026** — Primeira captura da tabela de comissão da página pública
  (superada pela leitura verbatim acima).
