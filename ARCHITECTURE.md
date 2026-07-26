# Arquitetura do SellerCore

> Plataforma multicanal de inteligência de vendas (Amazon, Mercado Livre e futuros
> canais) em **Next.js 16 / React 19**, com dados isolados por *workspace* e um
> **modelo canônico único** para o qual todos os marketplaces convergem.

A documentação de arquitetura foi quebrada em **docs focados** (mais fácil de apontar
"leia estes 2 arquivos" do que "leia a arquitetura inteira"). Comece pela visão geral:

## Arquitetura — [`docs/architecture/`](./docs/architecture/)

| Doc | Conteúdo |
|---|---|
| [`overview.md`](./docs/architecture/overview.md) | **Comece aqui.** Ideia central, stack, contexto/isolamento, fluxo de uma visita, mapa de arquivos, estado da migração. |
| [`canonical-model.md`](./docs/architecture/canonical-model.md) | O modelo canônico (conceito). Detalhe do esquema em [`docs/canonical-schema.md`](./docs/canonical-schema.md). |
| [`sync-engine.md`](./docs/architecture/sync-engine.md) | Ingestão (sync com janela + lease) e agendamento (cron). |
| [`read-and-cache.md`](./docs/architecture/read-and-cache.md) | Leitura por SQL (overview canônico) e cache stale-while-revalidate. |

## Decisões — [`docs/adr/`](./docs/adr/)

Os **porquês** das escolhas caras de reverter (modelo canônico, cache, cron, custo por
vigência). Regra do projeto: não mudar uma decisão arquitetural enquanto implementa —
se precisar, pare e proponha um novo ADR (ver [`AGENTS.md`](./AGENTS.md)).

## Outros docs úteis

- APIs dos marketplaces: [`docs/api-amazon-sp-api.md`](./docs/api-amazon-sp-api.md), [`docs/api-mercado-livre.md`](./docs/api-mercado-livre.md)
- Setup e funcionalidades: [`README.md`](./README.md)
