# ADR-020: Faturamento tem UMA definição, igual em todos os canais

- **Status:** Aceito
- **Data:** 2026-08-20

## Contexto

Em 20/08/2026 a dona abriu três telas do produto no mesmo período (30 dias, conta Amazon
de maior volume) e encontrou três valores de "faturamento":

| Tela | Valor | O que somava |
|---|---|---|
| `/` (central) | R$ 36.523,90 | Sales API `orderMetrics` — data do pedido, **com** frete, **com** pendentes |
| `/amazon` | R$ 12.162,65 | só pedidos com item **e** tarifa já conciliados (subconjunto em convergência) |
| `/amazon/monitor` | R$ 48.309,93 | transações por **data de postagem** — inclui pedidos anteriores à janela |

A mesma tela exibia ainda **"Taxas R$ 14.956 > Faturamento R$ 12.162"** — impossível, e
causado por emparelhar receita de 883 pedidos com tarifas de 1.536.

**A causa raiz não era bug de cálculo: era ausência de definição.** Cada tela nasceu com a
sua, nenhuma declarava qual, e o produto não tinha uma para arbitrar.

Havia ainda uma divergência entre canais: a regra do ML era
`APROVADAS + CANCELADAS, sem frete` — validada ao centavo contra o painel do ML e o
Mercado Turbo — enquanto a Amazon somava aprovadas. Um consolidado multicanal que soma
"aprovadas" de um canal com "aprovadas + canceladas" de outro **não significa nada**.

## Decisão

```
FATURAMENTO = vendas APROVADAS, valor do produto
              SEM canceladas · SEM frete do comprador · SEM dedução de tarifas
              por DATA DO PEDIDO
```

Canonicamente: `status IN ('paid','shipped','delivered')`, somando `gross`.
Vale **igual em Amazon, Mercado Livre, Shopee e TikTok**.

### O que fica de fora, e onde cada coisa aparece

| Item | Por quê | Onde vive |
|---|---|---|
| Canceladas | não é venda | cartão próprio de cancelados |
| Frete do comprador | repasse de transporte, não receita | linha própria ("Frete do comprador") |
| Tarifas, comissão, imposto | são custo, não faturamento | cascata do "Financeiro conciliado" |
| Pendentes | sem valor confirmado pelo marketplace | contados à parte |

### Consequências assumidas (as duas incomodam, e são conscientes)

1. **O ML deixa de bater com o painel do ML.** A regra antiga existia para reproduzir
   "Vendas brutas" de lá, incluindo canceladas. Trocamos igualdade com o painel de um
   canal por **consistência entre canais** — que é o que um produto multicanal precisa.
2. **A Amazon fica abaixo do Seller Central.** Medido em 30 dias: **R$ 34.905** contra
   R$ 36.523,90. A diferença é frete do comprador (~R$ 1,1 mil) e pedidos pendentes
   (~R$ 490). Esperado, não erro.

📌 **Por isso o rótulo importa:** a tela diz **"Faturamento"**, nunca "Vendas brutas" —
esse termo pertence ao painel do marketplace e tem outra conta.

### Regra de tela que decorre disto

Número que **não** for esta definição precisa **declarar o que é**, no próprio bloco:

- "Financeiro conciliado" declara a cobertura (`X de Y pedidos conciliados`) — implementado
  em `8a85b4b`.
- `/amazon/monitor` soma **repasses por data de postagem**; precisa dizer isso — ⚠️
  **pendente**, é hoje a última divergência não explicada da conta.

## Alternativas consideradas

- **Manter cada canal batendo com seu marketplace**: rejeitado — o consolidado da central
  somaria critérios diferentes, e é justamente ele que responde "quanto a operação
  faturou".
- **Incluir frete do comprador** (bateria melhor com o Seller Central): rejeitado — inflaria
  o faturamento com dinheiro que atravessa a operação sem ser receita, e distorceria
  margem e ROI, que dividem por ele.
- **Incluir canceladas** (regra antiga do ML): rejeitado — venda cancelada não é
  faturamento; some no painel do ML por decisão deles.

## Consequências

- ➕ Um número, uma definição, comparável entre canais e somável no consolidado.
- ➕ Margem e ROI passam a dividir por uma base coerente.
- ➖ Duas quebras de expectativa contra os painéis dos marketplaces (acima) — mitigadas
  por rótulo honesto, não escondidas.
- ➖ Telas que ainda não seguem a definição precisam ser migradas: a central (usa Sales
  API ao vivo, o que também viola o ADR-017) e o monitor (base de postagem, precisa de
  rótulo).

Relacionado: [ADR-017](./ADR-017-orcamento-de-1s-e-leitura-agregada.md) ·
[ADR-001](./ADR-001-modelo-canonico.md) ·
[`../api-mercado-livre.md`](../api-mercado-livre.md)
