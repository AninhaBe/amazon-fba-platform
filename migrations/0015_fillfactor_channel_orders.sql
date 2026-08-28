-- R3 antecipado (frente L, pacote de recuperação de espaço de 28/08/2026 —
-- ADR-022 Frente 1): fillfactor=90 em workspace_channel_orders deixa ~10% de
-- folga por página para updates ficarem HOT (sem reescrever entradas de
-- índice), atacando a amplificação medida (2,28 M de updates, 61% HOT).
--
-- A folga assenta DE GRAÇA no VACUUM FULL que roda em seguida no pacote — o
-- rewrite reescreve as páginas já com o fillfactor novo.
--
-- ⚠️ NUNCA aplicar em workspace_marketplace_orders: o índice de expressão
-- sobre `payload` torna HOT impossível lá (ADR-022 R2) — fillfactor só
-- desperdiçaria 10% de espaço sem ganho.

ALTER TABLE workspace_channel_orders SET (fillfactor = 90);
