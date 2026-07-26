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
