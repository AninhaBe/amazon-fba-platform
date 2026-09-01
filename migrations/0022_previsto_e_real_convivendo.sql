-- Tarifa PREVISTA sai de dentro de `workspace_channel_order_fees` e ganha tabela
-- própria, com o grão da linha do pedido. A leitura passa a ser uma VIEW.
--
-- A RAZÃO DE EXISTIR, numa frase: **o concorrente estima e nunca reconcilia; nós
-- reconciliamos, e reconciliar exige guardar os dois.** (ADR-027, emenda II.)
--
-- ═══ O QUE ESTAVA ERRADO NO DESENHO ANTERIOR (medido em 31/08/2026, produção) ═══
--
-- A implementação em produção grava a estimativa como `fee_type = 'estimated'`
-- dentro da própria tabela de tarifas. Funciona, não corrompe nada hoje, e tem
-- três defeitos que esta migration corrige:
--
-- 1. PREVISTO E REAL NÃO TÊM CHAVE COMUM. `fee_type` é a NATUREZA da tarifa
--    (commission, fulfillment, refund); `estimated` é a PROCEDÊNCIA. Ao gravar a
--    procedência no lugar da natureza, a natureza foi contrabandeada para
--    `provider_fee_code`, e o mesmo fato econômico ficou com duas formas:
--
--      real     -> fee_type='commission'  provider_fee_code='Commission'   (Finances API)
--      estimado -> fee_type='estimated'   provider_fee_code='ReferralFee'  (Product Fees API)
--
--    `feeTypeOf()` (amazonCanonical.ts:79) mapeia "Commission" para 'commission';
--    "ReferralFee" cai em 'other'. Sem chave comum, a medição de pontaria — que é
--    exatamente o que nos diferencia de quem estima e nunca reconcilia — vira
--    mapeamento hardcoded em JS, não join.
--
-- 2. A PROTEÇÃO CONTRA DUPLA CONTAGEM ERA BLACKLIST. Três lugares repetiam
--    `fee_type NOT IN ('refund','estimated')`. `fee_type` novo entra somado como
--    real POR PADRÃO — modo de falha invertido. Os outros três canais já usam
--    whitelist (`fee_type IN ('commission','payment')`); só a Amazon usava
--    negação. Medido: 18 pedidos já têm estimada e real convivendo hoje, e a
--    exclusão deles depende de cada autor de query lembrar do predicado.
--
-- 3. O GRÃO ERA O PEDIDO, e a ADR-027 §5 exige desvio POR SKU e por período. A
--    estimativa era somada por pedido antes de gravar, e a tabela não tem
--    `line_no` nem data — desvio por SKU e lag estimar->liquidar eram
--    inalcançáveis. O item 5 é o critério de expansão da própria ADR-027; sem
--    ele, a decisão não é falseável.
--
-- ═══ MEDIÇÕES QUE SUSTENTAM O DESENHO (31/08/2026, produção, somente leitura) ═══
--
--   workspace_channel_order_fees : 58 MB (24 MB heap + 34 MB de índice), 140.162 linhas
--   amazon/estimated             : 514 linhas, R$ 2.009,77, 80 com amount = 0
--   provider_fee_code do estimated: FBAFees (257) e ReferralFee (257)
--   pedidos Amazon               : 20.241 com UMA linha, 139 multi-item (máx. 15 SKUs)
--
-- Os 99,3% de pedidos de uma linha só é o que torna o desvio por SKU exato sem
-- rateio nenhum — ver a view de pontaria no fim deste arquivo.
--
-- ═══ POR QUE TABELA E NÃO UMA COLUNA `basis` ═══
--
-- O requisito era "a leitura não pode somar estimada + real do mesmo pedido, e a
-- garantia é por schema, não por disciplina de quem escreve a query". Uma coluna
-- `basis = 'actual' | 'estimated'` ainda depende de o leitor LEMBRAR do `WHERE` —
-- é a mesma classe de proteção que já falhou. Uma tabela separada não é predicado
-- esquecível: para somar errado seria preciso escrevê-la deliberadamente no FROM.

