-- A view da tarifa efetiva passa a expor `posted_at`.
--
-- ⚠️ ISTO É CORREÇÃO DE INCIDENTE, NÃO EVOLUÇÃO. Enquanto esta migration não
-- rodar, **a visão da Amazon não abre** — a consulta de tarifa estoura com
-- `column f.posted_at does not exist` (SQLSTATE 42703) e o erro escapa: não há
-- `try/catch` em volta de `tarifaRows`, então a exceção sobe pela função inteira.
-- Medido em 02/09/2026 contra Postgres 16 descartável com o schema no HEAD.
--
-- ═══ COMO O ESTADO NASCEU — E É O PADRÃO QUE O AGENTS.md JÁ DESCREVE ═══
--
-- A migration 0029 fez `ALTER TABLE workspace_channel_order_fees ADD COLUMN
-- posted_at` e parou aí. Mas `amazonOverviewCanonical.ts:957` não lê a TABELA —
-- lê a **view** `workspace_channel_order_fees_efetivas`, criada pela 0022 e nunca
-- recriada desde então (conferido: `CREATE VIEW` só aparece na 0022, e a palavra
-- `VIEW` não aparece na 0029).
--
-- É exatamente a pergunta "quem lê isso agora?" — só que a coluna não MUDOU de
-- casa, ela nasceu numa casa que o leitor não visita. E o desfecho é pior que o
-- silêncio que aquela regra prevê: ali a tela fica errada em silêncio; aqui ela
-- não abre. **O modo de falha alto foi a sorte deste caso** — um erro 42703 é
-- achável; um zero indevido não seria.
--
-- 📌 E ele só apareceu porque os testes de integração rodaram pela primeira vez
-- (02/09/2026). Nenhuma das duas revisões pegaria: a 0029 está certa isolada, o
-- leitor está certo isolado, e a incoerência mora **entre** os dois.
--
-- ═══ POR QUE `posted_at` VAI NO FIM DA LISTA DE COLUNAS ═══
--
-- Não é estética: `CREATE OR REPLACE VIEW` **só aceita coluna nova no fim**. Pôr
-- `posted_at` antes de `basis` faz o Postgres recusar com "cannot change name of
-- view column". Quem for reordenar isso um dia precisa de DROP + CREATE, e aí
-- precisa saber que a view tem leitor em produção.
--
-- ═══ ⚠️ A LIMITAÇÃO DESTE GRÃO, DECLARADA AQUI DE PROPÓSITO ═══
--
-- A view agrega por (pedido, fee_type) e **soma** o valor. Dois estornos do mesmo
-- pedido já viravam UMA linha antes desta migration — o colapso é anterior a ela.
-- `MAX(posted_at)` apenas acompanha o que a soma já fazia: escolhe a data do
-- lançamento mais recente do grupo, e a data do outro não sobrevive.
--
-- Isso é aceitável NO GRÃO DA VIEW, e é o parecer registrado em 02/09/2026: ela
-- sempre foi agregado por pedido+fee_type. Mas a limitação é real e o número que
-- a dimensiona está na 0029 — mediana de 11 dias de atraso, 5 estornos mudando de
-- mês. Se dois estornos do mesmo pedido caírem em meses diferentes, a view põe os
-- dois no mês do mais recente.
--
-- 📌 **LEITOR QUE PRECISAR DO GRÃO POR ESTORNO LÊ A TABELA, NÃO A VIEW.**
-- Hoje nenhum precisa — por isso não há ADR. No dia em que um precisar, a
-- conversa reabre e o desenho muda; não contorne com um `DISTINCT` por cima.
--
-- ⚠️ O ramo da ESTIMATIVA devolve `NULL`, e isso é a regra da casa, não descuido:
-- estimativa não tem data de lançamento porque **não foi lançada**. `NULL` aqui é
-- "não existe", e o leitor faz `COALESCE(posted_at, o.occurred_at)` — que é o
-- comportamento antigo preservado. Zero seria a mentira: diria "lançado na época
-- zero".
CREATE OR REPLACE VIEW workspace_channel_order_fees_efetivas AS
  SELECT f.workspace_id, f.provider, f.connection_id, f.external_order_id,
         f.fee_type, f.currency,
         SUM(f.amount) AS amount,
         'actual'::text AS basis,
         MAX(f.posted_at) AS posted_at
    FROM workspace_channel_order_fees f
   GROUP BY 1, 2, 3, 4, 5, 6
  UNION ALL
  SELECT e.workspace_id, e.provider, e.connection_id, e.external_order_id,
         e.fee_type, e.currency,
         SUM(e.amount) AS amount,
         'estimated'::text AS basis,
         NULL::timestamptz AS posted_at
    FROM workspace_channel_order_fee_estimates e
   WHERE NOT EXISTS (
           SELECT 1 FROM workspace_channel_order_fees r
            WHERE r.workspace_id = e.workspace_id AND r.provider = e.provider
              AND r.connection_id = e.connection_id
              AND r.external_order_id = e.external_order_id
              -- 👇 É ESTA LINHA. Sem ela a substituição é por pedido, e a tarifa
              -- que ainda não chegou vira zero em 95% dos casos.
              AND r.fee_type = e.fee_type
              AND r.fee_type IN ('commission', 'fulfillment', 'shipping_seller',
                                 'taxes_withheld', 'other')
         )
   GROUP BY 1, 2, 3, 4, 5, 6;

COMMENT ON VIEW workspace_channel_order_fees_efetivas IS
  'Tarifa EFETIVA por (pedido, fee_type): real quando existe, estimada enquanto nao existe. Coluna basis diz qual. Toda leitura de tarifa da Amazon passa por aqui — somar as duas tabelas na mao reintroduz a dupla contagem que esta view existe para impedir (ADR-027). LIMITACAO DE GRAO: a view agrega por pedido+fee_type, entao dois estornos do mesmo pedido viram uma linha, com a soma dos valores e MAX(posted_at) — a data do lancamento mais antigo nao sobrevive. LEITOR QUE PRECISAR DO GRAO POR ESTORNO LE workspace_channel_order_fees, NAO ESTA VIEW.';
