# ADR-027: Tarifa estimada ocupa o lugar da real até o pedido liquidar

- **Status:** **Aceito** em 28/08/2026 — a fonte (Product Fees API, em vez de
  tabela mantida por nós) e o modo de falha obrigatório foram aprovados no
  portão. Falta a revisão de dado do Delta (previsto vs. real no schema) e a
  marca visual da Vitrine antes de implementar.
- **Data:** 2026-08-28
- **Escopo desta volta:** **canal Amazon apenas.** Replicar para ML/Shopee/TikTok
  só depois que a pontaria estiver medida (ver "Acompanhamento de pontaria").

## Contexto

Na Rentabilidade dos pedidos da Amazon, um pedido de hoje ainda não liquidado
mostra **"Tarifas não postadas"** (`OrderProfitabilityTable.tsx:44`) e a margem
fica vazia. Isso é literalmente verdadeiro: a Amazon só posta comissão e taxa de
FBA quando o pedido é liquidado, e até lá o NEXO não tem o número real.

A Ana olhou essa tela e pediu:

> *"não dá pra colocar um dado temporário aí? […] é só um número estimado que
> vai estar ali enquanto o número oficial não está"*

Ela **rejeitou** o desenho de duas colunas (estimado ao lado de real). Quer
**um número, simples**, no lugar onde hoje não há número nenhum.

### A tensão, dita por extenso

`AGENTS.md` traz três regras sobre dado incerto. Duas continuam intactas aqui, e
**uma está sendo deliberadamente alterada por decisão da dona do produto**:

| Regra | Como fica |
|---|---|
| **`null` ≠ `0`** | **Intacta.** A estimativa nunca é `0`. Se não der para estimar, continua ausente. |
| **Nunca escrever "parcial" na tela** | **Intacta e reforçada.** O rótulo diz de onde veio o número ("comissão 15% + FBA tamanho P"), não que ele é incompleto. |
| **"Não extrapolar"** | **Alterada, com limite.** Era: enquanto tarifas e fretes não estiverem completos, o painel mostra só o que foi capturado. Passa a ser: o painel pode mostrar um número **calculado a partir de tabela publicada pela própria Amazon**, marcado como tal, enquanto o oficial não chegou. |

O motivo de a Ana ter decidido assim, e ele precisa ficar registrado porque
contraria o instinto que construímos: **para a decisão dela, número ausente é
pior que número estimado e rotulado.** Um pedido sem margem não diz "espere" —
ele some da leitura. Ela olha o dia, não enxerga resultado nenhum, e não tem
como saber se vendeu bem ou mal. A célula vazia não é neutra: ela apaga o pedido
mais recente, que é justamente o que ela quer avaliar.

O que a regra "não extrapolar" protegia continua protegido, porque **isto não é
extrapolação.** Extrapolar seria projetar o desconhecido a partir do que
capturamos (média histórica, regra de três sobre pedidos liquidados). Não é o
caso: o número vem de uma tabela que a Amazon publica e que já modelamos.

## Decisão

### 1. De onde vem a estimativa

Da **Product Fees API v0** da Amazon — `getMyFeesEstimateForASIN`, o mesmo
endpoint que a calculadora do NEXO já usa (`src/lib/fees.ts:38`). Dado o ASIN e
o preço de venda, a Amazon devolve `FeeDetailList` com comissão (referral) e
logística FBA para aquele item naquele preço.

⚠️ **Nada de média histórica.** Estimativa derivada dos nossos próprios pedidos
liquidados seria extrapolação de verdade, e erraria exatamente onde mais
importa: no produto novo, que ainda não tem histórico.

Regras de captura:

- A estimativa é calculada **no momento em que o pedido entra** no canônico, com
  o preço efetivamente praticado naquele pedido — não com o preço de hoje.
- É persistida junto do pedido. Não se recalcula na leitura: a rota de
  rentabilidade tem orçamento de 1s (ADR-017) e não pode chamar a Amazon.
- **Se a Product Fees API não responder, ou responder sem sucesso, o pedido fica
  sem estimativa e a tela volta a "Tarifas não postadas".** Ausência de
  estimativa nunca vira `0`, e o modo de falha é o comportamento de hoje.

