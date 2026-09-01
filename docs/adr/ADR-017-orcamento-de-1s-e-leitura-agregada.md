# ADR-017: Orçamento de 1 segundo — uma tela, uma chamada, banco só

- **Status:** Aceito
- **Data:** 2026-08-20

## Contexto

Em 19/08/2026, o dashboard da Amazon aberto na conta de maior volume (37 mil pedidos no
ML + 21,6 mil na Amazon) ficou **preso em esqueleto** — primeiro para sempre (fetch sem
timeout, corrigido em `ed65a92`), depois por segundos a cada troca de filtro de período.

A dona do produto estabeleceu o requisito sem ambiguidade: **"essa tela não pode ficar
mais de 1s"** — e tempo de tela **não pode escalar com o volume da conta**.

### A causa, medida (não suposta)

Duas hipóteses foram descartadas com medição antes desta decisão:

| Hipótese | Medição | Veredito |
|---|---|---|
| "O banco é lento com volume" | agregação de 30 dias: 208 pedidos → 17ms · **9.262 pedidos → 21ms** (cache quente, 3 rodadas) | ❌ não é o banco |
| "É o esqueleto/frontend" | o esqueleto só aparece na 1ª visita de cada período (há cache por período) | ❌ sintoma, não causa |

A causa real, encontrada lendo as bibliotecas que servem as rotas:

```
orders.ts                → spapiFetch + paginação de TODAS as páginas de pedidos
sales.ts                 → spapiFetch
radar.ts                 → inventory + listings + orders (tudo SP-API)
topProducts.ts           → orders + products (SP-API)
amazonProfitability.ts   → orders + transactions (SP-API)
profit.ts                → 2 dbQuery (único parcialmente migrado)
```

**O dashboard da Amazon consulta a SP-API ao vivo a cada troca de período**, paginando
pedidos — ignorando o `workspace_channel_orders`, que tem os mesmos dados indexados e
responde em 21ms. Conta maior = mais páginas = mais lento. É por construção que o tempo
escala com o volume.

Além disso, a tela dispara **6 requisições paralelas por período** — cada uma com seu
overhead de rede e autenticação — e o navegador monta o quebra-cabeça.

### Por que os remendos foram rejeitados (dois foram tentados e revertidos)

- **Pré-carregar todos os períodos** (implementado e revertido em 20/08): 18 requisições
  especulativas por sessão contra uma API **com throttling** — gastaria a cota que faz a
  tela funcionar, para dados que talvez ninguém olhe.
- **Pré-carga por intenção (hover)** (implementado e revertido em 20/08): melhor, mas
  segue maquiagem — ganha 200–400ms sobre uma fonte que leva segundos e continua
  escalando com o volume.
- Esqueleto mais bonito, cache de navegador, etc.: idem — nenhum muda a fonte.

📌 **Lição que motivou a inversão:** otimização de frontend não conserta fonte lenta.
Primeiro muda-se a fonte; o frontend depois raramente precisa de truque.

## Decisão

Três regras, em ordem de precedência:

### 1. Orçamento de 1 segundo é contrato

**Qualquer interação de dashboard responde em < 1s**, independentemente do volume da
conta. Não é aspiração: mudança que estoure o orçamento em conta grande está errada
mesmo que passe em conta pequena. A conta de teste para isso é a de maior volume
disponível (~37 mil pedidos), não a menor.

### 2. Uma tela = uma chamada

Cada dashboard tem **uma rota agregadora** que devolve o payload completo da tela:

```
GET /api/amazon/dashboard?days=15
→ { orders, profit, sales, radar, top, profitability, updatedAt }
```

O servidor compõe as consultas (em paralelo, perto do banco); o navegador faz **uma**
viagem. As 6 rotas atuais continuam existindo para usos pontuais, mas o dashboard não
as chama mais uma a uma.

### 3. O caminho interativo lê SÓ do Postgres

Nenhuma chamada à SP-API (ou a qualquer API de marketplace) no caminho de uma tela.
A API externa é trabalho de dois lugares, apenas:

- **do sync** (cron, a cada 15 min hoje), que alimenta o canônico;
- - de **ação explícita do usuário** ("Atualizar agora"), com indicador próprio de
  progresso — frescor sob demanda é legítimo; frescor silencioso a cada clique, não.

Orçamento por camada, para caber no 1s de ponta a ponta:

| Camada | Alvo |
|---|---|
| Consultas SQL (somadas, em paralelo) | < 200ms |
| Composição + serialização | < 100ms |
| Rede (gru → usuário no Brasil) | < 300ms |
| Renderização | < 200ms |
| **Total** | **< 800ms** (folga de 200ms) |

### Pré-requisito duro: sync saudável

Ler do banco só vale se o banco estiver certo. Em 19/08, **16 dos 17 pedidos** da conta
da dona estavam `pending` sem itens no canônico. **Consertar a ingestão faz parte desta
migração** — rápido e furado não atende (`AGENTS.md`: tela mostra o estado real).

### Plano B já decidido (com gatilho, sem obra agora)

Se um dia a agregação ao vivo estourar o orçamento (centenas de contas, milhões de
linhas): o sync passa a manter **tabelas de resumo por dia** (pré-agregação), e o
dashboard vira leitura de ~30 linhas prontas. Gatilho: p95 da rota agregadora > 500ms
na conta de maior volume. Não implementar antes do gatilho.

## Alternativas consideradas

- **Continuar na SP-API e otimizar o frontend** (pré-carga, cache, esqueleto): rejeitado
  — ver "remendos" acima. Dois foram implementados e revertidos no mesmo dia.
- **Pré-agregação já** (tabelas de resumo desde o início): rejeitado por ora — a
  agregação ao vivo custa 21ms; materializar agora é complexidade sem dor. Fica como
  plano B com gatilho.
- **Cache mais agressivo em cima da SP-API**: rejeitado — cache sobre fonte lenta e
  limitada por cota continua pagando o preço na primeira visita e a cada expiração, e o
  throttling continua sendo de quem olha a tela.
- **Motor analítico separado (DuckDB/lakehouse)**: rejeitado — ver ADR-016; o Postgres
  responde em 21ms, o problema nunca foi ele.

## Consequências

- ➕ Troca de período instantânea, e **tempo constante** com o volume — o requisito.
- ➕ Zero consumo de cota SP-API por visita ao dashboard; throttling deixa de ser risco
  de tela.
