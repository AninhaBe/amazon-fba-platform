# ADR-008: Seller Intelligence — briefing diário de prioridades

- **Status:** Proposto
- **Data:** 2026-07
- **Relacionado:** [plano de aquisição e posicionamento](../plans/plano-aquisicao-e-posicionamento.md) (o "porquê"/GTM)

## Contexto

O posicionamento do SellerCore deixa de ser "mais um dashboard" e passa a ser um
**analista diário da operação**: transformar os dados em um **briefing curto de
prioridades**, onde cada item responde *o que mudou, por que importa e o que fazer*.

Restrições desta ADR (v1):
- Começar pelos insights **computáveis hoje** (ruptura, velocidade, margem) — todos
  usam dados que já temos (radar de estoque, vendas por dia, lucro conciliado).
- Rodar no **stack atual** (free tier), **sem depender** da migração Coolify (ADR-006).
- Detecção **100% determinística** — **sem IA** no texto do v1 (o próprio GTM alerta
  contra depender de IA generativa). IA, se um dia entrar, é só para *contextualizar*
  achados que já vêm de detector determinístico — nunca para inventar o achado.

O `OperationPending` atual ("pendências da operação") é um precursor disto e pode ser
absorvido pelo briefing mais adiante.

## Decisão

### Insights materializados (rodam no cron, gravam numa tabela)
Os **detectores** rodam no **cron/sync diário** já existente (`api/cron/amazon-sync`,
`.../mercado-livre-sync`), **após** a materialização dos dados, e gravam em
`workspace_insights`. O briefing só **lê** a tabela. Isso dá persistência (ciclo de
decisão, histórico, "detectado em…") e leitura barata — sem infra nova.

### Modelo de dados — `workspace_insights` (workspace-scoped, criado no `db.ts`)
```
workspace_id   TEXT
id             TEXT   -- fingerprint = tipo + entidade (SKU/ASIN + canal)
type           TEXT   -- ruptura | velocidade | margem | ...
provider       TEXT   -- amazon | mercado_livre
entity_ref     TEXT   -- SKU/ASIN a que o insight se refere
severity       INT    -- prioridade (para ordenar o briefing)
title          TEXT
evidence        JSONB  -- os números que sustentam o achado
impact          JSONB  -- estimativa (com premissa) do que está em jogo
recommendation  TEXT   -- frase de ação, montada por template
action_href     TEXT   -- link direto para a tela onde agir/investigar
status          TEXT   -- novo | adiado | dispensado | resolvido
detected_at     TIMESTAMPTZ
updated_at      TIMESTAMPTZ
snoozed_until   TIMESTAMPTZ  -- quando 'adiado'
PRIMARY KEY (workspace_id, id)
```
O **fingerprint** garante que um problema **em curso** é **uma linha atualizada** todo
dia (preserva `detected_at` e o status), nunca um item novo repetido.

### Padrão de detector (isolado, testável)
`Detector = (dados do workspace) → candidatos`. Cada detector é uma **função pura
determinística** que emite `{ evidence, impact, recommendation }` (recomendação por
**template**). Há um **registry**; adicionar um insight = registrar um detector, sem
tocar no resto.

### Rodada de detecção (reconciliação)
No cron, após materializar os dados:
1. roda todos os detectores sobre os dados atuais;
2. **reconcilia** com os insights abertos do workspace:
   - candidato novo → **insere** (`status = novo`, `detected_at = now`);
   - já existe e continua válido → **atualiza** `evidence`/`impact`/`updated_at`,
     **mantém** `status` e `detected_at`;
   - existia e **sumiu** (condição deixou de valer) → **auto-resolve**;
3. respeita `dispensado` e `snoozed_until`: não ressuscita o que foi silenciado, **a
   menos que piore materialmente** (ex.: severidade sobe de faixa).

### Ciclo de decisão (v1 = "B")
Ações do usuário no briefing: **dispensar** (irrelevante), **adiar** (relevante, mas não
agora — **por tempo**: 3/7 dias via `snoozed_until`; reaparece se ainda válido) e
**resolver** (já agi). Uma rota grava o novo `status`. **Fora do v1:** rastrear se a ação
funcionou (v1.5) e adiar **por condição** ("me avise quando piorar").

### Briefing — página própria `/briefing`
"Bom dia. Hoje há N coisas que merecem atenção." **Lista curta** (top ~5–7 por
`severity`), cada card com **título · evidência · impacto estimado · recomendação ·
[ver/agir]** e **[dispensar] [adiar] [resolver]**. Workspace-level, agregando os canais;
cada card marca o canal. (E-mail/push fica para depois.)

### Os 3 detectores do v1
| Detector | Regra (limiar inicial, ajustável) | Recomendação (template) |
|---|---|---|
| **Ruptura** | `daysRemaining ≤ 10` (radar de estoque) | "{produto} rompe em {dias} dias no ritmo de {x}/dia — repor até {data}." |
| **Velocidade caindo** | queda > 25% (últimos 7 d vs 7 d anteriores), com volume mínimo para não disparar em ruído | "vendas de {produto} caíram {x}% na semana — revise preço/anúncio/estoque." |
| **Margem comprometida** | `marginPct < 8%` ou contribuição negativa, **com custo cadastrado** | "margem de {produto} em {x}% — revise preço/custo/tarifa." |

Os limiares (10 dias / 25% / 8%) são **defaults iniciais**, a revisar com uso real; no
futuro, configuráveis por workspace.

### Honestidade (regra do projeto)
- `impact` sempre **estimativa com premissa explícita** — nunca valor "certo".
- Sem custo cadastrado → **não** vira insight de margem (é "custo pendente", que já
  existe); nunca inventar margem.
- Correlação não é causa: a recomendação sugere revisar, não afirma o motivo.

## Alternativas consideradas
- **Híbrido (compute-on-read + tabela só de estado):** mais enxuto, mas perde histórico
  e "detectado às…", e recalcula a cada abertura. Rejeitado por conflitar com a memória
  do analista.
- **On-read puro (sem estado):** rejeitado — o ciclo de decisão exige persistência.
- **Texto por IA (LLM) no v1:** rejeitado — custo/dependência/alucinação; determinístico
  primeiro, IA só para contextualizar depois.

## Consequências
- ➕ Vira "analista com memória" (histórico + ciclo), diferencial defensável.
- ➕ Leitura barata; sem infra nova; **independe** da migração Coolify.
- ➕ Detecção determinística e auditável — cada insight rastreável ao dado de origem.
- ➖ O cron passa a fazer mais (rodar detectores + reconciliar) — manter barato.
- ➖ Nova tabela + registry de detectores para manter.
- ➖ Limiares precisam de **tuning com uso real** (Fase 1 "uso interno" do GTM).

## Fora do v1 (parqueado)
Rastreamento de resultado da ação (v1.5), adiar por condição, **Buy Box histórico**
(exige polling frequente + série temporal), **Ads/ACOS** (exige a **Amazon Advertising
API**, não integrada), texto por IA, e-mail/push, limiares configuráveis por workspace.

Relacionado: cron/materialização em [`../architecture/sync-engine.md`](../architecture/sync-engine.md);
modelo canônico e cache em [`../architecture/canonical-model.md`](../architecture/canonical-model.md).