### 2. Como aparece na linha do pedido

Um número só, no lugar onde hoje está vazio, com:

- **marca visual de estimativa** — o padrão de ênfase da Vitrine, definido por
  ela; este ADR não escolhe cor nem ícone.
- **procedência no title/tooltip**, montada a partir do que a Amazon devolveu:
  *"estimado: comissão R$ X + FBA R$ Y — tarifa oficial entra na liquidação"*.

Não há coluna nova. Não há a palavra "parcial".

### 3. Quando a tarifa real chega, ela substitui

Na liquidação, o valor real ocupa a linha e a marca de estimativa some — o
pedido passa a ser um pedido normal.

**O pedido guarda os dois valores.** O previsto não é descartado: é ele que
permite medir a pontaria (item 5). Onde exatamente guardar (colunas na
`workspace_channel_orders` vs. linhas com `fee_type` próprio em
`workspace_channel_order_fees`) é a parte que o **Delta revisa** — a restrição
que este ADR impõe é só esta: *previsto e real coexistem, e o real nunca
sobrescreve o previsto no lugar onde ele foi gravado.*

📌 Dependência de retenção (ADR-026): se o previsto morar numa camada com
expurgo, a medição de pontaria de duas semanas atrás desaparece sozinha e a
métrica passa a dizer que acertamos sempre. Ver a nota equivalente registrada
para a NF-e.

### 4. Agregados: um número, com o ⓘ dizendo quanto dali é estimado

O total do card continua **um número** — a Ana não quer coluna nova, e um total
que exclui os pedidos de hoje seria um total errado por omissão.

O ⓘ do card passa a dizer, quando houver estimativa embutida:

> *"inclui R$ X estimados de N pedidos ainda não liquidados"*

Se não houver nenhum pedido estimado no período, a frase **não aparece** — não
se escreve "inclui R$ 0,00 estimados", pelo mesmo motivo de sempre: zero é um
fato, e afirmar esse fato aqui é ruído.

### 5. Acompanhamento de pontaria — a parte que decide o futuro desta decisão

Quando a tarifa real chega, registra-se o desvio contra o previsto (absoluto e
percentual). Em duas semanas sabemos se erramos 2% ou 20%.

Isso não é enfeite: **é o critério de expansão.** Se a pontaria for boa, a
estimativa merece aparecer em mais lugares e em mais canais. Se errar feio, é a
própria medição que nos avisa — e a reversão é remover a estimativa da tela, não
descobrir pelo cliente.

O desvio precisa ser consultável por período e por SKU (um erro concentrado num
produto é um problema diferente de um erro espalhado).

## Emenda de 31/08/2026 — deixa de ser exceção e passa a ser o caminho padrão

**Decidido pelo cérebro em 31/08/2026, com achado de concorrente medido na mão.**
O texto original acima fica intacto: esta emenda muda o **enquadramento e o
escopo**, não a fonte nem o modo de falha.

### O que foi medido

Na tela do **Gestor Seller** (leitura na conta **Crystal Fancy**, do colega, que
é a que a Ana usa lá), pedido **`702-5661774-5509040`**, Amazon FBA, criado em
**31/08/2026 às 22:05:42**, com **data de aprovação `-`** — o equivalente ao
nosso `pending`. Minutos depois de criado, a tela já mostrava a composição
inteira: itens +R$ 28,90, comissão −R$ 3,47, FBA −R$ 5,65, imposto −R$ 1,73,
custo −R$ 12,08, **lucro R$ 5,97 (20,64%)**, e *"líquido do marketplace
R$ 19,78"*.

É cálculo **por tabela**, não leitura de extrato: 3,47 / 28,90 = **12,006%**, a
comissão de categoria na casa decimal, e a Taxa FBA de R$ 5,65 se repete idêntica
em quatro pedidos do mesmo SKU. O registro completo, com a derivação sobre o
segundo preço, está no *Changelog observado* de
[`docs/api-amazon-sp-api.md`](../api-amazon-sp-api.md).

### O que isso muda neste ADR