- ➕ Menos requisições, menos estados de carregamento parciais, menos race conditions.
- ➖ O dado da tela tem a idade do último sync (≤ 15 min hoje). Mitigado pelo carimbo
  "atualizado às HH:MM" (já existe) e pelo botão de atualização explícita.
- ➖ Migração real: 5 bibliotecas (`orders`, `sales`, `radar`, `topProducts`,
  `amazonProfitability`) passam a ler do canônico — `profit.ts` serve de modelo.
- ➖ Métricas que hoje só existem na resposta da SP-API precisam estar no canônico antes
  da tela migrar — se faltar coluna, o gap aparece nesta migração (e é bom que apareça).

## Execução (20/08/2026, madrugada)

Os passos 1–3 foram implementados na mesma noite da decisão:

- **Rota agregadora** `/api/amazon/dashboard` no ar (`9d82da3`) — a leitura canônica
  completa **já existia** (`amazonOverviewCanonical.ts`, 444 linhas) e nunca tinha sido
  ligada ao dashboard; as tarifas por tipo também já estavam no canônico.
- **Cache com vazamento entre contas corrigido** (`124ab5c`): 8 chaves de cache do
  servidor não incluíam workspace nem conta — trocar de conta servia os números da
  anterior por até 10 min. `cacheScope()` agora prefixa todas.
- **Ingestão curada** (`5ca0fa9` + `5c63ac8`): pedido ingerido como Pending ficava
  pending para sempre (o backfill anda por data de criação e nunca relê; o backfill de
  itens pula pendentes). Dois consertos: `reverifyUpdatedOrders` via `LastUpdatedAfter`,
  e a cláusula de candidatura do agendador — conexão "complete" cujo único defeito era
  pedido pendente velho **não era candidata a nada**. Resultado medido: 16 pedidos
  eternamente pendentes → 14 shipped com itens em uma passada; sobraram 3 genuinamente
  pendentes na Amazon.

- **Faturamento do canônico estava 10× menor que o real** na conta grande
  (R$ 2.180 contra R$ 20.944 do Seller Central em 15 dias). Causa: pedido ingerido como
  `Pending` não tem `OrderTotal` na API e o normalizador gravava **`gross = 0`** —
  violação do `null ≠ 0` do AGENTS.md — e nada relia o cabeçalho depois. Cura pontual em
  20/08 (varredura de 16 dias regravando cabeçalhos): **R$ 19.524,87**, restando 71
  pedidos genuinamente Pending na Amazon (~R$ 1.419 — o gap fecha exato). A
  reverificação cobre o daqui-pra-frente.

  📌 O NEXO passa a mostrar **receita confirmada** (sem pendentes); o Seller Central
  inclui pendentes. Diferença de semântica, não de erro — documentar na tela quando
  houver oportunidade.

### ✅ Medição de ponta a ponta (20/08/2026, conta de 21,6 mil pedidos)

Instrumentação em `84932fc`: a rota registra a própria duração e separa o tempo do radar.
Nove carregamentos reais, alternando os quatro períodos:

| Pedidos no período | Duração | Radar |
|---|---|---|
| 1.821 | **1.391ms** ⚠️ | 75ms | ← primeira chamada, cache frio |
| 63 | 39ms | 15ms |
| 399 | 61ms | 13ms |
| 1.013 | 79ms | 12ms |
| 1.821 | **60ms** | 12ms |
| (2ª rodada) | 20–55ms | 11–48ms |

**O requisito está provado:** 63 pedidos → 39ms; 1.821 pedidos → 60ms. **29× mais volume
por 21ms a mais** — o tempo deixou de escalar com o tamanho da conta, que era a exigência.

Contra o orçamento (< 200ms na camada de dados): medido **20–79ms**, folga de 60%.

O radar — a única ida à SP-API que sobrou — custou **11–75ms**: o SWR de 10 min segura, e
ele não é gargalo. Não precisa sair da rota.

⚠️ **Cold start:** a primeira chamada custou 1.391ms e estourou o orçamento. É cache frio
do Postgres na conta grande; as seguintes custam 60ms. **Não aciona o plano B** (gatilho:
p95 > 500ms; o p95 aqui é ~80ms), mas fica registrado — se virar reclamação, a
pré-agregação já está desenhada.

### Pendências que esta execução deixou

1. **`gross = 0` em pedido pendente segue sendo gravado** (a coluna é NOT NULL). O
   upsert corrige depois, mas o certo pelo AGENTS.md é `null` até haver valor — pede
   migração pequena.
2. **Agendador com 2 vagas e cláusula de pendente-velho sem memória**: conexão com
   pendente genuíno (>6h na Amazon) vira candidata eterna e pode monopolizar vaga.
   Refinar o critério (ex.: reverificado há pouco sai da fila).
3. Passos 4 (replicar padrão para ML/Shopee/TikTok) e 5 (botão "Atualizar agora").

📌 **Lição da noite:** typecheck roda ANTES do commit, sempre — um comentário SQL com
crase dentro de template literal chegou a ser commitado quebrado (`c26246a`→`5c63ac8`).

## Como medir A/B sem enganar a si mesmo (28/08/2026)

⚠️ **Comparação A/B alterna as rodadas, sempre.** Ao otimizar a consulta de detalhe da
Shopee, medi a versão velha e depois a nova, na mesma execução, e reportei "953ms → 52ms,
18× mais rápido". **O número estava errado a favor da minha própria entrega:** a velha
rodou com cache do Postgres frio e a nova aproveitou os buffers que a velha acabara de
aquecer. Repetindo em três rodadas alternadas, o resultado honesto foi **50ms vs 46ms** —
o ganho real existe, mas em **cache frio** (a primeira abertura do dia), não no regime
quente que a medição enviesada sugeria.

Duas regras que ficam:

1. **Alternar e repetir**: rode A, B, A, B… pelo menos três vezes e compare **medianas**.
   Uma execução única mede o estado do cache, não a consulta.
2. **Medição de cache frio é outra medição, e vale à parte** — é o que a pessoa sente ao
   abrir a tela pela primeira vez no dia. Reporte as duas, sem misturar.

