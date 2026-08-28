# ADR-027: Tarifa estimada ocupa o lugar da real até o pedido liquidar

- **Status:** Proposto — aguardando portão do cérebro e revisão de dado do Delta
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
  passa a valer com o limite escrito acima. **`AGENTS.md` precisa apontar para
  este ADR** quando ele for aceito, senão a próxima pessoa lê a regra antiga e
  desfaz isto de boa-fé.

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
