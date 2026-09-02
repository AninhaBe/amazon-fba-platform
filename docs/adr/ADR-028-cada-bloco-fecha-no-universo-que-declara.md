# ADR-028 — Cada bloco exibe o resíduo do universo que declara

**Status:** aceito em 02/09/2026. **Emenda à [ADR-025](ADR-025-anuncio-entra-na-composicao.md).**

## Contexto

Em 01–02/09/2026 a dona do produto encontrou **cinco** defeitos de coerência no
dashboard, em dois dias, um por vez — cada um num print. Todos da mesma família:

1. margem de **91,7%** afirmada sobre 1 pedido, ao lado de um faturamento de 31;
2. lucro de **R$ 743,76** sobre faturamento de R$ 824,64 — 90% —, porque a receita
   dos 31 pedidos era descontada do custo e da tarifa de um;
3. imposto incidindo sobre `processedRevenue` enquanto o lucro partia do
   faturamento, na Shopee **e** no ML;
4. widget da Shopee com centro na receita paga e fatias somando o universo total,
   estourando o próprio todo em R$ 1.636,99 sob um selo de "composição completa";
5. painel da Amazon com centro de **R$ 12,89** e "Lucro estimado" de R$ 731,27 —
   que é o lucro do período, cuja conta fecha em outro card. Margem: **5673%**.

Nenhum dos números estava errado sozinho. O que era falso, sempre, é a
**afirmação de que eles pertencem à mesma conta**.

A spec dela de 02/09 fecha a questão em uma linha:

> *"Faturamento − Custo dos produtos − Taxas totais − Ads = Lucro. A conta tem
> que fechar exatamente com os números exibidos nos cards, sem valor oculto."*

## Decisão

**Todo bloco da tela exibe o resíduo do universo que ele declara.**

1. **Um bloco, um universo.** Se o bloco diz no título ou no subtítulo de que
   recorte fala, todos os seus números vêm desse recorte — centro, fatias, lista,
   resultado e margem.
2. **O resultado é o resíduo, nunca importado.** `resultado = receita do bloco −
   os custos do bloco`. Um bloco jamais exibe o resultado calculado por outro.
3. **A margem sai sobre o próprio centro.** Dividir o resultado de um universo
   pela receita de outro é o que produziu os 5673%.
4. **Nomes distintos para números de universos distintos.** O painel de repasses
   mostra **"Resultado dos repasses"**; o card mostra **"Lucro"**. Os dois são
   legítimos e diferentes, e é o nome que impede a confusão.
5. **A página inteira fecha por equações**, uma por universo, e essas equações
   são um teste — não uma conferência manual.

### O que isto muda na ADR-025

A ADR-025 mandou pôr o anúncio na composição do painel porque a tela exibia dois
números chamados "lucro" com sinais opostos. **O propósito continua valendo; a
letra muda.**

Anúncio é custo de **período** — a Ads API entrega por dia, nunca por pedido — e
não pertence nem ao universo total nem ao conciliado. Somá-lo ao painel do
conciliado quebra a igualdade `centro = fatias`, que é justamente a garantia que
esta ADR estabelece.

**A saída não é esconder a diferença: é nomear.** O anúncio sai do painel do
conciliado e continua no lucro do período, que é o dos cards. Dois nomes, dois
números, nenhuma ambiguidade — que é o que a ADR-025 queria.

## Consequências

- Cada produtor expõe uma **composição por universo** (`composicaoDaReceitaPaga`
  na Shopee, `composicaoDoConciliado` na Amazon), somada a partir das **mesmas
  linhas** que formam o centro. Coerência por construção, não por conferência.
- **Todo consumidor do bloco lê a mesma composição.** Um painel costuma ter
  dois — a rosquinha e a lista de fluxo —, e corrigir um só foi exatamente o erro
  que a vendedora reprovou em 02/09. **Dois consumidores, duas guardas.**
- As guardas são **positivas**: exigem o nome certo nas linhas do bloco. Proibir
  a string não distingue o card legítimo (que fala do universo total de
  propósito) da linha errada, quando os dois vivem no mesmo arquivo.
- `docs/auditoria-dashboard-amazon.md` mantém a tabela `número → fonte →
  universo → equação`, gerada por `scripts/auditar-dashboard-amazon.mjs`.

## Alternativas descartadas

- **Forçar tudo ao universo total.** Apagaria o painel de repasses, que responde
  uma pergunta real ("o que a Amazon já me pagou e o que sobrou disso").
- **Esconder o painel enquanto os universos divergem.** É a supressão que já se
  provou perigosa: suprimir a margem em 02/09 escondeu a sétima forma do mesmo
  defeito por meio dia. Número visível é instrumento de detecção.
- **Recalcular tudo em cada bloco.** Duas cópias da conta é como uma fica para
  trás — foi o defeito que a ADR-025 nasceu para matar.
