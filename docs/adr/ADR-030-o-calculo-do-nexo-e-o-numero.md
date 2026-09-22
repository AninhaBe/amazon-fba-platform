# ADR-030: O cálculo do NEXO é o número — sem rótulo de "estimativa"

- **Status:** Aceito
- **Data:** 2026-09-21
- **Emenda a:** [ADR-027](./ADR-027-tarifa-estimada-ate-a-liquidacao.md)

## Contexto

O ADR-027 mandava marcar como "estimativa" todo valor que o NEXO calcula antes
de a Amazon liquidar, para não afirmar como certo o que a fonte ainda não
confirmou. A trava evitava inflar número.

Decisão da dona (21/09/2026, verbatim): *"não existe estimado, se estamos
fazendo o cálculo certo, é o certo, para de usar essa palavra."*

O raciocínio: o NEXO tem **custo real** (cadastrado), **% da categoria**, **FBA**
e **imposto** — e sabe o **preço que o SKU pratica**. Com isso, o lucro de cada
pedido é uma **conta correta**, não um chute. Chamar isso de "estimativa" faz o
vendedor desconfiar de um número sólido.

## Decisão

**O valor calculado pelo NEXO é o número exibido, sem rótulo de estimativa.** Ele
aparece por pedido (venda, tarifa, custo, imposto, margem) assim que o pedido
entra, para TODOS os pedidos — não só os que a Amazon já liquidou.

## Como a incerteza é tratada (sem a palavra)

O que o rótulo de "estimativa" tentava proteger — o valor mudar depois — continua
tratado, por **mecanismo**, não por aviso:

1. **Cancelamento:** pedido cancelado **sai** do faturamento e do lucro (já é
   assim: `status <> 'cancelled'` em todo leitor). Se o pendente não vira venda,
   ele some da conta.
2. **Substituição na liquidação:** quando a Amazon publica o valor/tarifa reais,
   eles **substituem** o cálculo (o `gross` real tem prioridade sobre o valor da
   nossa base; a tarifa real substitui a da tabela — ADR-027 Emenda II segue
   valendo para a substituição, só não para a ROTULAGEM).

Ou seja: o número é o certo hoje; se o mundo mudar (cancelou, ou a Amazon cobrou
diferente), o próprio dado muda junto. Nada de adjetivo que se desculpa.

## O que continua proibido (não muda)

- **Média histórica calculada por nós** continua proibida (ADR-027). O preço do
  pedido sem valor sai do **preço que o MESMO SKU praticou** (o mais próximo da
  data), que é número real do catálogo — não uma média inventada.
- **`null` ≠ `0`:** SKU sem nenhum preço conhecido ainda fica sem valor (não vira
  zero). O que muda é que, tendo preço conhecido, o NEXO **usa** e mostra.

## Consequências

- ➕ O vendedor vê **lucro e margem de cada pedido**, na hora, para todos.
- ➕ Some a confusão de "por que esse pedido está sem margem".
- ➖ Reverte a rotulagem do ADR-027. Quem trouxer a palavra "estimativa" de volta
  para um valor calculado precisa reabrir esta decisão.
