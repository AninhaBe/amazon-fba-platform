# ADR-004: Custo do produto resolvido na consulta, por vigência

- **Status:** Aceito
- **Data:** 2026-07 (retroativo)

## Contexto

O lucro depende do **custo** do produto, que **muda ao longo do tempo** (compra novo
lote a outro preço). Uma venda de março tem que usar o custo vigente em março, não o
atual. Precisávamos decidir onde e quando resolver esse custo.

## Decisão

Guardar o custo **com histórico de vigência** em `workspace_product_costs` e
**resolvê-lo na consulta** (por data da venda), não na ingestão. A contribuição/lucro
é calculada em tempo de leitura, casando cada venda com o custo vigente no dia.

## Alternativas consideradas

- **Congelar o custo no pedido na ingestão.** Rejeitada: se o custo fosse cadastrado
  ou corrigido depois da venda entrar, o histórico ficaria errado e exigiria reprocessar
  tudo. Resolver na leitura deixa a correção de custo refletir na hora.

## Consequências

- ➕ Cadastrar/corrigir custo reflete **imediatamente** no lucro, sem reprocessar vendas.
- ➕ Retroativamente correto: cada venda usa o custo da sua época.
- ➖ A query de lucro é mais pesada (join por vigência) — mitigado pelo cache (ADR-002).
- ➖ **Sem custo cadastrado ⇒ sem margem suposta.** O produto fica "custo pendente" e
  **fora** do cálculo de lucro (nunca inventar margem/zero). A UI sinaliza isso, e a
  curva ABC não classifica esses produtos.

Relacionado: taxonomia de fees e rateio em [`../architecture/canonical-model.md`](../architecture/canonical-model.md).