📌 Vale também para prova de equivalência: a primeira amostra que usei para provar que a
consulta nova dava os mesmos valores era **inteiramente nula** (os pedidos recentes ainda
não tinham tarifa conciliada), então provava apenas que `null = null`. A prova só passou a
valer ao amostrar pedidos que **têm** tarifa: 659 valores reais de dinheiro comparados.
**Amostra sem o fenômeno não prova nada.**

## Lição de 28/08/2026: o esqueleto escondia uma mentira

Quando o cache de período entrou nos quatro canais, a dona relatou o oposto do
esperado: *"deveria ser instantâneo no clique"*, e mandou print do dashboard da
Amazon com **R$ 325,91 (o total de "hoje") embaixo do rótulo "7 dias"**.

Duas hipóteses foram levantadas — que o cache tinha quebrado, e que ele nunca
cobrira aquele caso. **As duas foram refutadas por medição**: o cache acerta
(clique em período já visto pinta em ~60ms, contra ~800ms no frio, medianas de 3
rodadas alternadas).

A causa era outra e mais velha que o cache: o `AnimatedNumber` anima o valor
exibido **do número anterior até o novo** em 550ms. Enquanto havia esqueleto na
troca de período, ninguém via — o esqueleto cobria a contagem. Ao ficar rápido,
o esqueleto sumiu e a contagem ficou exposta: no primeiro quadro depois do
clique, a tela mostra o número do período ANTERIOR sob o rótulo do período NOVO.

Amostragem da tela a cada 100ms, produção, conta demo:

| canal | 1º quadro sem esqueleto | o que ele mostrava |
|---|---|---|
| Amazon, período já visto | 65ms | o valor de "hoje", sob "7 dias" |
| Mercado Livre, período já visto | 74ms | idem |
| Shopee e TikTok, **até no frio** | 40–42ms | idem, sem esqueleto nenhum |

### Armadilha de método: amostragem não prova critério de quadro

A primeira sonda amostrava a tela **a cada 100ms** e deu **PASSA** para três dos
quatro canais. Estava errada por construção: com o cache pintando em ~60ms, as
janelas em que a tela mostrava o número do período anterior duravam **5ms a
52ms** — mais curtas que o intervalo de amostragem, e portanto invisíveis para
ela. A sonda reescrita, gravando **quadro a quadro** com `requestAnimationFrame`
dentro da própria página, encontrou as três falhas na mesma execução.

> **Critério por quadro exige medição por quadro.** Se o requisito é "nenhum
> quadro pode mostrar X", amostrar em intervalo fixo mede outra coisa — e o
> resultado é uma vitória falsa, que é pior que nenhuma medição, porque fecha o
> caso.

Vale para qualquer verificação de transição: o instrumento precisa ter resolução
maior que o fenômeno. Antes de reportar "passou", pergunte qual é a menor janela
que aquele instrumento conseguiria ver.

### O conserto: derivar no render, não sincronizar por efeito

As três telas que falharam repintavam o cache **por efeito** (`setTimeout(…,0)`
ou microtask, receita usada para não cair no `react-hooks/set-state-in-effect`).
O rótulo do período muda no mesmo instante do clique; o repaint chega alguns
quadros depois — e o vão entre os dois é a janela da mentira.

O TikTok passava porque lá o dado exibido era **condicionado ao período** em vez
de sincronizado. Foi esse o padrão adotado nos quatro: o valor exibido é
**derivado durante o render** (`cache.get(períodoSelecionado) ?? estado, se o
período bater ?? null`). Assim não existe quadro intermediário — nem com o dado
velho, nem com esqueleto piscando —, e o cache continua pintando na hora.

### O que fica como regra

1. **Otimizar expõe o que a lentidão escondia.** Um defeito de correção pode
   viver anos atrás de um esqueleto. Ao remover a espera, meça **o que a tela
   mostra durante a transição**, não só quando ela termina — a pergunta não é
   "quanto tempo levou", é "o que estava escrito ali enquanto levava".
2. **Amostre a transição, não o estado final.** A medição que achou isto foi um
   loop de 100ms registrando *rótulo do botão + valor exibido + há esqueleto?*.
   Medir só o tempo até pintar teria dado "melhorou" e fechado o caso.
3. **Animação entre valores é afirmação.** Contar de um número a outro é honesto
   quando o MESMO recorte recebe dado novo; quando o recorte muda, os quadros
   intermediários afirmam números que não pertencem a recorte nenhum.
4. **Contar a partir do ZERO é a saída honesta.** A regra 3 tirou a contagem da
   troca de período e a dona do produto reclamou três vezes que "o efeito não
   voltou" — a troca ficou seca. A medição mostrou por quê: a animação de
   entrada (180ms de fade) *disparava*, só era imperceptível perto da contagem
   de 550ms que ela conhecia. A volta é contar de 0 até o valor novo, com a
   mesma duração e a mesma curva: nenhum quadro traz número de outro recorte,
   porque zero não é total de recorte nenhum, e o movimento diz sozinho que
   aquilo é animação e não afirmação. O que não pode voltar é o valor **real**
   do período anterior — número plausível e **parado** é o que se confunde com
   verdade.

### Identidade de recorte precisa ser estável na granularidade do recorte

A regra 3 exige que o componente saiba de que recorte é o valor, e a identidade
veio por prop, derivada do dado: `` `${period.from}|${period.to}` ``. Parecia
certo — e estava errado de um jeito que só apareceu quando a contagem voltou.

As rotas de overview devolvem `to` = **agora**, com milissegundos
(`2026-08-28T22:24:40.014Z`). Duas respostas do MESMO recorte — a do cache e a da
revalidação que chega logo atrás — carregam `to` diferente. Para o componente
isso é troca de período: a contagem **reiniciava do zero no meio** (medido aos
344ms) e, sob `prefers-reduced-motion`, virava um piscar de R$ 0,00 sem
movimento nenhum para explicá-lo.

O defeito estava lá desde que a identidade passou a ser derivada do dado;
ninguém o tinha visto porque, sem contagem, o "período novo" só repintava o
mesmo valor. **Foi a animação que expôs a instabilidade da chave.**

A regra: **identidade de recorte carrega a granularidade do recorte, e nenhuma
precisão além dela.** Os presets são janelas de dias inteiros, então o dia
basta — `identidadeDePeriodo(from, to)` trunca o `to`. Precisão que muda a cada
resposta não é identidade, é carimbo de tempo. Há teste que reprova quem
interpolar o `to` cru numa prop `periodo`.

