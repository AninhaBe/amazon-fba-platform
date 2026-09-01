# ADR-027: Tarifa estimada ocupa o lugar da real até o pedido liquidar

- **Status:** **Aceito** em 28/08/2026 — a fonte (Product Fees API, em vez de
  tabela mantida por nós) e o modo de falha obrigatório foram aprovados no
  portão. A revisão de dado do Delta está **fechada** (Emenda II, 31/08/2026:
  tabela própria + view, `migrations/0022`). Falta a marca visual da Vitrine.
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

### Segunda medição, 31/08/2026 à noite: eles NUNCA substituem

O que ficara sem prova na primeira medição foi medido depois, e o resultado é o
oposto do que a dúvida supunha: **o concorrente não substitui pelo oficial.**

- Pedido **`702-9124025-9780207`**, criado em **31/07**, **aprovado em 10/08** —
  três semanas depois, a tela seguia mostrando comissão de **12,01%**, valor de
  tabela e não de extrato.
- O mesmo SKU vendido em **julho (já consolidado)** e **hoje (pendente)** exibe o
  **mesmo líquido ao centavo**: 21,90 → 13,62 nos dois.

Ou seja: o número de tabela entra no minuto zero e **fica para sempre**.

### O risco que eles têm e nós não podemos ter

É esta a razão de existir do item 3 (substituição), e ela agora tem prova:

> Se a Amazon cobrar **diferente da tabela** — promoção, mudança de categoria,
> ajuste, reembolso —, o lucro deles fica errado **para sempre**, porque nada
> nunca reconcilia. O nosso conserta na liquidação.

Estimar não é concessão: é o padrão do mercado. **A reconciliação com o extrato é
o que ninguém faz**, e é onde ficamos melhores, não piores. Quem for "simplificar"
removendo a substituição não está economizando código — está adotando o defeito
do concorrente.

Escrito também no código, junto da cláusula que faz a substituição acontecer
(`amazonOverviewCanonical.ts`, a consulta de `fee_type = 'estimated'`), porque
essa cláusula parece removível para quem não conhece esta medição.

### Medição de 31/08/2026 que a implementação precisa carregar

Na conta **`AO62LVXJMX3AA`** (a dela), a Product Fees API respondeu
`Status: "Success"` com **`Amount: 0`** — e `FeePromotion: 0`, não uma promoção
descontando um valor cheio — para os dois ASINs do dia, em FBA e não-FBA. Os 40
pedidos com estimativa gravada na conta somam **R$ 0,00** de tarifa.

Não é possível afirmar que a conta dela realmente não paga tarifa: o extrato tem
apenas **3 pedidos com tarifa real capturada, somando R$ 2,39** contra
R$ 2.014,26 de receita em agosto — cobertura fina demais para confirmar ou
refutar. Fica registrado como **medição, não como conclusão**.

Consequência para a tela, já implementada: a marca de estimativa aparece quando
**existe pedido estimado**, e não quando o valor é maior que zero. Um zero
publicado pela fonte é um fato que a liquidação pode substituir — esconder a
marca porque o valor é zero exibiria lucro sem tarifa nenhuma sem dizer que
aquilo é estimativa.

### Fechado em 31/08/2026 — a base virou uma só

A dívida registrada abaixo foi paga na mesma noite. `revenueDoLucro` passou a ser
o **faturamento do período** — todo pedido não cancelado pelo valor do próprio
pedido — e lucro, margem e **imposto** saem dele. Medido antes e depois:

| conta | antes | depois |
|---|---|---|
| `A15NQMF7A6J1Y0` | lucro −109,31 · margem **−90,5%** · base do lucro 456,86 contra denominador 130,09 | lucro −36,10 · margem **−6,5%** · base 551,13 nos dois |
| `AO62LVXJMX3AA` (dela) | lucro 34,94 · margem **+120,9%** (impossível) · base 73,12 contra denominador 28,90 | lucro 33,88 · margem **46,3%** · base 73,12 nos dois |

Três correções sustentam isso, e cada uma foi vista vermelha antes de contar
(`tests/umaBaseSoNaAmazon.test.mjs`):

1. **`NULLIF(gross, 0)`** — o sync grava `gross = 0.00` (não `NULL`) enquanto a
   Amazon omite `OrderTotal`, então o `COALESCE(gross, ordered_gross)` **nunca**
   caía para o preço de tabela e 30 pendentes com preço conhecido somavam zero.
2. **O custo cobre o complemento exato da base**, e não `status = 'pending'`.
3. **O imposto sai da base do lucro**, não da receita apurada.

Pedido que a Amazon ainda não valorizou continua **fora** da base — nunca zero —
e a tela o aponta com número ("18 pedidos sem valor publicado pela Amazon").

### A dívida que originou o item acima (31/08/2026)