CREATE TABLE IF NOT EXISTS workspace_channel_order_fee_estimates (
  workspace_id      TEXT NOT NULL,
  provider          TEXT NOT NULL,
  connection_id     TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  -- Grão da LINHA, não do pedido: é o que torna o desvio por SKU possível.
  line_no           SMALLINT NOT NULL,
  -- ⚠️ MESMO VOCABULÁRIO DO REAL. É esta coluna que faz previsto x real virar
  -- join. O código do provider ('ReferralFee') vai em provider_fee_code, nunca
  -- aqui — o CHECK abaixo recusa 'estimated' e 'refund' justamente para impedir
  -- que a procedência volte a ocupar o lugar da natureza.
  fee_type          TEXT NOT NULL,
  -- Rótulo da própria fonte, preservado para a procedência do tooltip
  -- ("comissão R$ X + FBA R$ Y"). Recalcular por fora daria outro número.
  provider_fee_code TEXT NOT NULL,
  -- ⚠️ NOT NULL DE PROPÓSITO — é o `null != 0` do AGENTS.md virando estrutura em
  -- vez de convenção. Ausência de LINHA é o desconhecido; não existe campo
  -- nulável aqui onde um COALESCE(...,0) distraído possa entrar. Zero devolvido
  -- pela Amazon (80 linhas medidas) é FATO e continua gravado como zero.
  amount            NUMERIC(14,2) NOT NULL,
  currency          TEXT NOT NULL,
  -- O preço sobre o qual se estimou — o praticado NAQUELE pedido, não o de hoje
  -- (ADR-027). Sem ele o desvio é inatribuível: não dá para saber se erramos a
  -- tarifa ou se o preço mudou.
  unit_price        NUMERIC(14,2) NOT NULL,
  qty               INTEGER NOT NULL,
  source            TEXT NOT NULL DEFAULT 'product_fees_api',
  estimated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Carimbado quando a tarifa oficial chega. Resolve três coisas de uma vez: o
  -- lag estimar->liquidar (a métrica da ADR-027 §5), a marca de estimativa na
  -- tela (leitura de coluna, não subconsulta) e a saída dos pedidos com ambos do
  -- NOT EXISTS. A LINHA NUNCA É APAGADA: é ela que permite medir a pontaria.
  superseded_at     TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, provider, connection_id, external_order_id, line_no, fee_type),
  CONSTRAINT fee_estimates_vocabulario_canonico CHECK (
    fee_type IN ('commission', 'fulfillment', 'shipping_seller', 'taxes_withheld', 'other')
  ),
  CONSTRAINT fee_estimates_valores_plausiveis CHECK (
    amount >= 0 AND unit_price >= 0 AND qty > 0
  )
);

COMMENT ON TABLE workspace_channel_order_fee_estimates IS
  'Tarifa PREVISTA pela fonte (Amazon Product Fees API), grao de linha do pedido. Convive com a real em workspace_channel_order_fees e NUNCA a sobrescreve: e o par previsto x real que permite medir pontaria (ADR-027). NAO somar com a real: leia a view workspace_channel_order_fees_efetivas.';

COMMENT ON COLUMN workspace_channel_order_fee_estimates.fee_type IS
  'Mesma taxonomia canonica da tarifa real (docs/canonical-schema.md). Amazon: ReferralFee -> commission, FBAFees -> fulfillment. NUNCA "estimated": procedencia nao e natureza.';

COMMENT ON COLUMN workspace_channel_order_fee_estimates.amount IS
  'NOT NULL de proposito. Desconhecido = LINHA AUSENTE, nunca 0. Zero e o fato "a fonte nao cobra nada por este item a este preco" (medido: 80 linhas em 31/08/2026).';

COMMENT ON COLUMN workspace_channel_order_fee_estimates.superseded_at IS
  'Quando a tarifa oficial substituiu esta estimativa. NULL = ainda vigente na tela. A linha nunca e apagada.';

-- Varredura do estimador e da tela: "quais estimativas ainda estão vigentes".
-- Parcial, porque em regime a maioria das linhas já terá sido substituída.
CREATE INDEX IF NOT EXISTS fee_estimates_vigentes_idx
  ON workspace_channel_order_fee_estimates (workspace_id, provider, connection_id, external_order_id)
  WHERE superseded_at IS NULL;