### Armadilha do detector: permanência distingue herança de passagem

O critério "nenhum quadro com valor de outro período" foi lido ao pé da letra
pela sonda: *quadro cujo valor é igual ao anterior*. Com a contagem a partir do
zero isso passou a acusar dois casos legítimos — na conta demo "hoje" é R$ 0,00,
igual ao primeiro quadro da contagem por coincidência; e subindo de 0 até o
total novo, a contagem **atravessa** o total antigo quando ele é menor.

O que separa afirmação de passagem não é o valor, é a **permanência**: número
herdado fica parado enquanto ninguém o corrige; número de passagem muda no
quadro seguinte. A sonda passou a reprovar sequências de 4 quadros ou mais
(~65ms, tempo de leitura) com o valor antigo sob o rótulo novo, e continua
imprimindo o total bruto para nada ficar escondido atrás do critério.

### Guarda de fonte trava a forma; comportamento se prova por comportamento

Um teste escrito hoje para proteger a regra certa reprovou uma refatoração
inocente — e o modo como ele falhou mostra o limite do formato.

A guarda contra repetir o mesmo pedido do overview identifica cada busca por uma
chave. Enquanto a chave era montada numa linha, o teste conferia se
`retryKey`, `syncPoll`, `period.query` e `offset` apareciam **no texto daquela
linha**. Ao extrair a parte comum para uma variável (`janela`), os quatro
continuaram na chave por composição, e o teste ficou vermelho:

```ts
const janela = `${period.query}|${offset}|${retryKey}|${syncPoll}`;
const alvo   = `${selected?.id ?? ""}|${janela}`;
```

O vermelho custou caro em interpretação: chegou a ser lido como "a guarda
congelaria a tela durante a sincronização", que era o risco real que o teste
existia para vigiar. Não era — a leitura do código mostrou que qualquer avanço do
`syncPoll` muda `janela` e, portanto, `alvo`, e nenhuma guarda consegue barrá-lo.

O que fica:

- **Casar texto de código trava a FORMA, não a REGRA.** O mesmo teste que reprova
  uma refatoração inocente aprovaria uma mudança que preservasse o texto e
  quebrasse o comportamento — o pior dos dois erros, porque é silencioso.
- **Guarda de fonte cabe para proibir um PADRÃO**: import que não pode existir,
  campo que não pode ser interpolado numa prop, cláusula que não pode sumir de
  uma dependência, tela nova que esqueceu de declarar uma prop. São coisas que
  se verificam olhando o arquivo porque *são* o arquivo.
- **Lógica se testa por comportamento.** A montagem da chave virou função pura
  num módulo próprio, e o teste passou a afirmar o que importa: mexer em
  `syncPoll`, `retryKey`, período, offset ou loja produz chave **diferente**
  (logo, nunca é barrado); só a repetição idêntica produz chave **igual**. Isso
  sobrevive à próxima refatoração e prova mais.
- **Regra prática:** se para escrever a asserção você precisa saber em que linha
  o identificador mora, é guarda de forma. Se ela sobrevive a renomear variáveis
  e mover código, é teste de regra.

### O instrumento respondeu outra pergunta — quatro vezes no mesmo dia

Quatro erros de medição em 28/08/2026, e os quatro têm a mesma forma: o
instrumento respondeu com clareza a uma pergunta **diferente** da que se queria
fazer, e a resposta limpa passou por verdade.

| O que se queria perguntar | O que o instrumento respondeu | Como apareceu |
|---|---|---|
| Algum **quadro** mostra valor de outro período? | O que havia a cada 100ms | Janelas de 5–52ms passaram: PASSA falso em 3 canais |
| O cache está **acertando**? | Quanto custou a 1ª ida vs. a 2ª | Comparava frio com quente e chamava de melhora |
| A **regra** continua valendo? | Aquele texto ainda está naquela linha? | Refatoração inocente ficou vermelha; e o inverso passaria |
| O **eslint** passou? | O `tail` do pipe terminou bem | Erro impresso na tela, reportado como verde |

O quarto é o mais barato de evitar e o mais perigoso, porque contaminou uma
decisão de outra pessoa: um commit foi feito em cima de um portão que eu disse
estar verde.

**A defesa, e ela vale para o time inteiro:**

1. **Comando de verificação roda sozinho, e o código de saída é lido direto.**
   `pipe` para `tail` ou `grep` serve para LER a saída, nunca para julgar o
   resultado — em shell, `$?` depois de um pipe é do ÚLTIMO comando. Se precisar
   dos dois, guarde o rc antes de filtrar.
2. **Antes de confiar numa medição, escreva a pergunta e leia o instrumento
   perguntando "é isto que ele mede?".** As quatro falhas acima seriam vistas
   nessa leitura, sem rodar nada.
3. **Resposta limpa não é resposta certa.** Todas as quatro vieram sem ruído:
   um PASSA, um "melhorou", um vermelho convincente, um `rc=0`. A ausência de
   ruído não é evidência de nada.
4. **Instrumento que nunca falhou merece a mesma suspeita** de qualquer código
   sem teste. O probe de quadros só ficou confiável quando foi construído para
   falhar num caso conhecido.

Prática que ficou: quando um resultado contraria o esperado, **desconfie primeiro
do instrumento** — foi o que achou o defeito das cinco fatias da Amazon, e o que
evitou "consertar" um teste que estava certo pelo motivo errado.

## Lição de 28/08/2026: medição em conta demo não representa a conta dela

Todas as medições de troca de período tinham sido feitas na **conta demo** —
lojas "Demonstração", ~200 pedidos. A dona continuou relatando lentidão. A
medição na conta real explica por quê:

| Conexão | pedidos | 30 dias · frio | 30 dias · quente |
|---|---:|---:|---:|
| Loja Demo Shopee | 212 | 120ms | **104ms** |
| Loja Demo ML | 187 | 95ms | **82ms** |
| Loja Demo Amazon | 132 | 115ms | **82ms** |
| UTILEIRA (Shopee) | 22.292 | 1436ms | **1457ms** |
| CRYSTALFANCY (ML) | 38.943 | 925ms | **690ms** |

**14 a 17 vezes mais lento na conta real**, e a Shopee estoura o orçamento de 1s
deste ADR em regime quente — o pior caso, porque não há cache frio para culpar.

