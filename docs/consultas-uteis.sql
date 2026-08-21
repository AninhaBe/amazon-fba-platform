-- Consultas úteis do NEXO — abrir no Query Tool do pgAdmin.
-- Rodar uma de cada vez: selecione o bloco e aperte F5.
--
-- ⚠️ ESTE É O BANCO DE PRODUÇÃO. Tudo aqui é SELECT, de propósito.
--    UPDATE/DELETE sem WHERE não têm volta e o plano Free não tem backup automático.
--
-- ⚠️ FILTRE SEMPRE POR connection_id. O banco tem TRÊS contas Amazon e duas do
--    Mercado Livre; a do colega tem 21 mil pedidos contra 20 da NEXAHUB. Consultar
--    só por `provider = 'amazon'` mistura 99,9% de dado de terceiro e produz
--    análise completamente falsa (aconteceu em 20/08/2026).

-- Suas conexões e quanto cada uma tem
SELECT connection_id, COUNT(*) AS pedidos,
       MIN(occurred_at)::date AS desde, MAX(occurred_at)::date AS ate
  FROM workspace_channel_orders
 GROUP BY connection_id
 ORDER BY pedidos DESC;

-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ Troque este valor conforme a conta que quer olhar:                        │
-- │   amazon:AO62LVXJMX3AA        = NEXAHUB (sua)                             │
-- │   amazon:A15NQMF7A6J1Y0       = do sócio                                  │
-- │   mercado_livre:648425194     = NEXAHUB no ML                             │
-- └───────────────────────────────────────────────────────────────────────────┘


-- ============================================================ VENDAS

-- Vendas por dia e produto (últimos 15 dias) — só APROVADAS (ADR-020)
SELECT (o.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
       i.sku,
       SUM(i.qty)                        AS unidades,
       SUM(i.qty * i.unit_price)::numeric(10,2) AS bruto
  FROM workspace_channel_orders o
  JOIN workspace_channel_order_items i
    ON i.workspace_id = o.workspace_id
   AND i.connection_id = o.connection_id
   AND i.external_order_id = o.external_order_id
 WHERE o.connection_id = 'amazon:AO62LVXJMX3AA'
   AND o.status IN ('paid','shipped','delivered')
   AND o.occurred_at > now() - interval '15 days'
 GROUP BY 1, 2
 ORDER BY 1 DESC, 4 DESC;

-- Faturamento por dia, com pendentes e cancelados à parte
SELECT (occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
       COUNT(*) FILTER (WHERE status IN ('paid','shipped','delivered')) AS aprovados,
       COUNT(*) FILTER (WHERE status = 'pending')                        AS pendentes,
       COUNT(*) FILTER (WHERE status = 'cancelled')                      AS cancelados,
       SUM(gross) FILTER (WHERE status IN ('paid','shipped','delivered'))::numeric(10,2) AS faturamento
  FROM workspace_channel_orders
 WHERE connection_id = 'amazon:AO62LVXJMX3AA'
   AND occurred_at > now() - interval '30 days'
 GROUP BY 1
 ORDER BY 1 DESC;


-- ============================================================ SAÚDE DO SISTEMA

-- O sync está vivo? (o mesmo dado que alimenta o Grafana)
SELECT provider, connection_id, status,
       age(now(), COALESCE(last_success_at, updated_at)) AS ha_quanto_tempo,
       left(COALESCE(last_error, ''), 70) AS erro
  FROM workspace_marketplace_syncs
 ORDER BY provider, connection_id;

-- Pedidos presos em `pending` — passar de algumas dezenas por horas é lag de
-- ingestão, não queda de vendas (o defeito de 21/08/2026)
SELECT connection_id,
       COUNT(*)                                                        AS pendentes,
       COUNT(*) FILTER (WHERE occurred_at < now() - interval '12 hours') AS ha_mais_de_12h,
       MIN(occurred_at)::date                                          AS mais_antigo
  FROM workspace_channel_orders
 WHERE status = 'pending' AND occurred_at > now() - interval '30 days'
 GROUP BY connection_id
 ORDER BY 2 DESC;

-- Tamanho do banco e as maiores tabelas (limite do plano Free: 500 MB)
SELECT pg_size_pretty(pg_database_size(current_database())) AS banco_inteiro;

SELECT c.relname AS tabela,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       pg_size_pretty(pg_relation_size(c.oid))       AS dados,
       pg_size_pretty(pg_indexes_size(c.oid))        AS indices
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r','m','p') AND n.nspname = 'public'
 ORDER BY pg_total_relation_size(c.oid) DESC
 LIMIT 10;


-- ============================================================ PRODUTOS E CUSTO

-- Custos cadastrados (o que alimenta margem e lucro)
SELECT sku, cost, updated_at::date AS atualizado
  FROM workspace_product_costs
 WHERE workspace_id = '1803d1fe-2bf3-4b72-bed1-c79d8b0e640e'
   AND sku IN ('martelo-borracha','kit-clips-320','kitprote-8','kitprote-16','kitprote-24','kitprote-32')
 ORDER BY sku;

-- Vendeu mas não tem custo cadastrado → margem sai errada nessas linhas
SELECT DISTINCT i.sku
  FROM workspace_channel_order_items i
  LEFT JOIN workspace_product_costs c
    ON c.workspace_id = i.workspace_id AND c.sku = i.sku
 WHERE i.connection_id = 'amazon:AO62LVXJMX3AA'
   AND c.sku IS NULL
 ORDER BY 1;


-- ============================================================ TARIFAS

-- Quanto a Amazon cobrou, por tipo (hoje é zero: promoção de vendedor novo)
SELECT f.fee_type, COUNT(*) AS lancamentos, SUM(f.amount)::numeric(10,2) AS total
  FROM workspace_channel_order_fees f
  JOIN workspace_channel_orders o
    ON o.workspace_id = f.workspace_id
   AND o.connection_id = f.connection_id
   AND o.external_order_id = f.external_order_id
 WHERE f.connection_id = 'amazon:AO62LVXJMX3AA'
   AND o.occurred_at > now() - interval '30 days'
 GROUP BY 1
 ORDER BY 3 DESC;
