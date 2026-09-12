-- A solicitação de avaliação de um pedido ganha registro próprio.
--
-- POR QUE UMA TABELA: a Solicitations API não lista histórico. Depois que a
-- solicitação é enviada, getSolicitationActionsForOrder passa a responder "sem
-- ações" — indistinguível de "fora da janela de 5–30 dias". Só o NOSSO registro
-- distingue os dois, e a tela precisa distinguir ("já solicitada" não é "não
-- pode"). Medido em 12/09/2026 na conta real: pedido de ontem sem ações, pedidos
-- de 17/08–03/09 oferecendo productReviewAndSellerFeedback.
--
-- A MESMA tabela é o cache de elegibilidade: a API tem limite de 1 chamada por
-- segundo, e uma tabela de pedidos com 40 linhas não pode disparar 40 chamadas
-- por carga de tela. `consultado_em` diz a idade da leitura; a rota decide
-- quando reconsultar.
--
-- ═══ QUEM LÊ ISSO AGORA — a pergunta obrigatória antes do apply ═══
--
-- Ninguém: a tabela é NOVA e aditiva (criar não quebra leitor). O leitor nasce
-- no MESMO deploy desta janela (rotas da frente "Solicitar avaliação"), que
-- entra DEPOIS do apply — ordem combinada: apply → deploy. Nenhuma view toca
-- esta tabela e nenhuma migration anterior a menciona.
--
-- Sem DML aqui: só DDL aditivo. Nada é removido nem movido.

CREATE TABLE IF NOT EXISTS workspace_review_solicitations (
  workspace_id       uuid        NOT NULL,
  provider           text        NOT NULL DEFAULT 'amazon',
  connection_id      text        NOT NULL,
  external_order_id  text        NOT NULL,
  -- 'pode_solicitar'  = a API ofereceu a ação na última consulta
  -- 'ja_solicitada'   = NÓS enviamos (solicitado_em diz quando)
  -- 'fora_da_janela'  = a API não ofereceu e não fomos nós (cedo demais,
  --                     tarde demais, ou solicitada por fora — a API não separa)
  estado             text        NOT NULL CHECK (estado IN ('pode_solicitar', 'ja_solicitada', 'fora_da_janela')),
  consultado_em      timestamptz NOT NULL DEFAULT now(),
  solicitado_em      timestamptz,
  -- 'ja_solicitada' exige o carimbo de quando; os outros estados exigem a ausência.
  CONSTRAINT solicitacao_com_carimbo CHECK (
    (estado = 'ja_solicitada') = (solicitado_em IS NOT NULL)
  ),
  PRIMARY KEY (workspace_id, provider, connection_id, external_order_id)
);

-- Isolamento entre inquilinos, o mesmo desenho do restante do schema: leitura e
-- escrita sempre por workspace_id (a PK já começa nele; nenhum índice extra é
-- necessário para o padrão de acesso da tela, que consulta por lista de pedidos
-- de UM workspace).
ALTER TABLE workspace_review_solicitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workspace_review_solicitations FROM PUBLIC;