Repare também que o custo **cresce com o período**: na UTILEIRA, "hoje" custa
133ms e "30 dias" custa 1457ms. Na demo os quatro períodos custam o mesmo
(~80-100ms), porque a tabela inteira cabe em qualquer recorte. Ou seja: a conta
demo não só é mais rápida — ela **esconde a variável que importa**.

Duas regras que ficam:

1. **Toda medição de performance diz em qual conta foi feita.** Um número sem
   essa etiqueta não é comparável com nenhum outro, e induz a conclusão errada
   com a aparência de rigor.
2. **Conta demo serve para provar que funciona, nunca para provar que é rápido.**
   Volume é a variável; medir sem ela é medir outra coisa.

### A consulta "funcionava" e entregava o oposto exato do pedido (29/08/2026)

A dona pediu a página de produtos ordenada **do mais vendido para o menos**. A
primeira versão entregou **os que não venderam no topo** — e a consulta não dava
erro nenhum.

```sql
-- ERRADO: `ORDER BY x DESC` no Postgres é NULLS FIRST.
ORDER BY v.unidades DESC                  -- quem não vendeu (NULL) vem primeiro
-- CERTO:
ORDER BY COALESCE(v.unidades,0) DESC      -- sem venda é 0, e 0 vai para o fim
```

O `COALESCE` **estava no `SELECT`** — a tela mostrava "0 unidades" corretamente.
Só que **`COALESCE` no `SELECT` não ordena**: quem ordena é o `ORDER BY`, e ali o
`NULL` do `LEFT JOIN LATERAL` continuava sendo `NULL`.

📌 **Só apareceu porque a verificação foi feita contra a LOJA REAL antes de
subir.** Na conta demo os 4 produtos têm zero vendas — a ordenação errada teria
passado limpa, e a dona receberia exatamente o contrário do que pediu. É a mesma
lição da medição em conta demo, aplicada a **correção** e não a performance:
*demo prova que funciona, nunca que está certo.*

⚠️ Vale para **qualquer ordenação futura** por métrica agregada: toda coluna que
vem de `LEFT JOIN` pode ser `NULL`, e `NULL` em `ORDER BY ... DESC` vai para o
topo. Ou `COALESCE` no `ORDER BY`, ou `NULLS LAST` explícito.

📌 Consequência para o aquecimento sequencial: se a tela busca os outros três
períodos em fila depois da primeira pintura, o custo do aquecimento é a **soma**,
não a média. Medido na UTILEIRA: abrindo em "hoje", o aquecimento só termina
**2,6 segundos** depois. Quem clicar antes disso espera igual — o pré-carregamento
não ajuda quem chegou primeiro.

## Três exageros num dia — e o terceiro é o mais difícil de pegar (28/08/2026)

Em um único dia, três números/afirmações saíram inflados **a favor de quem os
publicou**. Nos três casos quem derrubou foi o próprio autor. Ficam juntos
porque a família é a mesma e a terceira só fica visível ao lado das duas
primeiras.

| # | O que foi afirmado | O que era | Quem derrubou |
|---|---|---|---|
| 1 | "a consulta nova é **18× mais rápida** (953ms → 52ms)" | 50ms × 46ms — a medida original comparava **cache frio com cache quente** | o autor |
| 2 | "`/api/admin/eu` e `/api/trial` saem **duas vezes** por abertura" | não saíam: a segunda vinha do **documento anterior**, não da abertura nova | a autora |
| 3 | "a manchete **afirma números sob o rótulo de outro recorte**" | o texto **já dizia** "nos últimos 30 dias": era **defasagem e ambiguidade**, mais um **risco latente** (o prompt não *exigia* a janela, então uma geração seguinte poderia escrever "hoje" — e aí sim seria rótulo errado) | o autor |

**1 e 2 são número inflado. 3 é GRAVIDADE inflada — e é a mais perigosa das
três, por ser a menos óbvia.** Número errado alguém confere e refuta; gravidade
errada não tem unidade, então ninguém a checa. Ela faz a equipe **priorizar
errado** e faz quem fala com a dona **alarmá-la sem lastro** — neste caso a
afirmação já tinha convencido o orquestrador e já tinha chegado à dona antes de
ser corrigida.

📌 **A pergunta que pega o caso 3**, e que as outras duas não precisam:
*"qual é a diferença exata entre o que o sistema faz hoje e o que eu estou
dizendo que ele faz?"* — se a resposta for "poderia acontecer", isso é **bala na
agulha, não bala disparada**, e a frase precisa dizer isso. O conserto costuma
valer do mesmo jeito; o que não vale é o motivo dramático.

⚠️ Notar também: o caso 3 foi descoberto **ao conferir o resultado do próprio
conserto**, comparando o texto novo com o antigo lado a lado. Sem essa
conferência a versão inflada teria ficado de pé — o que torna a verificação
pós-entrega parte da entrega, não zelo opcional.

## Defeito sob carga some na hora da investigação (28/08/2026)

A lição mais reutilizável da noite, e ela explica por que **quase todo problema
intermitente é subestimado**.

O caso: abrir 10 conexões — o `max` que o próprio `db.ts` declara — falhou com
`EMAXCONNSESSION` numa medição e **passou** noutra, horas depois. Nada mudou no
código entre as duas. O que mudou foi **quem mais estava usando o pooler naquele
instante**.

O perigo não é a falha; é a **passagem**. Quem for conferir num momento de app
ocioso conclui, **de boa-fé e com medição na mão**, que o problema não existe. A
medição não mente — ela responde a pergunta errada.

**### ⚠️ A lição escrita não impede a repetição — só o procedimento impede

Registro de um episódio do mesmo dia, porque ele é o argumento mais forte a favor
de defesa **estrutural** contra defesa por **memória**:

A armadilha "comparar cache frio com cache quente" foi escrita **neste ADR**, por
mim, em 28/08/2026. **Horas depois**, medindo aquecimento sequencial contra
paralelo, rodei os dois **no mesmo processo**, um em seguida do outro. Resultado:
*1251ms contra 220ms — "o paralelo é 5× mais rápido"*. Era falso: o paralelo
reusou o cache que o sequencial acabara de aquecer. Refeito com cada modo em
**processo separado** e rodadas alternadas, o ganho real era de ~500ms (20%).

