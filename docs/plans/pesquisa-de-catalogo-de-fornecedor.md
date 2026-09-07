# Pesquisa de catálogo de fornecedor — spec

**Data:** 07/09/2026
**Pedido da dona do produto:** automatizar a pesquisa de mercado que hoje é feita
produto por produto, abrindo o catálogo do fornecedor de um lado e a busca da
Amazon do outro.

---

## 1. O problema, como ele é hoje

O fluxo manual, verbatim do pedido: abrir o catálogo, pegar um produto, buscar na
Amazon, filtrar por Prime (que é o FBA, a logística dela), conferir **pela foto**
se o anúncio é o mesmo produto do catálogo, ver o menor preço do FBA, ver se tem
concorrente demais (até mil é aceitável), e ver se sobra margem para entrar.

O catálogo da Rio Tijucas tem **2.142 produtos em 243 páginas**. O fluxo manual
não escala, e não é por falta de disciplina: é uma busca por item.

A automação **não decide** — ela inverte o funil. Hoje ela abre 2.142 para achar
20 que prestam; depois, ela olha 20 candidatos já medidos e decide.

---

## 2. O que foi medido antes de escrever esta spec

### 2.1 O catálogo é texto, não imagem escaneada

`CATALOGO TOTAL 18-08_compressed.pdf`, 243 páginas, 2.039 imagens embutidas,
fontes reais. A extração devolve, por item: categoria, código, nome, linhas de
especificação, embalagem, valor e IPI%. Exemplo verbatim da página 120:

```
22089 | BALANCA DIGITAL 10 KG - | 20X14 CM | Valor: R$ 13,50 - 13% IPI | Qtd em estoque: 40.799
```

O texto tem coordenada (x, y), e as imagens têm transform — então dá para parear
**cada foto com o código ao lado dela**. É isso que sustenta a etapa 4.

A embalagem (`CX Com 240/24 Und.`) dá o **múltiplo mínimo por item**, escrito no
próprio PDF. A regra de caixa fechada não precisa ser adivinhada por categoria.

### 2.2 As tarifas realmente cobradas na conta

Medido em 07/09/2026 contra `GET /finances/2024-06-19/transactions`, janela de
90 dias (primeiro pedido em 10/08/2026, 59 pedidos postados, R$ 1.672,01 em vendas):

| Tarifa | Cobrado |
|---|---|
| Comissão (referral) | **R$ 0,00 em 59 de 59 pedidos** — não existe linha `Commission` |
| `FBAPerUnitFulfillmentFee` | **R$ 0,00 em 57 de 59**; R$ 5,65 em 2 pedidos |
| `AmazonForAllFee` | R$ 4,78 no total (~1,4%, só nos pedidos de R$ 56,90) |
| **Total** | **R$ 16,08 sobre R$ 1.672,01 — 0,96%** |

Confirmado por `GET /orders/v0/orders`: **72 de 72 pedidos são `AFN` (FBA)**.
A hipótese "os zerados são envio próprio" está descartada — são FBA de verdade,
com tarifa realmente isenta.

⚠️ **Isto derruba a régua importada.** A régua da skill `pesquisa-produto-amazon`
(faixa R$ 15–50, custo ≤ 35% do preço) vem de um material americano escrito para
quem paga comissão cheia mais tarifa fixa por unidade. Sob tarifa fixa, item
barato morre porque a tarifa come a margem. **Na conta dela a tarifa fixa não
existe hoje** — e é exatamente por isso que a curva B e C é o terreno dela:
onde o concorrente com tarifa cheia não ganha dinheiro em item de R$ 8, ela ganha.
Aplicar a régua importada reprovaria justamente a vantagem competitiva dela.

### 2.3 A isenção tem prazo, e há sinal de que ele está virando

`docs/tarifas-amazon-br.md` §2.3, capturado da página pública da Amazon: isenção
de **100% das tarifas de logística, coleta e armazenagem nos primeiros 30 dias**
para vendedor FBA novo; depois, tarifa fixa para preço ≥ R$ 79 e isenção de
coleta/armazenagem, **condicionado a investir ≥ 3,5% da receita em Amazon Ads**.

