# As 17 idas da rota da Amazon — levantamento para o backend

**Escrito pelo Delta em 01/09/2026 como consultoria de banco.** Quem implementa é
o backend; `amazonOverviewCanonical.ts` é arquivo dele e não foi tocado.

## Por que isto virou prioridade

Deixou de ser otimização. Medido na etapa 1 da
[ADR-036](../adr/ADR-036-barreira-de-inquilino-no-banco.md):

- **p50 da camada de dados: 223 ms**, contra os **200 ms** que a ADR-017 reserva
  para ela — e isso **sem flag nenhuma**, antes de auth, proxy e Sales API. A
  rota já está apertada hoje.
- Qualquer forma de carimbo de inquilino **multiplica** idas. Com 17 consultas,
  todas as formas conhecidas estouram o orçamento. **A barreira não entra
  enquanto a rota fizer 17 idas.**

⚠️ O número em milissegundos foi medido fora da região do banco e **superestima**.
O que não depende de latência é a contagem: **17 idas por carga, com 8 slots de
pool** (`db.ts`, incidente de 29/08).

## O mapa: 17 consultas em 4 barreiras

| # | linha | lê | grão |
|---|---|---|---|
| 1 | 250 | `workspace_marketplace_syncs` | metadados da conexão |
| 2 | 256 | `workspace_channel_orders` | escalares do período |
| 3 | 290 | `workspace_channel_order_items` | por SKU |
| 4 | 301 | `workspace_channel_order_items` | por produto |
| 5 | 313 | `workspace_channel_orders` | 10 mais recentes |
| 6 | 322 | `workspace_channel_orders` + itens | linhas do pedido |
| 7 | 359 | `workspace_channel_orders` | por dia |
| 8 | — | custos (`getCosts`) | catálogo |
| 9 | 436 | `workspace_channel_order_fee_estimates` | por linha |
| 10 | 587 | `workspace_settings` | alíquota |
| 11 | 650 | `workspace_channel_orders` | faturamento do lucro |
| 12 | 670 | `workspace_channel_order_items` | linhas do pendente |
| 13 | 725 | view `..._fees_efetivas` | estimada |
| 14 | 785 | `workspace_channel_order_fees` | estorno |
| 15 | 836 | view `..._fees_efetivas` | tarifa |
| 16–17 | — | radar de estoque, anúncios | outras fontes |

## Os candidatos, do mais seguro ao mais delicado

### A. As três de tarifa (#13, #14, #15) → uma — **risco nenhum**

São **três agregados escalares sobre o mesmo conjunto de linhas de tarifa, no
mesmo período**. Viram uma consulta com `SUM(...) FILTER (WHERE ...)`.

**Por que não há fan-out:** não se acrescenta join nenhum — é a mesma varredura,
com três somas condicionais em vez de três varreduras. `FILTER` não duplica
linha, ao contrário de `LEFT JOIN` com cardinalidade maior.

**Ganho: −2 idas.**

### B. As duas de item por chave diferente (#3, #4) → uma — **risco nenhum**

`#3` agrupa por SKU e `#4` por `external_product_id`, **sobre as mesmas linhas**.
Uma consulta agrupada por `(external_product_id, sku)` devolve o grão mais fino, e
as duas visões saem dela **em memória**.

**Por que não há fan-out:** grão mais fino do mesmo conjunto; a soma por SKU é a
soma das linhas que compartilham o SKU. Nenhum join novo.

**Ganho: −1 ida.**

### C. Os escalares e o diário (#2, #7, #11) → possivelmente uma — **risco médio**

`#7` já produz o período **por dia**. Os escalares de `#2` e o faturamento de
`#11` são, em tese, a soma dessas linhas diárias.

⚠️ **Onde isto pode dar errado, e é o motivo de eu não chamar de seguro:** `#7`
tem um `LEFT JOIN LATERAL` para contar unidades. Se o total escalar for somado
sobre um resultado que já passou por esse lateral, **o risco de fan-out é real** —
um pedido com N itens pode ser contado N vezes no total de pedidos.

**Como verificar antes de adotar:** comparar, para uma conta e um período,
`SUM` das linhas diárias contra o escalar de hoje. Se der diferente, o lateral já
está inflando alguma coisa — e aí o achado vale mais que a economia.

**Ganho: até −2 idas**, condicionado à verificação.

### D. Recentes derivados dos detalhados (#5, #6) — **risco baixo, com uma condição**

`#6` já traz os pedidos ordenados por `occurred_at DESC` até
`DETAILED_ORDER_LIMIT`. Os 10 mais recentes de `#5` são o prefixo disso.

⚠️ **A condição:** só vale se `DETAILED_ORDER_LIMIT ≥ 10` **e** se `#5` e `#6`
usarem o mesmo filtro de status. Se `#5` incluir status que `#6` exclui, derivar
um do outro muda o que a tela mostra — e isso seria mudança de produto disfarçada
de otimização.

**Ganho: −1 ida**, condicionado.

## O que NÃO recomendo tocar

- **#1, #10** (metadados e alíquota): baratas, de tabelas diferentes, e juntá-las
  a agregados só embaralha.
- **#16–17** (radar e anúncios): outras fontes, fora do escopo.
- **Juntar consultas de tabelas diferentes com `JOIN`** para economizar ida. É
  onde o fan-out mora: um `JOIN` entre pedidos e itens multiplica linhas de
  pedido pela quantidade de itens, e todo `SUM` sobre pedido passa a mentir. **A
  economia de uma ida não paga um total errado** — foi assim que a auditoria de
  agosto achou o defeito #3 ("não misturar bases").

## Resumo

| candidato | ganho | risco |
|---|---|---|
| A — três de tarifa viram uma | −2 | nenhum |
| B — duas de item viram uma | −1 | nenhum |
| C — escalares somados do diário | até −2 | médio, verificar fan-out do lateral |
| D — recentes derivados dos detalhados | −1 | baixo, condicionado ao limite e ao status |

**17 → 11 no melhor caso**, sendo **−3 sem risco nenhum**.

⚠️ **E isso ainda não basta para a barreira.** Com 11 idas, o carimbo em três
idas por consulta daria 33 — ainda acima do que o orçamento comporta. Este
levantamento é o primeiro passo, não o suficiente: a próxima pergunta é se parte
do trabalho pode sair do caminho da requisição (cache com invalidação por evento,
ou pré-agregação), e essa é uma decisão de arquitetura, não de consulta.