Eu tinha escrito a lição, revisado a lição, e caí nela no mesmo dia.

**Conclusão que vale para o repo inteiro, não só para medição:** lição escrita é
documentação, não defesa. O que impede a repetição é o **procedimento** — aqui,
"cada modo roda num processo novo", que torna a contaminação impossível em vez de
depender de alguém lembrar. É a mesma forma das outras defesas do dia: a
conferência de árvore limpa colada no `fly deploy`, a versão do prompt na chave
do cache, o teste que lê a seção Decisão do ADR.

Onde a correção depender de memória, ela vai falhar — inclusive com quem escreveu
a regra.

A defesa: meça o que é CONSTANTE, não o SINTOMA.**

| | |
|---|---|
| Sintoma (enganoso) | "as 10 simultâneas falham" — depende de carga concorrente |
| Constante (decide) | "o teto de clientes é 14 num modo e 30+ no outro" — não depende de nada |

O sintoma depende de uma condição que **você não controla no momento da medida**.
A constante, não. Quando um defeito só aparece sob carga, procure a **grandeza
estrutural** que o causa e meça ela — senão o resultado do teste passa a ser
sorteado.

📌 Corolário para reportar: um teste que passa nas **duas** alternativas não é
evidência a favor de nenhuma. Vale dizer isso em voz alta ao entregar, porque
"passou em 371ms" soa como confirmação e não é.

### As sete lições de instrumento de 28–29/08/2026, e o fecho delas

| # | O instrumento | O que ele respondeu de verdade |
|---|---|---|
| 1 | Medição de A/B no mesmo processo | comparou **cache frio com quente** — "18× mais rápido" era 8% |
| 2 | Conta demo | prova que **funciona**, nunca que é **rápido** nem que está **certo** (a ordenação invertida passaria limpa nela) |
| 3 | Teto de conexões | mediu o teto de **cliente** (14 → 30+) e não o de **servidor**, que foi o que mordeu |
| 4 | Número de versão vindo de outra pessoa | é a **última leitura dela**, não o estado do sistema — confira na máquina |
| 5 | Incidente público de terceiro | correlacionava e **não explicava**: componente diferente, janela que não fecha |
| 6 | Health check que não toca a dependência | prova que o **processo subiu** — deu verde durante 7 minutos de app fora |
| 7 | Coletor de métricas | rodava uma agregação de **30 dias por raspagem**, empilhou 7 cópias e **derrubou produção** |

As seis primeiras são o instrumento **dando resposta errada**. A sétima é o
instrumento **virando a carga** — e é a mais cara, porque métrica é justamente a
coisa que se instala para *observar* o sistema, não para pesar nele.

> **O instrumento tem custo, e o custo tem que ser medido como qualquer outro.**

Isso não é sobre contar o que aconteceu: é sobre o que se faz na próxima vez que
alguém for instalar uma medição. Antes de ligar qualquer coisa que observe
produção, pergunte **quanto ela custa por execução e com que frequência roda** —
e se não souber responder, isso é a primeira medição a fazer.

📌 E a pergunta irmã, que veio do mesmo incidente: **"existe um jeito de desligar
isto em segundos?"** — às 02:55, com a dona fora do ar, a única saída conhecida
era um deploy de 4 minutos. Freio de emergência por variável de ambiente é
requisito de qualquer coisa que toque o banco, não luxo.

## As seis lições de 29/08/2026 — e a regra que fecha todas elas

Um dia com duas indisponibilidades, a dona trancada para fora, um alerta de
plataforma e quatro telas com número errado. As lições abaixo têm ordem: a última
é a que decide se as outras cinco valem alguma coisa.

### 11. A causa não está em nenhum subsistema — está no padrão que os chama

Na mesma madrugada: 28 transações brigando por um pool de 10, e N renovações de
sessão brigando por 1 refresh token de uso único. Dois subsistemas que não se
conhecem, com o mesmo sintoma.

> **Quando o mesmo sintoma aparece em partes que não se conhecem, o defeito é a
> tela pedir N vezes o que precisava pedir uma.**

### 12. Uma proteção correta em isolado pode ser destrutiva no sistema onde foi instalada

Às 2h da manhã o `/api/health` passou a devolver **503** quando o banco não
responde. Isso é honesto e resolveu uma mentira real. Só que **a máquina é uma
só**: 503 fazia o Fly marcar a única instância como *critical*, o proxy ficava
sem candidato, e a requisição girava ~18s antes de entrar. Medido: health de
**19,29s** com o banco respondendo em **360ms**, e de dentro da máquina o mesmo
endpoint em **0–1ms**.

> **A correção transformou soluço de banco em apagão.** Health check que reprova
> por dependência é certo quando existe para onde fazer failover; com instância
> única, é autoagressão. A diferença não está na proteção — está no que existe
> ao redor dela.

Consequência: `/api/vivo` (liveness, não toca o banco) é o que o Fly usa;
`/api/health` continua reprovando com 503, porque a informação é verdadeira e é
nossa. Quem decide derrubar a máquina não pode ser uma dependência externa.

### 13. Conferir o NÚMERO não é conferir o SIGNIFICADO DA COLUNA

O sinal de "ruptura de estoque" do briefing nunca tinha rodado (erro de parse no
SQL). Consertado, testado **contra a conta real**, o número bateu com a apuração
manual — 664, exato. E ainda assim o sinal era falso: `available_qty` é
`NOT NULL`, então **três estados diferentes chegavam como o mesmo zero** — "a
fonte disse zero", "a fonte não falou deste anúncio" (435 dos 739 anúncios da
Shopee) e "nunca sincronizamos". Os cinco produtos que o NEXO ia anunciar como
ruptura eram, em três casos, anúncios que a Shopee não devolveu no snapshot.

> **Número certo, lido de coluna que quer dizer outra coisa, passa por todos os
> testes, bate com o dado real, e mente.** Consertar consulta que nunca rodou é
> escrever consulta nova — e consulta nova exige conferir o que a coluna
> significa, não só se o total fecha.

### 14. Um número pode estar certo, ser medido com rigor, e responder à pergunta errada

Sobre o lote da variação eu reportei **"83 de 85 casam"**. Era verdade, e era a
resposta para *"os itens já gravados no formato novo acham anúncio?"*. A pergunta
que importava era o inverso — *"quanto da venda do período a linha de variação
consegue enxergar?"* — e a resposta é **401 de 22.589: 1,8%**.

