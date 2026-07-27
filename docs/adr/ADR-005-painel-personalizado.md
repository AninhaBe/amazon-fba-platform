# ADR-005: Painel personalizado — preferências de KPI por workspace

- **Status:** Proposto
- **Data:** 2026-07

## Contexto

Todos os KPIs do dashboard/monitor já são calculados. Falta dar ao vendedor a
liberdade de **escolher o que aparece**: mostrar/ocultar cada indicador e
reordená-los, mantendo um conjunto padrão para quem não quer configurar nada.
Isso exige **persistir preferência de UI** — uma superfície de dados que ainda não
existe no schema.

## Decisão

Guardar a preferência numa tabela **genérica de settings por workspace**, criada em
`src/lib/db.ts` (padrão `CREATE TABLE IF NOT EXISTS`, como as demais tabelas
workspace):

```
workspace_settings (
  workspace_id uuid   not null,
  key          text   not null,   -- ex.: "dashboard_layout:amazon"
  value        jsonb  not null,   -- ex.: { "order": [...ids], "hidden": [...ids] }
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, key)
)
```

- **Chave por view:** `dashboard_layout:amazon`, `:mercado-livre`,
  `:amazon-monitor`, `:mercado-livre-monitor`.
- **Valor:** `{ order: string[], hidden: string[] }` referenciando **IDs estáveis de
  widget** (ex.: `revenue`, `profit`, `margin-pct`, `stock`), não índices.
- **Sem linha = default:** ausência de registro significa "tudo visível, na ordem
  canônica". Usuário novo não precisa de nenhuma escrita.
- **Acesso** por `src/lib/dashboardLayoutStore.ts`, sempre escopado por
  `workspace_id = $1` (mesmo padrão de `costStore.ts`/`persistentCache.ts`).
  Segurança = escopo por workspace na query (o projeto **não** usa RLS; a conexão é
  privilegiada no servidor). Rota `GET/PUT /api/dashboard-layout?view=...`.

## Alternativas consideradas

- **Tabela dedicada por feature** (`workspace_dashboard_layouts`). Rejeitada: um
  settings genérico serve futuras preferências (moeda, tema, ordenação padrão de
  listas) **sem nova migração** — coerente com o ethos de generalidade do schema.
- **`localStorage`.** Rejeitada: não sincroniza entre dispositivos/logins; a decisão
  foi persistir no banco.
- **Preferência por usuário.** O app é inteiro **workspace-scoped** (não há tabela de
  preferência por usuário); manter no workspace é consistente e mais simples.

## Escopo v1 (e o que fica de fora)

- ✅ Mostrar/ocultar e **reordenar** os KPIs **que já existem**.
- ❌ Escolher período/comparação por card — v2.
- ❌ Métricas do zero (fórmulas do usuário) — v2. Exige um motor de fórmula e
  validação; só depois de validar o v1.

## Consequências

- ➕ Uma tabela cobre todas as preferências futuras (sem migração por feature).
- ➕ Sem linha ⇒ default: zero configuração para o novo usuário; nada quebra.
- ➕ IDs estáveis desacoplam o layout salvo da implementação do card.
- ➖ Exige um **registry de widgets por view** (id → como renderizar) mantido no
  código; adicionar um KPI novo = registrar o id.
- ➖ v1 não cobre métricas customizadas; a expectativa precisa ficar clara na UI.

Relacionado: leitura/render em [`../architecture/read-and-cache.md`](../architecture/read-and-cache.md);
cache por workspace em [`../architecture/canonical-model.md`](../architecture/canonical-model.md).
