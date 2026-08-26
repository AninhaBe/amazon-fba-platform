-- Ledger dos eventos da Stripe já processados, e o índice que acha a conta
-- dona de um cliente da Stripe.
--
-- POR QUE UMA TABELA, E NÃO `workspace_settings`
--
-- Toda tabela do produto é por workspace, e é assim que o isolamento se sustenta.
-- Este ledger não pode ser: o evento que MAIS importa — a primeira compra de um
-- e-mail que ainda não tem conta — chega antes de existir workspace algum. Gravar
-- isso sob um `workspace_id` inventado seria furar o isolamento justamente na
-- tabela que existe para proteger dinheiro. Fica fora, como `schema_migrations`:
-- ledger de sistema, escrito só pelo webhook.
--
-- POR QUE PRECISA EXISTIR
--
-- A Stripe reentrega eventos — retentativa por timeout, replay manual, duas
-- instâncias recebendo a mesma entrega. Sem uma reserva atômica, a mesma compra
-- vira dois convites; e o convite manda um "crie sua senha" para quem já criou.
CREATE TABLE IF NOT EXISTS billing_stripe_events (
  -- `evt_...` da Stripe. É a chave da idempotência inteira.
  event_id     text        PRIMARY KEY,
  event_type   text        NOT NULL,
  -- Mesmo tipo de `workspace_settings.workspace_id` (text), que é para onde este
  -- campo aponta. `null` = ainda não resolvido ou evento que não mexe em conta
  -- nenhuma; nunca significa "workspace zero".
  workspace_id text,
  -- O que o evento causou: conta_convidada | assinatura_confirmada |
  -- acesso_cortado | conta_nao_encontrada | ignorado. `null` enquanto reservado.
  outcome      text,
  -- Motivo legível quando o desfecho pede explicação (qual status cortou, por
  -- que foi ignorado). `null` não é sucesso: é "não havia o que explicar".
  detail       text,
  attempts     integer     NOT NULL DEFAULT 1,
  received_at  timestamptz NOT NULL DEFAULT now(),
  -- `null` = reservado e ainda não concluído. É esse predicado que permite a
  -- retomada de uma reserva órfã (processo morto no meio) sem liberar reentrega
  -- de evento já aplicado.
  processed_at timestamptz
);

-- Reservas penduradas: é o que a retomada procura, e o que uma pessoa olha
-- quando desconfia que uma compra não virou acesso.
CREATE INDEX IF NOT EXISTS billing_stripe_events_pendentes
  ON billing_stripe_events (received_at)
  WHERE processed_at IS NULL;

-- Cancelamento e inadimplência chegam com o id do cliente da Stripe, nunca com
-- o e-mail. Sem este índice, achar de quem é o corte vira varredura na tabela de
-- settings de todos os workspaces.
CREATE INDEX IF NOT EXISTS workspace_settings_stripe_cliente
  ON workspace_settings ((value ->> 'stripeCustomerId'))
  WHERE key = 'assinatura';

CREATE INDEX IF NOT EXISTS workspace_settings_stripe_assinatura
  ON workspace_settings ((value ->> 'stripeSubscriptionId'))
  WHERE key = 'assinatura';
