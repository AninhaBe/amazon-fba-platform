# Amazon no esqueleto do ML (v3) — leva de 12/09/2026

**Ordem da dona do produto, verbatim:** *"cara, e replicar a mesma estrutura do
mercado livre na amazon"*. A página inteira, não um acréscimo.

Este doc é o **artefato de substituição** da leva: o que entrou, o que saiu, o que
saiu **de propósito e é reversível**, e onde cada garantia que mudou de casa passou
a ser cobrada. Existe porque a v288 do ML somou a tela nova à antiga em vez de
substituir, e a lição de catálogo de lá é: *frente de substituição fecha com "o que
isto substitui ainda está na página?", medido.*

## A tela agora, na ordem

| # | Bloco | Peça |
|---|---|---|
| 1 | Faixa do período (7 colunas + Margem) | `FaixaDoPeriodoV3`, dentro de `PainelV3` |
| 2 | Top 8 produtos · Ritmo dos últimos 7 dias (lado a lado) | `PainelV3` |
| 3 | O que falta para o número fechar | `PainelV3` |
| 4 | Pedidos a revisar | `OrderProfitabilityTableV3` |

Depois deles seguem os blocos que são **da Amazon** e não têm equivalente no ML —
eles não entraram nem saíram nesta leva: saldo na Amazon, estoque crítico, pedidos
recentes, anúncios por produto (agora com ACOS/TACOS/ROI) e os atalhos do mobile.

É a **mesma peça** que o ML monta, não uma cópia: `PainelV3` + `FaixaDoPeriodoV3`.
O que a Amazon tem de próprio entra como **dado** — a 8ª coluna (Margem), a marca
de tarifa estimada (ADR-027), o Ads que entra no lucro (decisão dela de 25/08, que
no ML **não** vale) e o dia que fecha no vermelho.

## O que saiu da tela

As quatro primeiras saíram porque a ordem as nomeou. Cada uma tem quem cobre o que
ela garantia:

| Saiu | O que garantia | Quem garante agora |
|---|---|---|
| Abertura com a frase solta (`BriefingLead`) | narração do período + pendências | pendências no cartão "O que falta"; a frase não tem substituto — `NexoDoDia` é a leitura do DIA, sem período |
| Tira "Pedidos feitos / Vendas / Unidades / Ticket médio / ROI" | indicadores complementares | faixa do período (valor), ritmo (Pedidos e Unidades por dia), bloco de Anúncios (ACOS/TACOS/ROI) |
| "Evolução das vendas" (gráfico diário + legenda) | leitura temporal | Ritmo dos últimos 7 dias, com lucro por dia |
| Rosquinha "Repasses, taxas e lucro" + cascata escrita | como o faturamento vira lucro, fechando no universo conciliado (ADR-028) | a faixa, que tem base própria (`baseDoLucro`) — e agora é o **único** bloco de números da tela, então não há dois universos para misturar |

E saiu uma duplicação que a leva criou e eu removi no mesmo dia: o
`TopProductsRanking` antigo ficou alguns minutos **abaixo** do Top 8 do painel —
dois rankings do mesmo período, um com contribuição e outro sem. É exatamente a
v288 em miniatura, e está guardado em `tests/amazonNoEsqueletoDoML.test.mjs`.

## Removidos de propósito — reversíveis, com o preço de cada volta

Nenhum destes foi decisão de produto minha; são consequência da ordem de replicar
o ML, que **não tem** nenhum deles. Ficam aqui para ela vetar barato:

| O que | Custo de devolver | O que já está pronto |
|---|---|---|
| **Ticket médio** | uma linha de cálculo + uma coluna/cartão | `nomesQueNaoMentem` e `ticketMesmaBase` já cobram a forma certa se ele voltar (numerador e denominador no mesmo universo) |
| **Canceladas (contagem)** | uma linha derivada no render | o dado continua entrando no cache do período (`next.canceladas`, do campo `cancelled` da rota); `amazonCacheDoPeriodo` explica que a fatia voltou a ser exigida quando tiver leitor |
| **Cupom resgatado** (com a ressalva "pode haver mais") | um cartão | `declaracaoNaFaceNaoNoTooltip` exige que a ressalva volte **na face**, nunca no "i" |
| **Vendas (com canceladas)** | um cartão | `aPaginaInteiraFecha` exige que, se a contagem voltar, o rótulo diga que inclui canceladas — o defeito original era o NOME |
| **Seta de tendência do faturamento** | uma linha no share da coluna | `getRevenueTrend` continua exportado em `Metric` |
| **Painel de repasses** (rosquinha + cascata) | o bloco inteiro | `painelDoConciliadoDaAmazon` virou guarda de volta-inteira: os **dois** consumidores voltam juntos, ou nenhum |

📌 **Para o backend:** `composicaoDoConciliado` continua sendo produzida e enviada
no payload, e hoje **nenhuma tela a lê**. Não foi removida de propósito — é ela que
faz o painel de repasses voltar em uma linha.

## O diff de números: mudou pixel, não valor

O critério de aceite desta família de levas é *"não quebrar os dados que estão
sendo disponibilizados hoje para os admins"*. Aqui ele é atendido **por
construção**, não por conferência manual:

- a faixa não recalcula nada. `entradaDaFaixaDosCards(cards, …)` lê o campo `raw`
  de cada cartão que a tela já exibia, então cada coluna mostra **literalmente** o
  número do cartão. Conferido por comportamento em `lucroUnicoNaTela`: o lucro da
  coluna é, por igualdade exata, o lucro que `amazonFinancialCards` devolve;
- os números que **saíram** não mudaram de valor — saíram de cena. Estão na tabela
  acima, um por um;
- o ritmo preserva `null`: dia sem apuração fica só com o contorno e não entra na
  média. `?? 0` ali desenharia uma coluna rente à base, e numa série temporal zero
  não parece ausência — parece notícia ruim.

## Guardas: as que nasceram e as 24 que mudaram de intenção

A leva criou `tests/amazonNoEsqueletoDoML.test.mjs` (o par entrou/saiu de cada
bloco) e **todas as suas asserções foram vistas vermelhas** — nove quebras, uma a
uma, cada uma desfeita depois.

E 24 asserções em 14 arquivos ficaram vermelhas porque guardavam blocos que saíram.
Nenhuma foi apagada: cada uma virou ou **condicional** (se o bloco voltar, volta na
forma certa) ou **comportamento** (chamar a função e conferir a saída, que é mais
forte que casar texto do JSX). Cada arquivo registra no próprio corpo a intenção
anterior e a data.

⚠️ **Uma das 24 era decorativa, e só apareceu ao rodar a quebra.** Em
`lucroUnicoNaTela`, a proibição de refazer a subtração do anúncio era
`/estimatedProfit\s*-\s*\(?\s*(profit\??\.)?ads/` — exige os dois nomes quase
colados. A forma natural de reintroduzir o defeito nesta tela é
`(profit?.estimatedProfit ?? 0) - (profit?.ads ?? 0)`, e os `?? 0` bastavam para a
guarda **não** casar: ela ficou verde com o defeito dentro. Consertada
normalizando o fonte antes de procurar (tira string, template, espaço, parênteses e
`?? 0`) e re-quebrada até ficar vermelha.

## O que fica aberto

- **Bloco de repasse do período** ("A Amazon vai descontar R$ X no próximo
  fechamento", `cobrancasFechadas`) — adição pedida por ela, ainda não construída.
  `null` continua não sendo zero.
- **Shopee e TikTok** — as próximas levas. Replicar é reimplementar com a API de
  cada canal: o que aquele canal entrega, e quando, decide a forma.