Duas observações que a spec precisa carregar:

1. **A condição de Ads está folgadamente cumprida.** Gasto medido em
   `workspace_ad_metrics`: R$ 445,92 em agosto e R$ 138,37 em setembro — entre
   30% e 37% da receita, dez vezes o mínimo. Não é essa a causa.
2. **Os dois pedidos cobrados são de 05/09 e 06/09** — os primeiros em toda a
   série. Agosto teve 43 pedidos e nenhuma cobrança. E os R$ 5,65 são
   **exatamente a tarifa de tabela para item abaixo de R$ 30** (§2.1 do mesmo
   doc), ou seja: não é uma tarifa diferente, é a isenção não se aplicando.

**Causa encontrada: é o estágio de liquidação, não o fim do benefício.** Cruzando
`transactionStatus` com a presença da tarifa nas 59 transações `Shipment`,
**nenhuma transação já liquidada foi cobrada — 52 de 52 em zero** (26 `RELEASED`
+ 26 `DEFERRED_RELEASED`). As duas cobranças estão em transações ainda `DEFERRED`,
em trânsito: a tarifa aparece bruta no estágio diferido e a isenção entra na
liberação. E no próprio 05/09 as `ServiceFee` de `Subscription` e
`FBAStorageBilling` saíram em **R$ 0,00** — se a janela tivesse virado, a
armazenagem seria cobrada.

Segue valendo como pendência de verificação: acompanhar os pedidos
`701-4225468-1122630` e `702-7604013-7281816` até liberarem (§8).

📌 **Consequência para esta spec, que é o motivo dela existir:** o estoque
comprado agora chega ao FBA em semanas e vende ao longo de meses. Uma decisão de
compra de R$ 3.000 tomada com tarifa zero, executada num mundo com tarifa cheia,
erra na direção mais cara. Por isso a margem **nunca** aparece como número único.

---

## 3. Desenho

Uma skill `pesquisa-catalogo-fornecedor`, com o fornecedor como **parâmetro**.
As condições comerciais viram um arquivo de configuração; fornecedor novo é
arquivo novo, não skill nova.

### Etapa 1 — Ler o catálogo (`catalogo.mjs`)

PDF → JSON. Por item: categoria, código, nome, especificações, embalagem
(múltiplo mínimo), valor, IPI%, estoque, e o recorte da foto salvo em disco e
pareado pela coordenada. Roda uma vez por catálogo, resultado em cache.

### Etapa 2 — Custo real (`custo.mjs` + `fornecedores/rio-tijucas.json`)

Aplica as condições sobre o preço de tabela. Para a Rio Tijucas:

| Regra | Valor |
|---|---|
| Desconto | 25% (autorização específica de 26/08/2026; a regra-padrão é até 20% e **não acumula**) |
| IPI | por item, vindo do catálogo |
| Quantidade mínima | subdivisão da caixa, ou 24 unidades quando não houver |
| Caixa fechada | vidro, cerâmica, formas, escovas sanitárias, tapetes, pedras, folhas secas, lixeiras de metal, porta-guarda-chuvas, relógios, papel de parede, adesivos de parede |
| Pedido mínimo | R$ 3.000,00 |
| Pagamento | antecipado nas primeiras compras |
| Frete | grátis para SP e Região Sul |

Saída por item: **custo unitário** e **investimento mínimo de entrada**
(múltiplo × 1 lote). Item de caixa fechada não fraciona, então o investimento de
entrada dele é a caixa inteira — e às vezes isso sozinho já elimina o item.

### Etapa 3 — Triagem sem foto, no catálogo inteiro (`triagem.mjs`)

Para cada item, monta o termo de busca — **construído, não copiado**: corrige o
nome (o catálogo tem `BALEIRIO` por *baleiro*), usa a categoria como contexto, e
quando o nome é ambíguo busca duas variações e junta. Reusa a SP-API já embrulhada
em `src/lib/search.ts`: `searchCatalogItems` + `competitivePrice` +
`getLowestFbaPricingBatch` (uma chamada em lote para os 20, não uma por ASIN).

