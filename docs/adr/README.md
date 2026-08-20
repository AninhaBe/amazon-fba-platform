# ADR — Architecture Decision Records

Registro das **decisões de arquitetura** do SellerCore: o que foi decidido, o
**porquê**, e as **consequências** (trade-offs) — as escolhas caras de reverter.

Serve como fonte de verdade: ao implementar uma feature semanas depois, aponte a IA
(ou um dev novo) para o ADR relevante em vez de re-explicar tudo. Regra do projeto
(ver [`AGENTS.md`](../../AGENTS.md)): **não mude uma decisão arquitetural enquanto
implementa** — se uma feature exigir mudar, pare e proponha um novo ADR.

## Como escrever

Um arquivo por decisão, `ADR-<n>-<slug>.md`, curto. Template:

```markdown
# ADR-000: Título da decisão

- **Status:** Proposto | Aceito | Substituído por ADR-XXX
- **Data:** AAAA-MM-DD

## Contexto
O problema e as forças em jogo (por que precisamos decidir).

## Decisão
O que foi decidido, em uma ou duas frases claras.

## Alternativas consideradas
O que mais estava na mesa e por que não.

## Consequências
O que ganhamos, o que abrimos mão, o que passa a ser obrigatório respeitar.
```

## Índice

| ADR | Decisão | Status |
|---|---|---|
| [ADR-001](./ADR-001-modelo-canonico.md) | Modelo canônico único (provider-agnostic) em vez de tabela por canal | Aceito |
| [ADR-002](./ADR-002-cache-swr.md) | Cache stale-while-revalidate + aquecimento | Aceito |
| [ADR-003](./ADR-003-cron-github-actions.md) | Cron via GitHub Actions (Render ignora `vercel.json`) | Aceito |
| [ADR-004](./ADR-004-custo-por-vigencia.md) | Custo do produto resolvido na consulta, por vigência | Aceito |
| [ADR-005](./ADR-005-painel-personalizado.md) | Painel personalizado — preferências de KPI por workspace | Proposto |
| [ADR-006](./ADR-006-migracao-self-hosted-coolify.md) | Migração para stack self-hosted open source (Coolify) | Proposto |
| [ADR-007](./ADR-007-arquitetura-de-auth.md) | Arquitetura de autenticação e autorização (Better Auth) | Proposto |
| [ADR-008](./ADR-008-seller-intelligence.md) | Seller Intelligence — briefing diário de prioridades | Proposto |
| [ADR-009](./ADR-009-historico-de-ranking.md) | Histórico de ranking (tendência de BSR) | Proposto (v1 em implementação) |
| [ADR-010](./ADR-010-historico-de-oferta.md) | Histórico de oferta (estoque, preço e disponibilidade) | Aceito (v1 em implementação) |
| [ADR-011](./ADR-011-watchlist-de-pesquisa.md) | Watchlist de pesquisa (identidade dos ASINs acompanhados) | Aceito |
| [ADR-012](./ADR-012-contrato-0005-sem-runtime-role.md) | Contrato da 0005 sem exigência de runtime role dedicada | Aceito |
| [ADR-013](./ADR-013-worker-de-sync-separado-do-web.md) | Worker de sync separado do web + agendador que honra o horário | Proposto |
| [ADR-014](./ADR-014-cache-fora-do-processo-e-ingestao-em-fluxo.md) | Cache fora do processo e leituras com teto de memória (escala além de ~50 contas) | Proposto |
| [ADR-015](./ADR-015-compute-em-sao-paulo-com-banco-gerenciado.md) | Compute em São Paulo com banco gerenciado — divide o ADR-006 em fases | Proposto |
| [ADR-016](./ADR-016-ciclo-de-vida-do-dado.md) | Ciclo de vida do dado: toda tabela responde "quando isso morre" | Aceito |
| [ADR-017](./ADR-017-orcamento-de-1s-e-leitura-agregada.md) | Orçamento de 1s: uma tela, uma chamada, banco só — SP-API fora do caminho interativo | Aceito |
| [ADR-018](./ADR-018-ingestao-por-evento.md) | Ingestão por evento: push primário, cron como reconciliação permanente | Aceito |
| [ADR-019](./ADR-019-agendador-interno.md) | Agendador interno no processo (Fly 24/7); GitHub Actions vira fallback | Aceito |
| [ADR-020](./ADR-020-definicao-unica-de-faturamento.md) | Bruto (espelha o marketplace) × conciliado (só aprovadas): perguntas diferentes, rótulo obrigatório | Aceito |

**Índice completo em 16/08/2026** — 14 ADRs, todos listados. Ao criar um ADR novo,
adicione a linha aqui na mesma hora; este índice já ficou 8 ADRs atrás uma vez.
