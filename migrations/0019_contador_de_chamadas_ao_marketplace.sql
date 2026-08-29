-- Contador de chamadas a marketplace, por endpoint e por hora.
--
-- POR QUÊ (29/08/2026): a Shopee abriu um alerta de comportamento anormal
-- contra o nosso app e a pergunta óbvia — "quantas chamadas por endpoint e por
-- hora?" — NÃO TINHA COMO SER RESPONDIDA. Não existe contador nenhum, em canal
-- nenhum. A resposta teve que ser derivada de código e configuração, marcada
-- como inferência, e nesse dia ninguém pôde dizer se fomos nós.
--
-- Chegar sem dado numa segunda vez seria escolha, não fatalidade. Alerta de
-- plataforma vai acontecer de novo.
--
-- ⚠️ O QUE ESTA TABELA PRECISA RESPONDER, e é por isso que a chave é esta:
--   · "quantas vezes chamamos get_escrow_detail ontem às 3h?" -> (provider,
--     endpoint, hora)
--   · "de qual loja?" -> connection_id, porque o limite da Shopee é POR LOJA
--   · "deu erro?" -> erros, e o último status visto
--
-- `workspace_id` e `connection_id` são NULL quando a chamada acontece fora de
-- escopo (renovação de token no boot, sonda). NULL aqui é "não havia escopo",
-- não "desconhecido por preguiça" — e é fato, não zero fabricado.
--
-- ⚠️ AGREGADO POR HORA, NÃO UMA LINHA POR CHAMADA. Uma linha por chamada seria
-- a mesma receita do coletor de métricas que derrubou a produção às 3h desta
-- madrugada: instrumento que custa mais que o que mede. A gravação é UPSERT
-- somando, feita em lote pelo processo, não uma escrita por chamada.
--
-- CICLO DE VIDA (ADR-016): 90 dias. É janela suficiente para responder sobre um
-- alerta de plataforma e curta o bastante para a tabela não virar histórico
-- eterno. A limpeza entra no cron de retenção que já existe.

CREATE TABLE IF NOT EXISTS marketplace_api_calls (
  provider      text        NOT NULL,
  endpoint      text        NOT NULL,
  hora          timestamptz NOT NULL,
  workspace_id  text,
  connection_id text,
  chamadas      integer     NOT NULL DEFAULT 0,
  erros         integer     NOT NULL DEFAULT 0,
  -- Último status HTTP e último cabeçalho de limite vistos naquela hora. Hoje
  -- jogamos os dois fora; se a Shopee mandar aviso de limite, é aqui que ele
  -- passa a existir.
  ultimo_status integer,
  ultimo_limite text,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- ⚠️ ÍNDICE ÚNICO POR EXPRESSÃO, e não PRIMARY KEY: `PRIMARY KEY` implica
-- `NOT NULL`, e aqui o NULL é informação — "esta chamada não tinha escopo".
-- Trocar o NULL por string vazia para caber numa PK seria inventar um valor
-- para satisfazer a estrutura, que é a mesma falha do `available_qty NOT NULL`
-- transformando "não sei" em zero.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_api_calls_chave_idx
  ON marketplace_api_calls (
    provider, endpoint, hora,
    COALESCE(workspace_id, ''), COALESCE(connection_id, '')
  );

COMMENT ON TABLE marketplace_api_calls IS
  'Quantas vezes o NEXO chamou cada endpoint de cada marketplace, por hora e por conexao. Agregado, nunca uma linha por chamada. Retencao de 90 dias. Ver ADR-032.';

-- A pergunta de um incidente é sempre "o que aconteceu naquela hora", nos
-- quatro canais de uma vez — por isso a hora vem primeiro no índice.
CREATE INDEX IF NOT EXISTS marketplace_api_calls_hora_idx
  ON marketplace_api_calls (hora DESC, provider);