Colhe por nicho: nº de concorrentes, quantos são FBA, **menor preço FBA**, BSR do
melhor colocado, e a data de lançamento.

**Roda os 2.142.** Não há pré-filtro por preço — a versão anterior desta spec
propunha descartar item barato e item caro antes de consultar a API, e isso estava
errado por dois motivos: o corte dependia de uma tarifa de FBA que hoje é zero
(§2.2), e descartaria em silêncio a curva B/C que é a vantagem dela. O catálogo
inteiro custa cerca de uma hora de API. O corte vira controle na tela.

### Etapa 4 — Conferência de foto, só nos sobreviventes

Foto do catálogo contra a foto de cada anúncio candidato. O modelo classifica
**mesmo produto / parecido / outro**, com a razão escrita em uma frase.
Desempatam: a dimensão (`20X14 CM`) e a embalagem, que separam dois itens de nome
idêntico.

Só entra aqui quem passou a etapa 3, porque é a parte cara. E a ordem tem uma
razão: se o nicho inteiro já não fecha, não importa se a foto bate — não havia
negócio de qualquer jeito.

**Quem não bate com ninguém não é descartado.** Vai para a seção "sem concorrente
direto", com o preço que o nicho parecido pratica. Item sem igual na Amazon é
candidato a anúncio novo, não lixo.

### Etapa 5 — As duas saídas

**Página** (Artifact), uma linha por candidato: foto do catálogo ao lado da foto
do anúncio, o julgamento do modelo visível para ela discordar, custo, investimento
mínimo, menor preço FBA, concorrentes, BSR, link para o anúncio, e **as duas
margens** (§4).

**Planilha** no formato de `Pedido_Rio_Tijucas`, gerada do que ela aprovar na
página, com múltiplo e IPI preenchidos e quanto falta para o mínimo de R$ 3.000.

---

## 4. As duas margens — regra central

Cada linha mostra **dois números lado a lado**, nunca um:

| Cenário | Comissão | Tarifa FBA | Fonte |
|---|---|---|---|
| **Hoje** | 0% | R$ 0,00 | medido na conta, 07/09/2026 (§2.2) |
| **Sem isenção** | por categoria | por faixa de preço/peso | `docs/tarifas-amazon-br.md`, tabela publicada pela Amazon |

O cenário "sem isenção" usa número **publicado pela própria fonte**, que é a
exceção nomeada do [ADR-027](../adr/ADR-027-tarifa-estimada-ate-a-liquidacao.md).
Não é média histórica calculada por nós, que continua proibida.

Produto que só fecha no cenário "hoje" **não é reprovado** — é classificado. Um
item que dá 40% agora e −5% depois é uma decisão diferente de um que dá 40% nos
dois: o primeiro é compra pequena de giro rápido, o segundo é produto para ficar
no catálogo. A página diz qual é qual, em vez de esconder atrás de um passa/não-passa.

---

## 5. O que a página nunca faz

- **Não escreve avaliações nem "X vendas no último mês".** Não existem na SP-API —
  são da vitrine. Ficam marcados como **não medidos**, com o link do anúncio para
  ela conferir. Nunca zero, nunca estimados a partir do BSR.
- **Não converte BSR em unidades por mês.** BSR é posição relativa; a conversão
  seria invenção.
- **Não faz scraping da vitrine da Amazon.** Nem propõe. As fotos dos anúncios
  vêm do campo de imagem da própria API; as do catálogo, do PDF dela.
- **Não descarta em silêncio.** Cada item reprovado guarda o motivo, e a tela
  mostra quantos caíram por qual critério. Ela mexe no corte e vê o que volta.
- **Não usa a régua importada** de faixa R$ 15–50 e custo ≤ 35% como reprovação
  automática — ver §2.2.

---

## 6. Testes

Seguindo `AGENTS.md`: cada teste abaixo precisa **ter sido visto vermelho** com a
quebra correspondente aplicada, uma de cada vez.

