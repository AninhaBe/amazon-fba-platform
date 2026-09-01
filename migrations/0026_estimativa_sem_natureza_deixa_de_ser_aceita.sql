-- O escape `other` sai do vocabulário da tabela de estimativas.
--
-- 🔴 ORDEM DE APLICAÇÃO — ESTA MIGRATION É A ÚLTIMA DE TRÊS PASSOS.
--
--   1. o produtor passa a decompor (ReferralFee -> commission, FBAFees -> fulfillment);
--   2. as 1.532 linhas gravadas como `other` são re-estimadas;
--   3. SÓ ENTÃO esta migration.
--
-- Aplicar antes do passo 1 faria o estimador **parar de gravar** — ele é hoje o
-- único produtor da tabela, e o CHECK recusaria tudo o que ele produz. A tela
-- voltaria a "Tarifas não postadas" sem que ninguém tivesse pedido isso.
--
-- ═══ POR QUE ESTE CONSERTO EXISTE ═══
--
-- A migration 0022 criou esta tabela com um propósito declarado: **previsto e
-- real com o MESMO vocabulário**, para que a pontaria (ADR-027 §5) fosse um
-- join e não um mapeamento hardcoded. Era o defeito nº 1 do desenho anterior.
--
-- Medido em 01/09/2026, poucas horas depois de a tabela entrar em uso:
--
--   linhas com source='observada' ............. 1.532
--   delas com fee_type='commission' ...........     0
--   delas com fee_type='fulfillment' ..........     0
--   delas com fee_type='other' ................ 1.532  (todas)
--
-- Ou seja: o schema estava certo e o dado voltou a não casar. A comissão real é
-- `commission`, a estimativa é `other`, e a pontaria fica impossível de novo.
--
-- ⚠️ E A CULPA É DO CHECK, NÃO DE QUEM GRAVOU. Eu escrevi `other` na lista
-- permitida como **escape para tipo desconhecido**, e ele virou o valor de
-- 100% das linhas.
--
--   **ESCAPE SEM ALARME VIRA CAMINHO PRINCIPAL.**
--
-- Se `other` tivesse um contador, ou um log dizendo "gravando tarifa sem
-- natureza", isso teria aparecido na PRIMEIRA linha e não na 1.532ª. É a família
-- do "guard que nunca dispara", invertida: aqui o buraco é usado sempre em vez
-- de nunca.
--
-- ⚠️ E A LIÇÃO MAIOR, que vale para toda migration futura que criar vocabulário:
--
--   **SCHEMA CERTO NÃO GARANTE DADO CERTO.** A 0022 foi desenhada, revisada,
--   aprovada e aplicada com verificação — e o PRODUTOR não honrou o contrato.
--   Contrato precisa ser exigido dos DOIS lados.
--
-- Por isso esta migration vem acompanhada de teste comportamental
-- (`tests-integracao/vocabularioDaEstimativa.test.mjs`): ele grava `other` e
-- exige que o banco RECUSE. Migration que cria vocabulário sem teste que reprova
-- quem não o usa é convenção com aparência de contrato.

ALTER TABLE workspace_channel_order_fee_estimates
  DROP CONSTRAINT IF EXISTS fee_estimates_vocabulario_canonico;

ALTER TABLE workspace_channel_order_fee_estimates
  ADD CONSTRAINT fee_estimates_vocabulario_canonico CHECK (
    fee_type IN ('commission', 'fulfillment', 'shipping_seller', 'taxes_withheld')
  );

COMMENT ON COLUMN workspace_channel_order_fee_estimates.fee_type IS
  'Mesma taxonomia canonica da tarifa real. Amazon: ReferralFee -> commission, FBAFees -> fulfillment. NAO existe escape: tipo que a fonte nao permita classificar NAO E GRAVADO. Melhor ausencia (que a tela sabe mostrar) do que valor sem natureza (que quebra a pontaria em silencio).';
