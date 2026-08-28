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