| Teste | Quebra que precisa deixá-lo vermelho | Defeito que ele reprova |
|---|---|---|
| Múltiplo mínimo vem do catálogo | trocar `CX Com 240/24` por um padrão fixo de 24 | quantidade errada quebra o pedido no fornecedor |
| Caixa fechada não fraciona | permitir a subdivisão num item da lista do §3 | pedido recusado por regra do fornecedor |
| Custo com desconto e IPI | inverter a ordem (IPI antes do desconto) | custo errado contamina as duas margens |
| Duas margens sempre presentes | devolver só a margem "hoje" | decisão de compra com número único, o defeito que a §2.3 descreve |
| Contador de reprovados | reprovar um item sem registrar o motivo | descarte em silêncio |
| Ausência ≠ zero | fazer avaliações virarem `0` em vez de não medido | `null ≠ 0`, a regra do projeto |
| Fronteira da faixa de tarifa | usar só itens da amostra real (todos < R$ 30) | a faixa de preço da tarifa FBA nunca seria exercida — usar valores fabricados dos dois lados de R$ 30 e de R$ 79 |

⚠️ Sobre o último: a amostra real da conta hoje é inteira de um lado da fronteira
(todos os produtos vendidos custam entre R$ 21,90 e R$ 56,90). Testar só com
dados reais deixaria a regra da faixa verde nos dois sentidos.

---

## 7. Fora de escopo

- Renomear qualquer identificador `sellercore`.
- Aba nova dentro do NEXO — a saída é Artifact + planilha. Se virar rotina, vira
  tela depois, com plano próprio.
- Decidir a compra. A skill entrega candidatos medidos; a decisão é dela.

---

## 8. Pendência que não bloqueia, mas tem prazo

Acompanhar os dois pedidos ainda `DEFERRED` com tarifa lançada —
`701-4225468-1122630` e `702-7604013-7281816` — até saírem do estágio diferido.

- Se liberarem **em zero**: era artefato do diferido, a isenção segue integral.
- Se liberarem **com a tarifa**: a isenção deixou de cobrir logística, e o cenário
  "sem isenção" deixa de ser projeção e vira o número corrente — o que muda a
  leitura de toda a lista gerada por esta skill.

⚠️ **A medição tem de olhar `transactionStatus`.** Somar tarifa por pedido sem
essa coluna mistura número final com número em trânsito, e foi exatamente o que
produziu a leitura errada na primeira passada (07/09/2026).

O dado sai de `GET /finances/2024-06-19/transactions`, é barato de medir, e não
depende desta skill estar pronta.

### 8.1 Resolvido — são dois benefícios, com prazos diferentes

Termos oficiais lidos em 07/09/2026 e registrados em
`docs/tarifas-amazon-br.md` §2.3.1:

| Benefício | Prazo | Teto | Situação |
|---|---|---|---|
| Comissão zero | 90 dias (+60 se estendido) | R$ 40.000 (+R$ 20.000) | **ativa**; consumido R$ 1.672, ou 4% do teto |
| FBA Grátis (logística, coleta, armazenagem) | 30 dias | — | **provavelmente expirada** — ver §8 |

A conta se qualifica: `GET /sellers/v1/account` confirma endereço em **São Paulo**
e CNPJ ativo, que são os dois requisitos do benefício de comissão.

**Consequência para o cenário "sem isenção" da §4:** ele deixa de ser um cenário
único e vira dois, porque os prazos não coincidem. A janela realista para uma
compra de estoque é **comissão zero + tarifa de logística cheia** — que é
exatamente onde a conta está entrando agora.

**Risco para a extensão de +60 dias:** exige ≥ 3,5% da receita em Ads (cumprido
com folga, 30–37%) **e** taxa de cancelamento abaixo de 2,5%. Medido em
`orders/v0/orders`: **14 cancelados em 72 pedidos, 19%**. Cancelamento iniciado
pelo comprador antes do envio normalmente não conta contra a métrica do vendedor
no FBA, então isto é um **ponto a conferir no Seller Central**, não um veredito —
mas é o que separa 3 meses de 5 meses de comissão zero.
