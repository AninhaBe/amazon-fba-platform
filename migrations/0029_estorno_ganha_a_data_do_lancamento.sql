-- A tarifa ganha `posted_at`: a data em que o marketplace LANÇOU o valor.
--
-- ⚠️ O DEFEITO QUE ISTO DESTRAVA, e ele está escrito num teste desde 31/08/2026:
-- o estorno entra no resultado **pela data do PEDIDO**, e não porque alguém
-- preferiu assim — porque `workspace_channel_order_fees` não tem nenhuma coluna
-- de data. A data real existe na Transactions API (`postedDate`) e nunca foi
-- persistida. O teste `estornoReduzOResultado` registra isso e manda revisitar
-- quando a data existir.
--
-- 📌 O TAMANHO, medido em 01/09/2026 na conexão `amazon:A15NQMF7A6J1Y0`, sobre
-- os 42 estornos de pedidos dos últimos 60 dias:
--
--   data de lançamento encontrada ....... 42 de 42
--   atraso entre pedido e lançamento .... mínimo 1 dia, MEDIANA 11, máximo 44
--   estornos que mudam de MÊS ............ 5
--   valor que muda de período ............ R$ 193,00
--
-- A mediana de 11 dias é o número que importa: num recorte de "Hoje" ou "7 dias"
-- o estorno aparece quase sempre no período errado — some do período em que a
-- Amazon o cobrou e reduz um período em que nada aconteceu.
--
-- 📌 QUEM LÊ ISSO AGORA (a pergunta obrigatória antes do apply): a coluna é
-- ADITIVA e NULLABLE, então nenhum leitor quebra. Os leitores que passam a
-- usá-la o fazem com `COALESCE(f.posted_at, o.occurred_at)` — enquanto a
-- ingestão não tiver preenchido o histórico, o comportamento é exatamente o de
-- hoje. Nada muda de valor no instante do apply; muda quando o dado chegar.
--
-- ⚠️ E `NULL` AQUI SIGNIFICA "NÃO CAPTURADO", NÃO "MESMO DIA DO PEDIDO". É por
-- isso que o fallback mora na consulta e não num `DEFAULT`: um default carimbaria
-- a data do pedido como se fosse a do lançamento, e a distinção entre "sabemos" e
-- "assumimos" desapareceria para sempre.
ALTER TABLE workspace_channel_order_fees
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;

COMMENT ON COLUMN workspace_channel_order_fees.posted_at IS
  'Data em que o marketplace LANCOU a tarifa (postedDate na Transactions API da '
  'Amazon). NULL = nao capturado — nunca "mesmo dia do pedido". Quem le usa '
  'COALESCE(posted_at, occurred_at do pedido) e a tela diz qual data usou.';

-- Índice só sobre o que existe: a varredura por período filtra por esta coluna
-- quando ela está preenchida, e a maioria das linhas históricas continuará nula.
CREATE INDEX IF NOT EXISTS workspace_channel_order_fees_posted_at_idx
  ON workspace_channel_order_fees (workspace_id, provider, connection_id, posted_at)
  WHERE posted_at IS NOT NULL;