A implementação que já está no ar (`e8fee24`) grava a tarifa estimada como
`fee_type = 'estimated'` e a soma ao lucro do período. Medido no mesmo dia, na
conta `A15NQMF7A6J1Y0`: a estimativa entrou para 28 pedidos, enquanto a **receita**
do pendente só cobre 13 de 32 — `ordered_gross` é `NULL` nos outros 19. Tarifa e
custo de um universo contra receita de outro é o que produziu a margem de −90,5%
na tela dela. **O caminho padrão só vale com receita e tarifa cobrindo o mesmo
conjunto de pedidos** — a apuração desse desencontro está medida e registrada, e
o conserto aguarda o cérebro.

## Emenda II de 31/08/2026 — a revisão de dado do Delta: previsto e real em tabelas separadas

**Decidida pelo cérebro em 31/08/2026**, sobre o parecer da frente L. Fecha o
item 2 de "Pendente antes de implementar". Não muda a fonte, o modo de falha nem
a marca de tela: muda **onde o previsto mora**.

**A razão de existir da tabela nova, numa frase:** *o concorrente estima e nunca
reconcilia; nós reconciliamos, e reconciliar exige guardar os dois.* Tudo abaixo
é consequência disso.

### O que foi medido (produção, 31/08/2026, somente leitura)

| | |
|---|---|
| `workspace_channel_order_fees` | **58 MB** (24 MB heap + **34 MB de índice**), 140.162 linhas |
| `amazon` / `fee_type='estimated'` | 514 linhas, R$ 2.009,77, **80 com `amount = 0`** |
| `provider_fee_code` do estimado | `FBAFees` (257) e `ReferralFee` (257) |
| Pedidos com estimada **e** real hoje | **18** |
| Pedidos Amazon por nº de linhas | **20.241 com uma linha só**, 139 multi-item (máx. 15 SKUs) |

### Por que `fee_type = 'estimated'` não serve como desenho

Serve como paliativo — está em produção, não corrompe número nenhum hoje. Mas
tem três defeitos, e **o primeiro sozinho já decidia**:

**1. Previsto e real não têm chave comum.** `fee_type` é a *natureza* da tarifa
(`commission`, `fulfillment`, `refund`); `estimated` é a *procedência*. Ao gravar
a procedência no lugar da natureza, a natureza foi contrabandeada para
`provider_fee_code` — e o mesmo fato econômico ficou com duas formas:

```
real     → fee_type='commission'  provider_fee_code='Commission'   (Finances API)
estimado → fee_type='estimated'   provider_fee_code='ReferralFee'  (Product Fees API)
```

`feeTypeOf()` (`amazonCanonical.ts:79`) mapeia `"Commission"` para `commission`;
**`"ReferralFee"` cai em `"other"`**. Sem chave comum, a medição de pontaria —
que é exatamente o que nos diferencia de quem estima e nunca reconcilia — vira
mapeamento hardcoded em JS, não join. Não é detalhe de schema: é a feature
morrendo na origem.

**2. A proteção contra dupla contagem era blacklist.** Três lugares repetiam
`fee_type NOT IN ('refund','estimated')`. `fee_type` novo entra somado como real
**por padrão** — modo de falha invertido. Os outros três canais já usam whitelist
(`fee_type IN ('commission','payment')`); só a Amazon usava negação.

**3. O grão era o pedido.** A estimativa era somada por pedido antes de gravar, e
a tabela não tem `line_no` nem data — desvio por SKU e lag estimar→liquidar,
ambos exigidos pela seção 5 acima, eram inalcançáveis. Sem eles o item 5 é letra
morta e a decisão deixa de ser falseável.

### A decisão

Tabela própria `workspace_channel_order_fee_estimates`, grão de **linha do
pedido**, e a leitura passando por uma **view** que faz a coalescência.

**Por que tabela e não uma coluna `basis`.** O requisito era: *a leitura não pode
somar estimada + real do mesmo pedido, e a garantia é por schema, não por
disciplina de quem escreve a query.* Uma coluna `basis` ainda depende de o leitor
lembrar do `WHERE` — mesma classe de proteção que já falhou. Uma tabela separada
não é predicado esquecível: para somar errado seria preciso escrevê-la
deliberadamente no `FROM`.

**Vocabulário único de `fee_type`, declarado aqui e não escondido no código.** A
tabela nova usa a mesma taxonomia canônica da tarifa real, com o mapeamento
explícito:

| Product Fees API (`provider_fee_code`) | `fee_type` canônico |
|---|---|
| `ReferralFee` | `commission` |
| `FBAFees` | `fulfillment` |

Um `CHECK` recusa `'estimated'` e `'refund'` nessa coluna — a procedência não
pode voltar a ocupar o lugar da natureza. O código do provider continua guardado
em `provider_fee_code`, que é o que monta a procedência do tooltip.

**Blacklist na leitura de tarifa da Amazon fica proibida.** `NOT IN (...)` tem o
modo de falha invertido: o tipo que ninguém previu entra somado como real. A
lista de `fee_type` que conta como real é **positiva** e vive num arquivo só
(a migration que cria a view) — era a repetição em três rotas que fazia da
negação um risco.

