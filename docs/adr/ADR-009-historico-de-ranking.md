# ADR-009: Histórico de ranking (tendência de BSR)

- **Status:** Proposto (v1 em implementação)
- **Data:** 2026-07

## Contexto

A Amazon **não** expõe histórico de BSR — a Catalog API só devolve o rank **atual**.
Para ver tendência ("o que está subindo"), o histórico precisa ser **capturado por
nós ao longo do tempo**. Consequência inescapável: **não há retroativo** — a série só
começa a partir do momento em que ligamos a captura. Por isso, ligar **quanto antes**.

## Decisão

### Tabela `workspace_rank_history` (workspace-scoped, no `db.ts`)
```
workspace_id TEXT
asin         TEXT
captured_on  DATE           -- 1 linha por dia por ASIN (upsert)
rank         INTEGER
category     TEXT
updated_at   TIMESTAMPTZ
PRIMARY KEY (workspace_id, asin, captured_on)
```

### Captura oportunista na busca (v1 — começa agora)
Toda busca na `/pesquisa` **grava o rank atual dos resultados** — o rank já vem na
resposta da Catalog API, então **custo zero** (nenhuma chamada extra). Upsert por dia:
o último rank visto naquele dia fica. Assim o histórico acumula desde já para tudo que
a usuária pesquisa.

### Foto diária no cron (v1.1 — próximo estágio)
Para cadência **consistente** (mesmo sem buscar), o cron diário re-fotografa a
**auto-watchlist** = ASINs já presentes no histórico. 1 chamada por ASIN, com cap e
concorrência limitada. Roda dentro do scheduler por workspace.

### Exibição e insight (v1.2 — revisar com a usuária)
- `/pesquisa`: **setinha ↑/↓ + variação** vs. a foto anterior (ou de N dias).
- Briefing (Seller Intelligence): insight **"subindo forte"** quando o rank melhora
  muito num curto intervalo — reaproveita o padrão de detector do [ADR-008](./ADR-008-seller-intelligence.md).

## Honestidade
- **Sem retroativo**: só daqui pra frente; os deltas aparecem depois de 2-3 dias.
- **BSR é ruidoso**: item de baixo volume pula muito. A variação exibida deve
  **suavizar** (média de dias) e destacar só **movimentos relevantes**, **na mesma
  categoria** — senão vira alarme falso.
- **Watchlist limitada**: não dá pra fotografar a Amazon inteira; só o que entra no
  histórico (via busca ou watchlist).

## Alternativa considerada
- **Serviço externo (Keepa etc.):** teria histórico **retroativo** na hora, mas é
  **pago** e dependência externa. Rejeitado para o v1 (ethos free/self-hosted);
  reconsiderar se a captura própria não bastar.

## Consequências
- ➕ Começa a valer **hoje**, de graça (captura na busca).
- ➕ Casa com o cron e o briefing (tendência vira insight).
- ➖ Só serve depois de acumular alguns dias; não há passado.
- ➖ A foto diária custa 1 chamada/ASIN/dia (limitar a watchlist).