-- ═══ A GARANTIA DE NÃO SOMAR OS DOIS, EM UM LUGAR SÓ ═══
--
-- Uma linha por (pedido, fee_type), com `basis` dizendo de onde veio. O real
-- ganha do estimado. Nenhuma rota volta a escrever `NOT IN (...)`: a proibição
-- de blacklist na leitura de tarifa da Amazon está registrada na ADR-027.
--
-- ⚠️ A SUBSTITUIÇÃO É POR (PEDIDO, fee_type) — E A PRIMEIRA VERSÃO DISTO ERRAVA.
--
-- O desenho original substituía POR PEDIDO, com o argumento de "não misturar
-- bases" (defeito #3 da auditoria de agosto). O backend levantou a consequência
-- em 01/09/2026 e a medição deu razão a ele, com folga:
--
--   pedidos Amazon com alguma tarifa real .......... 5.503
--     com comissão E logística (completos) ......... 256   (4,7%)
--     com comissão e NENHUMA logística ............. 5.247  (95,3%)
--     só com logística ............................. 0
--
-- Ou seja: a Amazon posta a tarifa EM PARTES, e isso é a REGRA, não a exceção.
-- Substituir por pedido faria a estimativa de FBA sumir da leitura no instante
-- em que a comissão real chegasse — em 95% dos pedidos —, e a logística ainda
-- não postada passaria a somar ZERO.
--
-- ⚠️ ISSO É O `null ≠ 0` DO AGENTS.md, VIOLADO PELO MEIO. Tarifa que não chegou
-- é desconhecida; tratá-la como ausente dentro de uma soma é afirmar que ela é
-- zero. O sintoma na tela seria o pior tipo: o custo do pedido ENCOLHE sozinho
-- quando a comissão é postada, o lucro sobe, e cai de novo quando a logística
-- entra. Número que se move sozinho já custou credibilidade duas vezes nesta
-- semana.
--
-- E "não misturar bases" continua respeitado, porque a mistura fica VISÍVEL: a
-- coluna `basis` é por linha, então o pedido que tem comissão real e FBA
-- estimado aparece com as duas marcas, e o card diz quanto ali é estimado
-- (ADR-027 §4). O que a regra proíbe é um total que finge ser de uma base só —
-- não um total completo que declara a procedência de cada parte.
--
-- ⚠️ A LISTA POSITIVA DE fee_type APARECE DUAS VEZES NESTE ARQUIVO e em lugar
-- nenhum além dele. Era a repetição em três rotas que fazia da blacklist um
-- risco; uma whitelist num arquivo só é auditável num diff.
CREATE OR REPLACE VIEW workspace_channel_order_fees_efetivas AS
  SELECT f.workspace_id, f.provider, f.connection_id, f.external_order_id,
         f.fee_type, f.currency,
         SUM(f.amount) AS amount,
         'actual'::text AS basis
    FROM workspace_channel_order_fees f
   GROUP BY 1, 2, 3, 4, 5, 6
  UNION ALL
  SELECT e.workspace_id, e.provider, e.connection_id, e.external_order_id,
         e.fee_type, e.currency,
         SUM(e.amount) AS amount,
         'estimated'::text AS basis
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
  'Tarifa EFETIVA por (pedido, fee_type): real quando existe, estimada enquanto nao existe. Coluna basis diz qual. Toda leitura de tarifa da Amazon passa por aqui — somar as duas tabelas na mao reintroduz a dupla contagem que esta view existe para impedir (ADR-027).';