Guarde o par: **83/85 contra 401/22.589**. O número errado era o mais
confortável dos dois, e uma decisão de não reverter foi tomada com ele.

> **Quando a medição calha de ser tranquilizadora, ninguém procura a outra
> pergunta.**

Da mesma família, no mesmo dia: `git grep applied` na saída do runner de
migration devolveu cinco ocorrências — todas de migrations **anteriores**. O
apply tinha sido BLOQUEADO. Ler a saída procurando a palavra que se quer
encontrar. A defesa que funcionou foi conferir **no banco** se a tabela existia:
confirmação no estado final, nunca na mensagem de sucesso.

### 15. Quando o sistema não sabe a causa, ele não pode escolher uma

Três telas de manhã diziam que a conexão **dela** tinha problema quando quem
falhou fomos nós — e uma delas oferecia um botão de *mexer na conexão*, que
podia queimar uma autorização intacta do TikTok em review. À tarde, a tela da
Shopee dizia *"a Shopee ainda não postou o extrato"* quando boa parte era porque
**nós nunca perguntamos** (`settlement_attempt_at` nulo em 20.162 de 20.162).

De manhã o sistema culpou a usuária; à tarde culpou o fornecedor dela. Duas vezes
no mesmo dia, em código sem relação.

> **Isso não é coincidência, é viés: no escuro, o sistema escolhe uma explicação
> — e a evidência de hoje diz que ele nunca escolherá a si mesmo.** Enquanto não
> houver marca que distinga, a frase honesta não afirma nenhum dos dois lados.

### 16. O sucesso de uma etapa pode ser a condição de parada de outra

A conciliação de escrow da Shopee só rodava **enquanto o sync de pedidos tinha
trabalho**. No dia em que a ingestão alcançou o presente e a linha de status
virou `complete`, o passo inteiro passou a retornar em **zero segundo** e a
conciliação deixou de existir — com **17 mil pedidos** na fila, **nenhuma
exceção, nenhum log, nenhum alarme**. A única pista era uma data no dado: nada
liquidado depois de 12/08.

Aconteceu **duas vezes no mesmo dia**, na mesma linha de status: às 2h o sweep de
catálogo, à tarde o escrow.

> **Não parou o marketplace: paramos nós, e paramos porque terminamos outra
> coisa.** Uma linha de status para trabalhos de naturezas diferentes faz um
> trabalho que ACABA silenciar um que NUNCA acaba. E isso não produz erro:
> produz silêncio.

Irmã da rede de segurança que não conta quantas vezes salvou: **o perigo não está
no que falha barulhento, está no que para quieto.**

### 17. "Não sei" é uma resposta honesta que também é um lugar confortável para descansar

A lição do dia sobre instrumento tinha um segundo andar que só apareceu no fim
dele.

**O caso (29/08/2026).** A pergunta era se a Shopee informa a taxa antes de
liquidar. Eu tinha o ceticismo certo: notei que os pedidos com menos de 46 dias
apareciam sem tarifa, apliquei a regra do dia — *ausência de escrita não é
ausência de tentativa* — e descobri que **nunca tínhamos perguntado** por nenhum
pedido daquela faixa. Concluí, corretamente, *"não posso confirmar; o penhasco é
a fronteira do nosso dreno, não a política da Shopee"*.

E **parei ali**.

> **Ceticismo bem calibrado me impediu de afirmar o falso, mas não me fez ir
> buscar o verdadeiro.**

Foi preciso o argumento da vendedora — *se o faturamento bate com outro software
e outro software mostra margem, então a comissão é obtenível* — para transformar
o "não sei" em "então vá medir". Vinte chamadas depois, a resposta estava lá:
`order_income` **com valor em 20 de 20**, inclusive nos pedidos do próprio dia.

**O que isso completa.** A gente aprendeu a **não afirmar o que não mediu**. Ainda
não tinha aprendido a **ir medir o que declarou não saber**. São defeitos
opostos e o segundo é mais difícil de ver, porque a saída dele *parece* rigor:
ninguém revisa uma pendência bem escrita.

> **Dúvida registrada sem medição agendada vira arquivo morto.**

**A defesa executável — e ela não é um teste, é um formato obrigatório:**

> **Toda pendência do tipo "não sabemos se X" nasce com a MEDIÇÃO QUE A RESOLVE
> escrita ao lado: qual chamada, contra o quê, e o que decide.** Sem as três, não
> é pendência — é anotação. E "quando der" não é quando: precisa de um gatilho
> observável.

Pendência sem medição é indistinguível de pendência com medição na hora em que
alguém lê — e é por isso que a exigência tem que estar no formato, não na
disciplina de quem escreve.

### 18. Frase que é verdade e engana é pior que frase errada

`docs/api-shopee.md` dizia, sobre `get_escrow_detail`: *"Só disponível após o
pedido pago/concluído"*. Está **correto**. E foi lido, por mim e pelo
orquestrador, como *"só depois da liquidação"* — o que fez um canal inteiro
esperar ~50 dias por um número disponível no dia zero.

> **Frase errada alguém confere. Frase verdadeira que engana ninguém confere —
> ela passa na revisão exatamente porque é verdade.**

Mesma família do selo verde de "Composição completa" que se declarava completo em
relação à própria lista de componentes, enquanto ignorava a maior despesa do
período: cada um estava certo dentro do próprio escopo, e os dois enganavam
justamente por isso.

O conserto não é "escrever certo" — já estava certo. É escrever **contra a
leitura errada previsível**: a linha agora diz *"responde a partir de `paid`, no
dia do pedido — não espera a liquidação"*, que é a mesma verdade escrita para
impedir a confusão que ela causou.

### A regra que fecha a seção

Escrevi "não usar crase dentro de template literal" depois de errar isso três
vezes numa semana. Na quarta vez, errei de novo — e o `tsc` passou **verde**,
porque as crases estavam balanceadas e o TypeScript parseou como concatenação.
Teria subido SQL corrompido com o typecheck limpo. Quem pegou foi um **teste**
escrito depois da terceira vez.

> **Lição anotada não impede repetição. Só a defesa executável impede.**

Vale para tudo que está escrito acima: cada lição deste dia só conta se virou
**teste, gate ou porta única**. As que ficarem só como texto, a gente repete.