| era (28/08) | passa a ser (31/08) |
|---|---|
| **Exceção** à regra "não extrapolar", para cobrir o buraco até a liquidação | **Caminho padrão da Amazon**: toda venda nasce com comissão e FBA calculados por tabela, e o oficial **substitui** quando chega |
| Escopo: a linha do pedido na Rentabilidade, onde hoje não há número | Vale **também para o pedido `pending`** — que é o que a Ana pediu três vezes |
| Justificativa: "número ausente é pior que número estimado e rotulado" | A mesma, **mais** a evidência de que o software de referência dela faz assim desde o minuto zero do pedido |

O que **não** muda, e não está em discussão:

- a fonte continua sendo a **Product Fees API** da Amazon — média histórica
  calculada por nós segue proibida;
- o modo de falha continua o mesmo: **sem estimativa, o pedido fica sem número**,
  nunca `0`;
- **a marca de estimativa na tela FICA.** Os concorrentes exibem o número sem
  marca nenhuma, como se fosse oficial — e essa é a parte que **não copiamos**.
  Nossa vantagem sobre eles passa a ser exatamente a marca e a substituição, não
  a ausência do número.

### O que NÃO foi provado

Não foi possível provar que o concorrente **substitui** o calculado pelo oficial
depois da liquidação. O medido é que ele **calcula antes**. Nada neste ADR pode
se apoiar na substituição deles — a nossa substituição (item 3 acima) continua
sendo decisão nossa, sustentada pelo acompanhamento de pontaria (item 5), e não
por imitação.

### Aberto em 31/08/2026, e é dívida desta emenda

A implementação que já está no ar (`e8fee24`) grava a tarifa estimada como
`fee_type = 'estimated'` e a soma ao lucro do período. Medido no mesmo dia, na
conta `A15NQMF7A6J1Y0`: a estimativa entrou para 28 pedidos, enquanto a **receita**
do pendente só cobre 13 de 32 — `ordered_gross` é `NULL` nos outros 19. Tarifa e
custo de um universo contra receita de outro é o que produziu a margem de −90,5%
na tela dela. **O caminho padrão só vale com receita e tarifa cobrindo o mesmo
conjunto de pedidos** — a apuração desse desencontro está medida e registrada, e
o conserto aguarda o cérebro.

## Consequências

**A favor:**

- O pedido de hoje passa a ter resultado legível, que é o que a Ana pediu.
- A fonte é a Amazon, não nós — se a estimativa errar, erra o que a própria
  Amazon publica, e o desvio medido mostra isso.
- O acompanhamento de pontaria transforma uma decisão de produto em algo
  falseável em duas semanas.

**Contra, e assumido:**

- Um número estimado pode ser lido como oficial por quem não passa o mouse.
  Mitigação: marca visual permanente enquanto for estimativa, e a substituição
  automática na liquidação limita a janela de exposição a horas/dias.
- Uma chamada a mais à Amazon por pedido novo, num endpoint com limite próprio.
  A implementação precisa respeitar rate limit e não pode atrasar a ingestão —
  falha na estimativa não pode falhar o pedido.
- A regra "não extrapolar" do `AGENTS.md` deixa de valer sem qualificação e
  passa a valer com o limite escrito acima. ✅ **Feito em 28/08/2026:** a regra
  no `AGENTS.md` continua valendo e ganhou a exceção nomeada apontando para
  este ADR — número publicado pela fonte, marcado na tela; média histórica nossa
  segue proibida.

## Alternativas descartadas

- **Duas colunas (estimado | real).** Descartada pela Ana: ela quer um número.
- **Média histórica de tarifa por SKU.** Isso sim é extrapolação, e falha no
  produto novo — exatamente onde a estimativa é mais necessária.
- **Percentual fixo de comissão por categoria mantido por nós.** Vira tabela
  desatualizada dentro de casa; a Amazon já responde por ASIN e por preço.
- **Manter "Tarifas não postadas".** É o estado atual, e é o que a decisão da
  dona do produto está revertendo.

## Pendente antes de implementar

1. Portão do cérebro sobre este ADR.
2. Revisão do Delta: onde guardar previsto vs. real, e a dependência de retenção.
3. Definição da marca visual pela Vitrine.
