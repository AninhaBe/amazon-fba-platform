-- Métricas diárias de anúncio POR PRODUTO ANUNCIADO.
--
-- POR QUE UMA TABELA NOVA, E NÃO COLUNAS EM workspace_ad_metrics
--
-- Granularidade diferente: `workspace_ad_metrics` é 1 linha por campanha×dia; aqui
-- é 1 linha por produto anunciado×campanha×dia. Enfiar produto na tabela de
-- campanha exigiria uma linha "sem produto" para o total, e toda leitura passaria
-- a filtrar `product_id IS NULL` — o tipo de coluna sentinela que faz um SELECT
-- esquecido somar duas vezes. As duas convivem: a de campanha responde "quanto
-- gastei", esta responde "em quê".
--
-- O QUE ISTO DESTRAVA (pedido da Ana, 28/08/2026: "quero ver ACOS, TACOS e afins,
-- não só gasto com ads" — e "puxar direto dos canais, não via cálculo nosso")
--
-- ACOS e ROAS vêm PRONTOS da fonte (a Amazon devolve `acosClicks14d`/
-- `roasClicks14d` no report `spAdvertisedProduct`). O NEXO acrescenta o que só
-- ele tem: a margem real do SKU (custo cadastrado + tarifas do extrato). É o
-- cruzamento "ACOS 18% num produto de margem 14% = você paga para vender", que
-- nenhum painel de canal consegue fazer.
--
-- AGNÓSTICA DE CANAL DESDE O PRIMEIRO DIA (mesma lição da 0012)
--
-- Mercado Livre (PADS) devolve `acos`, `roas`, `cvr` e `sov` por anúncio; Shopee
-- e TikTok dão desempenho por item quando os apps de Ads existirem. `provider` +
-- `extra_metrics` (abaixo) fazem o segundo canal ser um INSERT, não uma tabela.
CREATE TABLE IF NOT EXISTS workspace_ad_product_metrics (
  -- TEXT, e não uuid como nas irmãs da 0012 (revisão do Delta, 28/08/2026).
  --
  -- Medido: 26 tabelas do banco usam text; só `workspace_ad_metrics` e
  -- `workspace_ad_reports` usam uuid. Nelas nunca doeu porque são lidas SEMPRE
  -- standalone (`WHERE workspace_id=$1`, parâmetro que o Postgres converte
  -- sozinho). Esta é diferente: a RAZÃO DE ELA EXISTIR é o JOIN por
  -- (workspace_id, sku) com `workspace_channel_order_items` e
  -- `workspace_product_costs`, que são text. `uuid = text` não tem operador no
  -- Postgres — o join natural que a próxima pessoa escrever daria ERRO, e o
  -- conserto óbvio (cast numa das pontas) mataria o uso do índice do lado
  -- convertido. Custo honesto de usar text: +20 bytes por entrada de índice
  -- (~1 MB/ano na escala real). Barato para não deixar armadilha na consulta
  -- que justifica a tabela.
  workspace_id   text        NOT NULL,
  provider       text        NOT NULL,
  connection_id  text        NOT NULL,
  day            date        NOT NULL,
  campaign_id    text        NOT NULL,
  -- Identificador do produto NO CANAL (ASIN na Amazon, MLB no ML, item_id na
  -- Shopee). É o que a API devolve, sem tradução.
  product_id     text        NOT NULL,
  -- (1) SKU NA CHAVE, e não só o id do canal.
  --
  -- O mesmo ASIN pode ser anunciado sob SKUs diferentes do vendedor, e é o SKU
  -- que casa com o custo cadastrado — sem ele na chave, duas linhas do relatório
  -- colidiriam e uma sobrescreveria a outra em silêncio. Vazio (não nulo) quando
  -- o canal não informa: coluna de chave não aceita null, e '' aqui significa
  -- "o canal não mandou SKU", nunca "SKU desconhecido do produto".
  sku            text        NOT NULL DEFAULT '',
  product_title  text,
  impressions    integer     NOT NULL DEFAULT 0,
  clicks         integer     NOT NULL DEFAULT 0,
  -- Dinheiro em numeric, nunca float (mesma regra da 0012).
  cost           numeric(12,2) NOT NULL DEFAULT 0,
  purchases      integer     NOT NULL DEFAULT 0,
  sales          numeric(12,2) NOT NULL DEFAULT 0,
  -- (2) MÉTRICAS DA FONTE, e o `null` que importa.
  --
  -- Guardadas COMO O CANAL AS ENTREGA — não recalculamos ACOS a partir de
  -- cost/sales: se a fonte usa outra janela de atribuição que os totais da linha,
  -- o número recalculado divergiria do painel do canal e a vendedora veria dois
  -- ACOS diferentes para a mesma campanha. `null` = a fonte não mandou (sem
  -- clique no dia, por exemplo), e a tela mostra "—". Nunca 0%.
  --
  -- UNIDADE: PERCENTUAL para `acos` (18,00 = 18%), multiplicador para `roas`
  -- (5,00 = 5x). Amazon (`acosClicks14d`) e ML entregam ACOS em percentual, então
  -- hoje batem. Canal que mandar fração (0,18) tem a ESCALA normalizada pelo
  -- colhedor — normalizar unidade não é "calcular a métrica"; gravar 0,18 ao lado
  -- de 18,00 na mesma coluna é que seria mentira.
  --
  -- (12,4) e não (9,4): numeric é varlena, precisão declarada maior não custa
  -- byte para valor típico, e o modo de falha é assimétrico — overflow em numeric
  -- não trunca, LEVANTA ERRO e derruba o lote inteiro do upsert. (9,4) estouraria
  -- com ACOS ≥ 100.000% (R$ 5.000 gastos para R$ 5 vendidos num dia: improvável,
  -- não impossível). Medida do Delta em 28/08/2026.
  acos           numeric(12,4),
  roas           numeric(12,4),
  -- (3) MOEDA POR LINHA: conta multi-marketplace (BR + US) traz relatórios em
  -- moedas diferentes na mesma tabela; somar sem olhar a moeda daria um total
  -- sem significado. Sem default 'BRL' de propósito — quem grava declara.
  currency       text        NOT NULL,
  -- (4) O QUE É ESPECÍFICO DE CADA CANAL VIVE AQUI, não em coluna nova.
  --
  -- `cvr` e `sov` do ML, `orders`/`gmv` da Shopee, breakdown de criativo do
  -- TikTok: cada canal tem métricas que os outros não têm. Coluna dedicada para
  -- cada uma deixaria a tabela cheia de null e exigiria migration por canal.
  -- Chave = nome da métrica NA FONTE; valor = como a fonte mandou.
  extra_metrics  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  synced_at      timestamptz NOT NULL DEFAULT now(),
  -- (5) A JANELA DE ATRIBUIÇÃO DIFERE ENTRE CANAIS — e está no nome da métrica
  -- da fonte, não aqui.
  --
  -- ⚠️ `sales`, `purchases`, `acos` e `roas` da Amazon vêm da janela de 14 dias
  -- por clique (`*Clicks14d`); a tabela de campanha (0012) usa 30 dias
  -- (`sales30d`/`purchases30d`); o ML atribui em janela própria. Somar produto
  -- com campanha, ou comparar canais lado a lado, exige saber disso — está
  -- registrado em docs/amazon-ads.md e não pode virar folclore. Quem colhe
  -- guarda em `extra_metrics.attribution_window` a janela que a fonte usou.
  PRIMARY KEY (workspace_id, provider, connection_id, day, campaign_id, product_id, sku)
) WITH (fillfactor = 90);

-- FILLFACTOR 90 — a tabela NÃO é append-only (correção de premissa minha, pelo
-- Delta em 28/08/2026).
--
-- A Ads API ENTREGA O DIA CORRENTE (registrado no "Changelog observado" de
-- docs/amazon-ads.md, justamente como correção de uma afirmação anterior), então
-- as linhas de HOJE são recolhidas e reescritas a cada ciclo do cron (~24×/dia).
-- O detalhe que fecha o argumento: NENHUMA métrica está indexada — os índices só
-- tocam chave, sku e day —, então esses updates são HOT-elegíveis e só falta
-- espaço na página. Com ff=100 nasceriam não-HOT (churn de índice de graça); com
-- 90, viram HOT. Custo: 10% de uma tabela de poucos MB. Mesma física da
-- migration 0015 (channel_orders).

-- A tela pede "os últimos N dias deste workspace neste canal", igual à de campanha.
CREATE INDEX IF NOT EXISTS workspace_ad_product_metrics_periodo
  ON workspace_ad_product_metrics (workspace_id, provider, day DESC);

-- (4) GUARDA ANTI-REGRAVAÇÃO, OBRIGATÓRIA DESDE O DIA 1 (ADR-022).
--
-- Esta é a regra que o INSERT do colhedor precisa cumprir — não é DDL, e está
-- aqui porque é onde a próxima pessoa procura antes de escrever a query:
--
--   INSERT ... ON CONFLICT (...) DO UPDATE SET ...
--    WHERE (metrics.impressions, metrics.clicks, metrics.cost, metrics.purchases,
--           metrics.sales, metrics.acos, metrics.roas, metrics.extra_metrics)
--          IS DISTINCT FROM (EXCLUDED.impressions, ...)
--
-- Sem ela, cada ciclo do cron reescreveria TODAS as linhas do período com os
-- mesmos valores — o relatório da Amazon repete os dias anteriores a cada
-- colheita. Foi exatamente o que o materializer legado fazia: 3 milhões de
-- updates em 12 linhas, o contraexemplo que a ADR-026 existe para impedir. O
-- teste `upsertSemReescritaInutil.test.mjs` varre as escritas das tabelas
-- canônicas; esta entra na mesma vigilância.

-- Cruzamento por SKU (juntar com custo e com o canônico) é a leitura que dá o
-- veredito "paga para vender" — sem este índice ela varre a tabela inteira.
CREATE INDEX IF NOT EXISTS workspace_ad_product_metrics_sku
  ON workspace_ad_product_metrics (workspace_id, provider, sku, day DESC)
  WHERE sku <> '';

-- (6) RETENÇÃO: OPERACIONAL, PARA SEMPRE.
--
-- Declarado aqui porque a ADR-026 exige que toda tabela nova diga sua camada, e
-- porque a próxima pessoa a desenhar expurgo vai procurar exatamente por isto:
-- esta tabela é categoria "Operacional" (ADR-016) — dado agregado, pequeno
-- (dezenas de linhas por dia), sem payload bruto e sem dado pessoal. NÃO entra
-- no expurgo do bronze: gasto com anúncio de 2026 é o que permite comparar
-- sazonalidade em 2027, e a Amazon só serve relatório de 90 dias para trás — o
-- que apagarmos aqui não volta.
COMMENT ON TABLE workspace_ad_product_metrics IS
  'Metricas diarias de anuncio por produto anunciado. Camada Operacional (ADR-016): retencao permanente, fora do expurgo de bronze. ACOS/ROAS gravados como a fonte entrega; janela de atribuicao varia por canal (ver extra_metrics.attribution_window).';

-- (7) UMA VAGA DE RELATÓRIO PENDENTE POR REPORT_TYPE.
--
-- O ciclo assíncrono agora pede DOIS relatórios (campanha e produto anunciado).
-- Sem esta coluna o colhedor não saberia em qual tabela gravar cada resultado, e
-- o teto de pendentes (MAX_PENDENTES) misturaria os dois tipos: um relatório de
-- produto travado seguraria o de campanha, e vice-versa. O default preserva as
-- linhas que já existem, que são todas de campanha.
ALTER TABLE workspace_ad_reports
  ADD COLUMN IF NOT EXISTS report_type text NOT NULL DEFAULT 'spCampaigns';

-- O índice de pendentes passa a discriminar por tipo: cada tipo tem a sua fila.
CREATE INDEX IF NOT EXISTS workspace_ad_reports_pendentes_por_tipo
  ON workspace_ad_reports (workspace_id, provider, report_type, status, requested_at)
  WHERE status = 'pending';

-- E o antigo sai no mesmo arquivo: o novo é superset útil dele (mesmo prefixo
-- de workspace/provider, mesma condição parcial), e manter os dois numa tabela
-- de ~586 linhas só paga escrita dobrada e deixa lixo para a faxina depois.
-- Recomendação do Delta na revisão de 28/08/2026.
DROP INDEX IF EXISTS workspace_ad_reports_pendentes;
