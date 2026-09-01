-- A tabela de tarifa REAL passa a ter vocabulário — e o resíduo do caminho antigo
-- sai antes, no mesmo arquivo.
--
-- ═══ POR QUE OS DOIS PASSOS VIVEM JUNTOS ═══
--
-- `ADD CONSTRAINT ... CHECK` **valida as linhas existentes**. Com as 456 linhas
-- de `fee_type = 'estimated'` no lugar, o `ADD` falharia — e separar em duas
-- migrations deixaria a ordem por conta de quem aplica.
--
-- Aqui a ordem é ESTRUTURAL: uma transação, limpeza antes do CHECK, e não existe
-- estado intermediário em que uma tenha rodado sem a outra. É o princípio da
-- 0026 aplicado ao contrário — lá o schema esperou o dado; aqui o dado é
-- corrigido no mesmo passo que o schema.
--
-- ═══ PASSO 1: O RESÍDUO DO CAMINHO QUE A 0022 MATOU ═══
--
-- Medido em 01/09/2026: 456 linhas / 228 pedidos com `fee_type = 'estimated'`,
-- só na Amazon — 376 na Silveiras (1,19 a 45,20) e 80 na conta da Ana (todas
-- 0,00, a assinatura do estimador antigo).
--
-- A 0022 apagou 552 dessas linhas e criou a tabela própria para a estimativa.
-- Estas voltaram no intervalo entre aquele apply e a troca do produtor, hoje. O
-- backend provou por três caminhos independentes que o produtor está morto:
-- união de tipos fechada, o estimador só escreve na tabela nova, e a sobreposição
-- 227/228 identifica o resíduo daquela janela. **Não voltam.**
--
-- ⚠️ E ELAS NÃO SÃO INÓCUAS, que é o motivo de sair agora e não "quando der":
-- a view `workspace_channel_order_fees_efetivas` carimba `basis='actual'` em
-- TUDO que vem desta tabela. Uma estimativa gravada aqui vira **tarifa oficial na
-- tela** — o defeito exato que a separação previsto/real existe para impedir.
-- Hoje os leitores usam whitelist positiva e a ignoram; no dia em que alguém
-- somar sem whitelist, ela conta como real.
DELETE FROM workspace_channel_order_fees WHERE fee_type = 'estimated';

-- ═══ PASSO 2: O VOCABULÁRIO, QUE NUNCA EXISTIU AQUI ═══
--
-- Medido: `pg_constraint` sobre esta tabela tinha **uma única** entrada — a
-- chave primária. **Nenhuma restrição sobre `fee_type`.** O tipo
-- `CanonicalFeeType` (`canonical.ts:20`) protege o aplicativo; a TABELA aceitava
-- qualquer string vinda de script, `psql` ou migration.
--
-- A lista abaixo é exatamente esse tipo, verificada contra o que existe no banco:
--
--   commission ........ 97.569 linhas  (amazon, mercado_livre, shopee, tiktok)
--   shipping_seller ... 48.596          (mercado_livre, tiktok)
--   ads ...............  1.635          (shopee)
--   refund ............    344          (amazon, shopee)
--   fulfillment .......    261          (amazon)
--   payment, taxes_withheld ... sem linhas hoje, mas o código as produz
--
-- ⚠️ `other` FICA AQUI, E NA TABELA DE ESTIMATIVAS FOI BANIDO — a assimetria é
-- deliberada e este é o lugar de justificá-la:
--
--   * na tabela de ESTIMATIVAS, recusar significa **não gravar um palpite** que
--     pode ser recalculado depois. Custo: nenhum;
--   * na tabela REAL, recusar significa **descartar um fato financeiro do
--     extrato**. Uma tarifa que o canal cobrou e que não soubemos classificar
--     precisa entrar no lucro mesmo com rótulo grosseiro. Perder dinheiro do
--     extrato é pior que registrá-lo sem natureza fina.
--
-- ⚠️ MAS `other` AQUI PRECISA DE ALARME, e isto fica como dívida declarada: foi
-- exatamente um escape sem alarme que virou 100% das linhas na tabela nova
-- (1.532 linhas em `other`, achadas por acaso). Se `other` começar a crescer
-- nesta tabela, ninguém vai saber — não há contador. **Escape sem alarme vira
-- caminho principal.**
--
-- E `estimated` NÃO entra na lista: procedência não é natureza. É a decisão da
-- ADR-027, Emenda II, agora exigida pelo banco e não pela lembrança de quem grava.
ALTER TABLE workspace_channel_order_fees
  ADD CONSTRAINT channel_order_fees_vocabulario_canonico CHECK (
    fee_type IN (
      'commission', 'shipping_seller', 'fulfillment', 'payment',
      'ads', 'taxes_withheld', 'refund', 'other'
    )
  );

COMMENT ON COLUMN workspace_channel_order_fees.fee_type IS
  'Natureza da tarifa, na taxonomia canonica (canonical.ts CanonicalFeeType). NUNCA procedencia: estimativa vive em workspace_channel_order_fee_estimates. "other" e permitido aqui — e so aqui — porque descartar fato do extrato e pior que rotula-lo grosseiramente; ver a nota na migration 0028.';