O que virou defesa em 29/08/2026:

| Lição | Defesa executável |
|---|---|
| 11 | contador de checkouts do pool (`checkoutsDoPool`) e o mapa da carga da tela |
| 12 | `/api/vivo` como liveness; `fly.toml` não aponta mais para readiness |
| 13 | `tests/centralDiagnostico.test.mjs` — exige anúncio ATIVO e agregação antes do join |
| 14 | — *(esta não tem defesa automatizável; é regra de método)* |
| 17 | formato obrigatório da pendência: medição + gatilho ao lado (ver ADR-034 e a pendência da comissão em `docs/api-shopee.md`) |
| 18 | — *(regra de escrita: a revisão tem que perguntar "como isto pode ser lido errado?", não só "isto está correto?")* |
| 15 | `tests/erroNaoCulpaAUsuaria.test.mjs` e `tests/escrowNaoRepeteNemPula.test.mjs` |
| 16 | `tests/escrowNaoRepeteNemPula.test.mjs` — exige o claim próprio de conciliação |
| crase | `tests/*` — nenhum comentário SQL usa crase dentro de template literal |
| `after()` | `tests/afterEhSempreFundo.test.mjs` — proíbe importar `after` fora da porta única |
| `workspace_id` | `tests/workspaceIdNaoDependeDeLembranca.test.mjs` — allowlist com motivo |

As linhas 14 e 18 estão vazias de propósito, e isso é informação: **são as
lições que continuam dependendo de alguém lembrar.** A 17 quase ficou vazia
junto — a defesa dela não é um teste, é uma exigência de formato, e formato só
vale se quem revisa recusar a pendência que chega sem medição ao lado.

## ⚠️ Pendência nomeada: a ida repetida é MULETA, não só desperdício (28/08/2026)

Achado da Vitrine, e ele muda como se olha performance de abertura em **qualquer**
canal. Fica aqui porque a próxima pessoa que medir requisições repetidas vai
querer removê-las, e removê-las hoje **quebra a tela**.

O overview da Shopee faz 3 idas na abertura. Duas tentativas de guarda contra
repetição foram implementadas e **as duas deixaram a tela em branco por 45
segundos** (medido). O defeito não está na guarda:

> O `cancelled` do efeito significa **"o efeito rodou de novo"**, não **"esta
> resposta não interessa mais"**. Quando a rodada seguinte é *pulada* pela
> guarda, a rodada anterior **já foi marcada como cancelada** pela limpeza e a
> resposta dela é descartada — e aí ninguém entrega o dado.

**É a ida repetida que repõe o que a cancelada jogou fora.** Por isso a
repetição parece desperdício e é, na prática, o que mantém a tela viva.

**Desenho proposto (não implementado):** o cancelamento vira **por ALVO** —
*"esta resposta ainda é a que a tela quer?"* — em vez de **por rodada**. Com
isso, pular uma ida em voo deixa de descartar a resposta que estava chegando, e
a guarda contra repetição passa a ser segura.

Enquanto isso não existir, a única guarda segura é a de busca **já respondida**:
resposta aplicada não depende de ninguém repor. A armadilha está escrita também
no `ShopeeWorkspace.tsx`, no ponto exato onde alguém tentaria acrescentar a
guarda.

📌 **Regra que fica:** *consertar a repetição sem consertar o cancelamento troca
lentidão por tela vazia* — e tela vazia é incomparavelmente pior. Ninguém
desconfia de um número que demora; todo mundo desconfia de uma tela que não
mostra nada.

📌 **Correção da própria autora, registrada porque a lição é de método:** a
medição inicial dizia que `/api/admin/eu` e `/api/trial` saíam duas vezes por
abertura. Não saíam — a segunda vinha do **documento anterior**, não da abertura
nova. O ganho real do helper é menor do que o anunciado, e quem derrubou o
número foi ela mesma. É o mesmo erro de medição do "18× mais rápido" desta ADR:
**número a favor da própria entrega é o mais perigoso que existe.**

## Ordem de execução

1. **Rota agregadora** `/api/amazon/dashboard` lendo do canônico (o que der do canônico
   hoje; o resto explicita o gap).
2. **Conserto da ingestão** da conta da dona (pedidos `pending` sem itens).
3. Dashboard da Amazon consome a rota nova; medir de ponta a ponta na conta grande.
4. Replicar o padrão para ML, Shopee e TikTok (que já leem do banco, mas em N chamadas).
5. Botão "Atualizar agora" (ao-vivo explícito) onde fizer falta.

Relacionado: [ADR-001](./ADR-001-modelo-canonico.md) ·
[ADR-002](./ADR-002-cache-swr.md) ·
[ADR-016](./ADR-016-ciclo-de-vida-do-dado.md) ·
[`../architecture/read-and-cache.md`](../architecture/read-and-cache.md)

## Adendo de 01/09/2026 — revisão de desenho não substitui olhar a tela

Registrado a pedido do cérebro, depois da terceira vez no mesmo dia em que a
consequência na tela achou o que o raciocínio não achou.

Na [ADR-027](./ADR-027-tarifa-estimada-ate-a-liquidacao.md), a view de tarifa
efetiva substituía a estimativa **por pedido**. A justificativa soava certa e
citava um princípio real da casa ("não misturar bases"). Ela passou pelo desenho
de quem propôs, pelo portão de quem aprovou e pelo texto do ADR.

Quem pegou o defeito foi quem foi **implementar**, e a pergunta que o pegou não
foi sobre schema: foi **"o que a pessoa vê quando isso acontece?"**. A resposta
era um custo que encolhe sozinho quando a comissão é postada, o lucro subindo, e
caindo de novo quando a logística entra. Medido depois: aconteceria em **95,3%**
dos pedidos.

**A prática que fica:** antes de fechar um desenho que alimenta a tela, perguntar
o que a pessoa vê em cada estado intermediário — não só se o modelo está correto
no estado final. Estado transitório invisível na modelagem é visível para quem
usa, e é lá que a credibilidade se perde.

⚠️ E o corolário, que é sobre medir: quem achou o defeito o descreveu como "um
número que oscila em alguns casos". Era 95,3% dos pedidos. **Errar o tamanho de
um problema em duas ordens de grandeza decide se ele vira nota de rodapé ou
bloqueio** — então a frequência se mede antes de classificar, não depois.
