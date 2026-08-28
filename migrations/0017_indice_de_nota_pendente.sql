-- Índice parcial para a faixa de NF-e pendente da Shopee.
--
-- O PROBLEMA MEDIDO (28/08/2026, loja real com 22.254 pedidos)
--
-- A consulta que alimenta a faixa "N pedido(s) aguardando NF-e" fazia Index
-- Scan pela chave primária e filtrava **22.252 linhas para achar 2**, tocando
-- 10.930 buffers. Hoje custa 15–100ms porque a tabela inteira está no cache do
-- Postgres — não é o gargalo atual, mas é a consulta do overview que mais lê
-- páginas, e em loja maior (ou cache frio) vira problema de verdade.
--
-- POR QUE ÍNDICE, E NÃO FILTRO DE PERÍODO
--
-- A alternativa óbvia — recortar por período — foi levantada e REJEITADA: nota
-- fiscal travada bloqueia o envio HOJE, mesmo num pedido de 40 dias atrás.
-- Filtrar por período deixaria a pendência mais antiga invisível justamente
-- para quem precisa resolvê-la. A decisão de produto ("pendência operacional
-- não tem período") continua valendo; o que muda é só o custo de encontrá-la.
--
-- O índice é PARCIAL: indexa apenas as linhas que satisfazem o predicado — na
-- loja real, 2 de 22.254. Ele custa quase nada em disco e some do caminho de
-- escrita de todo pedido que não está com nota pendente.
CREATE INDEX IF NOT EXISTS channel_orders_nota_pendente_idx
  ON workspace_channel_orders (workspace_id, provider, connection_id)
  WHERE status = 'paid' AND (raw #>> '{invoice_data,status}') = 'pending';