-- ═══ PONTARIA — o item 5 da ADR-027, consultável por período e por SKU ═══
--
-- ⚠️ POR SKU SEM RATEIO, E ISSO É DELIBERADO. Medido em 31/08/2026: 20.241 dos
-- 20.380 pedidos Amazon têm UMA linha só (99,3%). Nesses, o desvio por SKU é
-- exato. Nos 139 multi-item, `external_product_id` fica NULL em vez de receber
-- uma alocação proporcional inventada por nós — ratear tarifa real entre SKUs
-- seria extrapolação (AGENTS.md), e erraria justamente onde o desvio interessa.
-- Quem quiser o corte por SKU filtra `external_product_id IS NOT NULL` e sabe,
-- pela contagem, quantos pedidos ficaram de fora.
CREATE OR REPLACE VIEW workspace_channel_fee_accuracy AS
  WITH previsto AS (
    SELECT workspace_id, provider, connection_id, external_order_id, fee_type,
           SUM(amount) AS amount,
           MIN(estimated_at) AS estimated_at,
           MAX(superseded_at) AS superseded_at
      FROM workspace_channel_order_fee_estimates
     GROUP BY 1, 2, 3, 4, 5
  ), realizado AS (
    SELECT workspace_id, provider, connection_id, external_order_id, fee_type,
           SUM(amount) AS amount
      FROM workspace_channel_order_fees
     WHERE fee_type IN ('commission', 'fulfillment', 'shipping_seller',
                        'taxes_withheld', 'other')
     GROUP BY 1, 2, 3, 4, 5
  )
  SELECT p.workspace_id, p.provider, p.connection_id, p.external_order_id,
         o.occurred_at, p.fee_type,
         sku.external_product_id, sku.sku,
         p.amount AS previsto,
         r.amount AS realizado,
         -- Desvio só existe depois que o real chegou. Antes disso é NULL, não
         -- zero: "ainda não sei se acertei" não é "acertei".
         (r.amount - p.amount) AS desvio,
         ((r.amount - p.amount) / NULLIF(p.amount, 0)) AS desvio_pct,
         p.estimated_at,
         p.superseded_at,
         (p.superseded_at - p.estimated_at) AS lag_ate_liquidar
    FROM previsto p
    JOIN workspace_channel_orders o
      ON o.workspace_id = p.workspace_id AND o.provider = p.provider
     AND o.connection_id = p.connection_id AND o.external_order_id = p.external_order_id
    LEFT JOIN realizado r
      ON r.workspace_id = p.workspace_id AND r.provider = p.provider
     AND r.connection_id = p.connection_id AND r.external_order_id = p.external_order_id
     AND r.fee_type = p.fee_type
    LEFT JOIN LATERAL (
      -- Devolve linha só quando o pedido tem UM item; multi-item vira NULL.
      SELECT MAX(i.external_product_id) AS external_product_id, MAX(i.sku) AS sku
        FROM workspace_channel_order_items i
       WHERE i.workspace_id = p.workspace_id AND i.provider = p.provider
         AND i.connection_id = p.connection_id
         AND i.external_order_id = p.external_order_id
      HAVING COUNT(*) = 1
    ) sku ON true;

COMMENT ON VIEW workspace_channel_fee_accuracy IS
  'Pontaria previsto x real (ADR-027 secao 5), por periodo (occurred_at) e por SKU. desvio/desvio_pct sao NULL enquanto a tarifa oficial nao chegou — ausencia de desvio nao e desvio zero. external_product_id e NULL em pedido multi-item: nao rateamos tarifa real entre SKUs.';

-- ═══ AS 514 LINHAS ANTIGAS SÃO APAGADAS, NÃO MIGRADAS ═══
--
-- Elas foram gravadas AGREGADAS POR PEDIDO, sem `line_no` e sem `unit_price` — o
-- grão novo não é reconstruível a partir delas. A alternativa seria inventar
-- `line_no = 0` como sentinela, e sentinela é mentira que sobrevive ao autor:
-- daqui a um mês ninguém saberia que aquele zero significa "não sabemos a linha".
--
-- Refazer é barato e o estimador é idempotente: dedup por (ASIN, preço) reduz
-- 1.617 linhas a 47 chaves, e a janela de 30 dias custa 47 chamadas (medido em
-- 31/08/2026). As linhas têm 2 dias de vida e nenhum consumidor fora da tela.
--
-- ⚠️ ORDEM IMPORTA NO DEPLOY: enquanto a tabela nova estiver vazia e as antigas
-- apagadas, a tela volta a "Tarifas não postadas" para o pendente — que é o modo
-- de falha correto da ADR-027, nunca R$ 0,00. O backend roda o estimador logo
-- depois do apply.
DELETE FROM workspace_channel_order_fees
 WHERE provider = 'amazon' AND fee_type = 'estimated';