**`amount NUMERIC NOT NULL`, e desconhecido é linha ausente.** É o `null ≠ 0` do
`AGENTS.md` virando estrutura em vez de convenção: não existe campo nulável onde
um `COALESCE(...,0)` distraído possa entrar. O zero publicado pela fonte (80
linhas medidas) continua sendo fato e continua gravado como zero.

**`superseded_at` carimbado na liquidação.** Resolve três coisas de uma vez: o
lag estimar→liquidar, a marca de estimativa na tela (leitura de coluna, não
subconsulta) e a saída dos pedidos com ambos do `NOT EXISTS`. **A linha da
estimativa nunca é apagada** — é ela que permite medir a pontaria.

**Substituição por `(pedido, fee_type)` — corrigido em 01/09/2026.**

A primeira versão desta emenda substituía **por pedido**, com o argumento de não
misturar bases. O backend levantou a consequência e a medição deu razão a ele:

| pedidos Amazon com alguma tarifa real | 5.503 |
|---|---|
| com comissão **e** logística (completos) | 256 — **4,7%** |
| com comissão e **nenhuma** logística | 5.247 — **95,3%** |
| só com logística | 0 |

**A Amazon posta a tarifa em partes, e isso é a regra.** Substituir por pedido
faria a estimativa de FBA sumir da leitura no instante em que a comissão real
chegasse, em 95% dos pedidos — e a logística ainda não postada passaria a somar
**zero**.

⚠️ Isso é o `null ≠ 0` violado pelo meio: tarifa que não chegou é desconhecida, e
tratá-la como ausente dentro de uma soma afirma que ela é zero. O sintoma seria o
pior tipo — o custo do pedido encolhendo sozinho quando a comissão é postada, o
lucro subindo, e caindo de novo quando a logística entra.

E "não misturar bases" continua respeitado, porque a mistura fica **visível**:
`basis` é por linha, o pedido aparece com as duas marcas, e o card diz quanto ali
é estimado (item 4). O que a regra proíbe é um total que **finge** ser de uma base
só — não um total completo que declara a procedência de cada parte.

**Pontaria por SKU sem rateio.** Dos 20.380 pedidos Amazon, **20.241 têm uma
linha só** — nesses o desvio por SKU é exato. Nos 139 multi-item o SKU fica
`NULL` em vez de receber uma alocação proporcional inventada por nós: ratear
tarifa real entre SKUs seria extrapolação, e erraria justamente onde o desvio
interessa.

### As 514 linhas antigas são apagadas, não migradas

Foram gravadas agregadas por pedido, sem `line_no` e sem `unit_price` — o grão
novo não é reconstruível a partir delas. A alternativa seria inventar
`line_no = 0` como sentinela, e **sentinela é mentira que sobrevive ao autor**.
Refazer é barato: o estimador é idempotente e a dedup por `(ASIN, preço)` reduz
1.617 linhas a 47 chaves, custando 47 chamadas na janela de 30 dias (medido).

### Retenção (ADR-026): a preocupação registrada acima não se aplica

A nota do item 3 temia que o previsto morasse numa camada com expurgo e a
medição de pontaria sumisse sozinha. **Conferido: não é o caso.** Tarifa é
*silver* — o expurgo da ADR-026 atinge `payload`/`raw` (bronze), não as tabelas
canônicas. Fica escrito aqui para ninguém reabrir.

### Custo, medido

Migration aditiva, sem downtime: uma tabela nova (nasce vazia), um índice
parcial, duas views, e o `DELETE` das 514 linhas. A base medida dá **~430 B por
linha all-in** (58 MB / 140.162). Em regime, a Amazon com grão de item fica em
~10–15k linhas ≈ **5–6 MB**; replicar aos quatro canais custaria **~25 MB**.

Cabe nos ~34 MB livres do teto de 500 MB, **mas não é grátis** — e o motivo do
custo por linha ser tão alto não é esta decisão: é a PK de seis colunas `TEXT`
do canônico inteiro, que hoje produz 34 MB de índice para 24 MB de dado. Isso é
problema da camada física, não da ADR-027, e vira recomendação própria da frente
L com medição e proposta de migration.

### Validação feita antes de entregar

Não há Postgres local, docker nem `psql` nesta máquina, então **o DDL não foi
executado** — quem aplica é o portão do CI (`scripts/ci-preparar-banco.mjs`) e
depois o runner assinado. O que foi validado, em transação `read only` contra
produção, substituindo a tabela nova por um CTE de mesma forma: o corpo das duas
views compila, o `LATERAL … HAVING COUNT(*) = 1` devolve SKU nos pedidos de uma
linha e `NULL` nos multi-item (506 e 8 das 514 linhas), e a view de coalescência
devolve **0 pedidos com as duas bases** no estado pós-`DELETE`.

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
2. ✅ **Feito em 31/08/2026** — revisão do Delta: tabela própria + view, e a
   dependência de retenção conferida (fees é silver, fora do expurgo). Ver a
   Emenda II e `migrations/0022_previsto_e_real_convivendo.sql`.
3. Definição da marca visual pela Vitrine.
