# ADR-011: Watchlist de pesquisa (identidade dos ASINs acompanhados)

- **Status:** Aceito
- **Data:** 2026-08

## Contexto

O [ADR-009](./ADR-009-historico-de-ranking.md) criou `workspace_rank_history`, que guarda
a **série de números** (`asin, captured_on, rank, category`) e nada mais. Isso basta para
a setinha ↑/↓ na `/pesquisa`, onde o título e a foto vêm da resposta da busca no mesmo
request — mas **não** basta para uma tela de histórico: sem busca acontecendo, só temos
códigos crus (`B0H9R1888D`).

Falta também **rastro de intenção**: qual termo trouxe aquele ASIN, quando ele entrou na
lista, e se ele ainda interessa. Sem isso, a auto-watchlist do cron só cresce — e o teto
de `MAX_ASINS` (rate limit da SP-API) começa a cortar ASINs em ordem arbitrária, em
silêncio.

## Decisão

### Tabela `workspace_watchlist` — uma linha por ASIN (não por dia)
```
workspace_id     TEXT
asin             TEXT
title            TEXT
brand            TEXT
image_url        TEXT
last_search_term TEXT         -- de qual busca ele veio (o mais recente)
first_seen_at    TIMESTAMPTZ  -- quando entrou na lista
last_seen_at     TIMESTAMPTZ  -- última vez visto numa busca
pinned           BOOLEAN      -- marcado como importante pela usuária
removed_at       TIMESTAMPTZ  -- tirado da lista (soft delete)
PRIMARY KEY (workspace_id, asin)
```

Separação de responsabilidades: `workspace_rank_history` é a **série temporal**,
`workspace_watchlist` é o **quem é quem**. O histórico nunca é apagado por remoção — sair
da lista só interrompe a captura, não destrói o passado. Se o ASIN voltar, a série antiga
volta junto.

### Preenchimento a custo zero de API

Dois caminhos, ambos sem nenhuma chamada extra:

1. **Na busca** — `searchProducts` já devolve `title`, `brand` e `imageUrl`. A rota
   `/api/search` passou a gravar identidade **e** o termo pesquisado junto com o rank.
2. **Sob demanda, em lote** — a mesma operação da busca aceita `identifiers` em vez de
   `keywords`: **até 20 ASINs por chamada**. A rota da watchlist resolve um lote de quem
   ainda está sem título a cada requisição, e a tela repete até completar. É isso que
   torna a lista herdada legível **na hora**, em ~6 chamadas para 102 ASINs, em vez de
   esperar um dia pelo cron.
3. **No cron** — `amazonRankSnapshot` já chamava a Catalog API por ASIN pedindo
   `includedData=salesRanks`. Passou a pedir `salesRanks,summaries,images` na **mesma
   chamada**: título, marca e foto vêm de brinde. É isso que preenche a identidade dos
   ASINs que entraram no histórico antes desta ADR (backfill natural, sem script).

### Prioridade da foto diária (resolve o corte silencioso)

A ordem de captura no cron passa a ser explícita:

```
fixados  →  produtos da conta  →  demais, por last_seen_at DESC
```

e só então aplica o teto. ASIN com `removed_at` preenchido não entra. O corte deixa de ser
arbitrário: o que a usuária marcou nunca é descartado, e ela tem como limpar o que entrou
por uma busca solta.

### Justiça entre contas na foto diária (bug encontrado ao implementar)

Diagnóstico do banco em 02/08: a conta `AO62LVXJMX3AA` não recebia nenhuma foto **desde
28/07**, enquanto a outra conta do mesmo cron era fotografada quase todo dia — com
contagens erráticas (106, 121, 37, 53 ASINs).

Causa: `runScheduledRankSnapshot` percorria as contas em sequência ordenadas por
`workspace_marketplace_syncs.updated_at DESC` — ordem sem relação nenhuma com quem
precisa de foto. A conta com a maior watchlist caía em primeiro, e como cada ASIN é uma
chamada à Catalog API com rate limit, ela consumia o `maxDuration` da rota inteiro. A
segunda conta nunca era alcançada, e a primeira era cortada em pontos diferentes a cada
dia (daí as contagens erráticas).

Correções:

1. **Ordem por carência:** `ORDER BY max(captured_on) ASC NULLS FIRST` — quem está há mais
   tempo sem foto vai primeiro. Quem não couber hoje é o primeiro da fila amanhã.
2. **Orçamento de tempo explícito** (`TOTAL_BUDGET_MS`), dividido entre as contas da
   passada. Garante que a segunda da fila ainda rode dentro do `maxDuration`.
3. **Cobertura parcial sempre logada.** Sem isso, "nada novo" e "faltou tempo" ficam
   indistinguíveis, e o histórico ganha buracos sem explicação — foi exatamente o que
   escondeu esse bug por cinco dias.

### Tela `/pesquisa/historico`

Uma linha por produto acompanhado: foto + título, rank atual, variação **7d** e **30d**,
minigráfico da curva, desde quando, e as ações **fixar** / **remover**. No topo, chips com
os termos já pesquisados, clicáveis para refazer a busca.

**Variação é estrita:** só é exibida quando existe foto **em ou antes** do corte (7 ou 30
dias). Sem isso, mostra `—`. Um delta de 3 dias exibido na coluna "7 dias" seria mentira
escaneável — e o valor da tela inteira depende de ela não mentir.

## Honestidade

- **Sem retroativo** (herdado do ADR-009): a curva começa no dia em que o ASIN entrou.
- **A identidade pode envelhecer.** Título e foto são do dia da última captura; se o
  vendedor mudar o anúncio, a linha só atualiza na próxima passada do cron.
- **`removed_at` é soft delete de propósito.** Remover não apaga histórico, e a tabela
  não encolhe. Se um dia isso pesar, a limpeza é de `rank_history` por retenção — decisão
  separada, não desta ADR.
- **A semente traz os produtos da própria conta.** `workspace_rank_history` não distingue
  ASIN pesquisado de ASIN próprio (a foto diária captura os dois), então a semente inicial
  inclui os produtos da usuária. Preferimos isso a perder a continuidade da série. A partir
  daí a separação vale: o cron só grava identidade de quem está na watchlist, e o que não
  interessa sai com um clique em **remover**.

## Alternativas consideradas

- **Denormalizar título/foto dentro de `rank_history`:** rejeitado — repetiria a
  identidade em cada linha diária e não teria onde guardar `pinned`/`removed_at`.
- **Tabela separada de log de buscas (`workspace_search_log`):** rejeitado por YAGNI. O
  termo mais recente na watchlist já responde "o que eu pesquisei" e alimenta os chips.
  Se um dia interessar frequência ou histórico de termos, vira tabela própria.

## Consequências

- ➕ A `/pesquisa` deixa de ser sem memória: o que foi pesquisado vira lista acompanhada.
- ➕ Nenhuma chamada de API a mais — os dois pontos de captura já estavam pagos.
- ➕ O teto de ASINs/dia passa a cortar por prioridade declarada, não por acaso.
- ➖ Mais uma tabela para manter em `db.ts`.
- ➖ Identidade defasada até a próxima foto do cron.
