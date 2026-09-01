# Plano de implementação — Seller Intelligence (v1)

Deriva do [ADR-008](../adr/ADR-008-seller-intelligence.md). Roda no stack atual, sem
depender da migração Coolify. Detecção determinística; texto por template.

Legenda: ✅ = critério de verificação.

## Estágio 0 — Fundação (tabela + tipos + store)
- [ ] `db.ts`: tabela `workspace_insights` (PK `workspace_id,id`).
- [ ] `src/lib/insights/types.ts`: `Insight`, `InsightCandidate`, `Detector`, `InsightStatus`.
- [ ] `src/lib/insights/store.ts`: `reconcile(candidates, ranTypes)` (insere/atualiza/auto-resolve, respeita dispensado/adiado), `listOpen()`, `setStatus(id, status, snoozeDays?)`. Tudo escopado por workspace.
- ✅ Store faz upsert idempotente por fingerprint; dispensado/adiado não ressuscitam.

## Estágio 1 — Detector de ruptura (protótipo)
- [ ] `src/lib/insights/detectors/ruptura.ts`: lê `getStockRadar`, emite candidato para `status` out/critical (`daysRemaining ≤ 10`), com evidência/impacto/recomendação por template.
- [ ] `src/lib/insights/registry.ts` + `src/lib/insights/run.ts`: roda os detectores registrados → candidatos → `reconcile`.
- ✅ Rodar a detecção gera insights de ruptura a partir do estoque real.

## Estágio 2 — Briefing (página + ciclo)
- [ ] `src/app/api/briefing/route.ts`: `GET` = roda detecção (no protótipo) + devolve insights abertos; `PATCH` = `dispensar | adiar | resolver`.
- [ ] `src/app/(app)/briefing/page.tsx`: "Bom dia. N coisas.", lista curta, cards com evidência · impacto · recomendação · [ver/agir] + [dispensar][adiar][resolver].
- [ ] Entrada no menu (`Nav.tsx`).
- ✅ `/briefing` mostra a ruptura e os três botões funcionam (persistem estado).

## Estágio 3 — Mover a detecção para o cron
- [ ] Chamar `run()` no fim do `api/cron/amazon-sync` (e ML), após materializar. O `GET /briefing` passa a **só ler**.
- ✅ Insights são recalculados no cron diário; a página não recalcula ao abrir.

## Estágio 4 — Demais detectores do v1
- [ ] `velocidade.ts` (queda > 25% em 7d vs 7d, com volume mínimo).
- [ ] `margem.ts` (marginPct < 8% ou contribuição negativa, com custo cadastrado).
- ✅ Os três detectores rodando e reconciliando juntos.

## Estágio 5 — Polimento
- [ ] Absorver o `OperationPending` no briefing (ou apontar pra ele).
- [ ] Ajuste de limiares com uso real; ordenação por severidade; cap da lista.

---

**Protótipo desta rodada = Estágios 0, 1 e 2 para ruptura** (Amazon), com a detecção
rodando **sob demanda** no `GET /briefing`. O Estágio 3 (cron) e os detectores de
velocidade/margem vêm depois.
