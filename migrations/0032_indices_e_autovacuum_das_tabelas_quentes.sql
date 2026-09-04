-- Índices parciais e autovacuum das tabelas quentes — resposta ao alerta de
-- Disk IO Budget do Supabase (04/09/2026).
--
-- ⚠️ O QUE FOI MEDIDO, antes de qualquer conclusão. `pg_stat_statements`
-- acumulado desde 15/07/2026 (51 dias): 250 GB de blocos + 124 GB de arquivos
-- temporários. Esta migration ataca dois dos ofensores; o maior deles (88 GB,
-- 35% de todo o disco lido) NÃO está aqui — foi corrigido em código, com a
-- janela de `freteDoMercadoLivre.ts`, porque a causa era uma varredura de
-- histórico completo e não a falta de índice. Índice para consulta que não
-- deveria rodar seria pagar mais rápido pelo defeito.
--
-- ═══ 1. PENDENTES DO /metrics ═══
--
-- Custo medido: 21,8 GB, 42.471 chamadas. O cache de 60 s FUNCIONA (1 chamada a
-- cada 104 s); o custo não vem da frequência, vem da consulta — index-only scan
-- de 21.809 linhas com 17.010 heap fetches, 13.386 buffers por chamada. É a
-- maior fonte de churn de cache do banco (429 milhões de hits), e churn de
-- cache é o que despeja as páginas de todo mundo e vira leitura de disco alheia.
--
-- A consulta é `WHERE occurred_at > now() - 30 days` agrupando por provider e
-- contando `status = 'pending'`. Trinta dias é quase a tabela inteira; o que é
-- raro é o `pending`. Índice parcial inverte isso: lê dezenas em vez de 21.809.
--
-- ⚠️ NÃO leva `workspace_id` na frente de propósito. A consulta é de PLATAFORMA
-- ("este canal parou?") e roda sem sessão, fora de `runWithWorkspace` — é uma
-- das leituras cross-tenant com motivo escrito. Índice começando por
-- `workspace_id` não seria usado por ela, que é exatamente o defeito do índice
-- de eventos abaixo.
CREATE INDEX IF NOT EXISTS channel_orders_pendentes_por_canal_idx
  ON workspace_channel_orders (provider, occurred_at)
  WHERE status = 'pending';

-- ═══ 2. VARREDURA DE EVENTOS PRESOS ═══
--
-- Custo medido: 7,3 GB, e o PIOR aproveitamento de cache do banco (76%, contra
-- 97–99% dos demais). O `EXPLAIN` mostra o porquê: o bitmap lê **799 buffers
-- para achar 1 linha**.
--
-- A causa é a forma do índice atual, não o seu tamanho:
--
--   workspace_marketplace_events_pending_idx (workspace_id, provider, status, received_at)
--
-- A varredura é cross-tenant e não amarra `workspace_id`, a primeira coluna —
-- então o Postgres percorre o índice inteiro. E os estados que ela procura
-- (`processing`, `error`, `pending` velho) são 9 linhas de 40.169: quanto mais
-- saudável a fila, mais caro fica procurar nela.
--
-- 📌 A tabela NÃO está inchada: a retenção do ADR-016 alcança `complete`
-- normalmente (medido — o `processed_at` mais antigo tinha 7 dias, a janela
-- exata). A hipótese de "eventos nunca podados" caiu na medição. O que existia
-- era outra coisa, já corrigida em código: o push da Shopee gravava
-- `status = 'processed'`, palavra que a retenção não conhece.
CREATE INDEX IF NOT EXISTS eventos_presos_idx
  ON workspace_marketplace_events (provider, status, received_at)
  WHERE status IN ('pending', 'processing', 'error');

-- ═══ 3. AUTOVACUUM DAS TABELAS QUENTES ═══
--
-- Medido em 04/09/2026: `workspace_marketplace_shipments` não era aspirada
-- desde 31/07 — 35 dias. `workspace_channel_order_items` com 14,8% de linhas
-- mortas, `workspace_channel_orders` com 12,5%.
--
-- O padrão do Postgres dispara em 20% da tabela. Em tabela de 100 mil linhas
-- isso é aceitar 20 mil linhas mortas antes de agir — e enquanto elas existem o
-- MAPA DE VISIBILIDADE fica desatualizado, o que obriga TODO index-only scan a
-- ir ao heap. É a causa comum por trás de três dos ofensores medidos, e a razão
-- de este bloco não ser cosmético.
--
-- 5% em vez de 20%: aspira quatro vezes mais cedo, em lotes menores, que é o
-- oposto de "aspirar mais" — vacuum atrasado é caro justamente por ser grande.
ALTER TABLE workspace_channel_orders            SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE workspace_channel_order_items       SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE workspace_channel_order_fees        SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE workspace_marketplace_orders        SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE workspace_marketplace_shipments     SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE workspace_marketplace_events        SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);

-- ═══ QUEM LÊ ISSO AGORA — a pergunta obrigatória antes do apply ═══
--
-- Esta migration é INTEIRAMENTE ADITIVA: dois índices novos e seis ajustes de
-- parâmetro. Ela **não remove nem move nada** — nenhuma tabela, coluna, view ou
-- linha muda de lugar, então não há leitor para trocar junto e não há estado
-- intermediário visível para a vendedora. É o caso em que a resposta à pergunta
-- obrigatória é curta de verdade.
--
-- ⚠️ O que ela CUSTA no instante do apply: `CREATE INDEX` sem `CONCURRENTLY`
-- pega lock de escrita na tabela. Nas duas tabelas envolvidas o índice é
-- PARCIAL e cobre poucos milhares de linhas — segundos. Não usei
-- `CONCURRENTLY` porque ele não roda dentro de transação, e o runner de
-- migration aplica o arquivo inteiro em uma. Se a janela exigir zero lock, a
-- alternativa é rodar os dois `CREATE INDEX CONCURRENTLY` à mão e deixar aqui
-- só os `ALTER TABLE` — decisão da janela, não do arquivo.
--
-- 📌 O `VACUUM (ANALYZE)` de recuperação NÃO está aqui: ele é manutenção, não
-- schema, e roda por fora (`scripts/manutencao-de-io.mjs`). Estes parâmetros
-- evitam a PRÓXIMA vez; o vacuum manual cura o atraso de agora.
