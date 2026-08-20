# ADR-020: Bruto e conciliado são perguntas diferentes — cada tela declara qual responde

- **Status:** Aceito
- **Data:** 2026-08-20 (revisado no mesmo dia, ver "Correção de rumo")

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

**A causa raiz não era bug de cálculo: era ausência de definição declarada.** Cada tela
nasceu com a sua, nenhuma dizia qual, e o produto não tinha regra para arbitrar.

### Correção de rumo (o primeiro texto deste ADR estava errado)

A primeira versão decidiu **uma** definição para tudo — "só aprovadas, sem frete, sem
canceladas" — e chegou a mudar a regra do Mercado Livre, que incluía canceladas para
reproduzir o painel deles.

A dona corrigiu, e o argumento dela é melhor:

> *"no Meli aparece o faturamento bruto mas também dados de cancelados; nos dados de
> conciliados, as pessoas não têm essa visão."*

Ou seja: **não são duas versões do mesmo número, são duas perguntas.** Uniformizar
destruía a mais útil das duas.

## Decisão

O produto expõe **dois** indicadores, cada um com definição fixa e **rótulo explícito**:

### 1. Faturamento BRUTO — espelha o painel do marketplace

Serve para a pessoa **conferir** contra a tela que ela já conhece. Segue a semântica de
cada canal, porque é ela que o vendedor vê:

| Canal | Regra | Observação |
|---|---|---|
| **Mercado Livre** | aprovadas **+ canceladas**, só produto, sem frete | validada ao centavo (Mercado Turbo, conta 648425194) |
| **Amazon** | não canceladas (inclui pendentes), produto **+ frete do comprador** | espelha "Vendas brutas" do Seller Central: R$ 36.033 canônico × R$ 36.523 da Sales API |

Canceladas aparecem **também em cartão próprio** — somadas no bruto, visíveis à parte.

### 2. Faturamento CONCILIADO — a visão que o marketplace não dá

```
CONCILIADO = vendas APROVADAS (paid/shipped/delivered), valor do produto
             sem canceladas · sem frete do comprador · sem dedução de tarifas
```

Igual em **todos os canais**. É dinheiro que existe de verdade, e é o insumo de margem,
ROI e lucro — que precisam de base coerente entre canais para o consolidado somar.

### A regra de tela que decorre disto

**Todo número de faturamento declara qual dos dois é, no próprio bloco.** Foi a ausência
disso — não os números — que produziu o problema:

- ✅ "Financeiro conciliado" declara a cobertura (`X de Y pedidos conciliados`) — `8a85b4b`
- ✅ Cascata do conciliado soma receita e tarifas do **mesmo conjunto** — `b092d7b`
- ⚠️ **Pendente:** `/amazon/monitor` soma repasses por **data de postagem** (pergunta
  legítima e terceira: "quanto a Amazon me pagou nesta janela") e não diz isso na tela.
- ⚠️ **Pendente:** a central ainda usa a Sales API ao vivo — além de outra base, viola o
  ADR-017 (API externa no caminho interativo).

📌 **Nunca chamar o conciliado de "Vendas brutas"** e vice-versa: os termos pertencem aos
painéis dos marketplaces e têm conta própria.

## Alternativas consideradas

- **Uma definição única para tudo** (primeira versão deste ADR): rejeitada pela dona —
  destrói a conferência contra o painel do marketplace, que é o que dá confiança no
  número, e o bruto do ML deixaria de bater ao centavo sem ganho real.
- **Só mostrar o conciliado**: rejeitado — durante a convergência do sync o conciliado é
  subconjunto e some parte da operação; sem o bruto ao lado, a tela parece estar perdendo
  vendas.
- **Só mostrar o bruto**: rejeitado — é o número que o marketplace já dá; o produto não
  acrescentaria nada.

## Consequências

- ➕ Cada número responde uma pergunta clara, e a pessoa consegue conferir o bruto contra o
  marketplace.
- ➕ Margem, ROI e lucro passam a sair de uma base coerente entre canais (o conciliado).
- ➖ Duas linhas de "faturamento" na mesma tela exigem **rótulo bom** — sem isso o problema
  de 20/08 volta. O rótulo é requisito, não enfeite.
- ➖ Bruto e conciliado divergem bastante enquanto o sync converge; mitigado pela faixa de
  cobertura.

Relacionado: [ADR-017](./ADR-017-orcamento-de-1s-e-leitura-agregada.md) ·
[ADR-001](./ADR-001-modelo-canonico.md) ·
[`../api-mercado-livre.md`](../api-mercado-livre.md)
