# Medição: a varredura de frases NÃO vira guarda por gatilho de texto

**Data:** 01/09/2026 · **Pedido:** transformar em guarda a varredura que achou
duas frases mentindo e uma bomba-relógio.
**Resultado: medi e não dá** — na forma pedida. O que dá é menor e está no fim.

## O critério que se queria automatizar

> Texto fixo está **certo** quando descreve a NATUREZA do número, e **errado**
> quando descreve JANELA, BASE ou COBERTURA.

O critério é bom para uma pessoa lendo a tela. O problema é que "natureza" e
"cobertura" são a **mesma palavra** em posições diferentes, e a posição não
distingue: `label="Receita conciliada"` nomeia a natureza (certo) e
`sub="sobre a receita"` nomeia a base (frágil) — as duas são a mesma string em
um atributo de rótulo.

## Os três recortes, medidos

| recorte | achados | mentiras vivas | exceções nomeadas que precisaria |
|---|---:|---:|---:|
| gatilhos em qualquer literal/texto de `.tsx` | **84** | **0** | ~80 |
| gatilhos só em posição de anotação (`sub=`, `note:`, `hint=`) | 2 | 0 | 2 |
| só vocabulário de BASE, dentro do `sub` extraído por contagem de chaves | 3 | 0 | 1 |

Os 84 se distribuem assim: 23 rótulos que nomeiam a **natureza** do número
("Receita conciliada", "Resultado processado"), 15 **opções de seletor de
período** ("Últimos 30 dias"), 7 **estados de uma linha** ("Tarifas não
postadas"), 6 de prosa, 5 fora do produto (`lab/`, `landing/`, `admin/`), 4
genéricos por desenho ("no período selecionado", que é verdadeiro para qualquer
janela) e 2 de **janela fixa na consulta** — o falso positivo que já tinha sido
nomeado: `"Vendidas (30 dias)"` está certo porque aquela janela é fixa no SQL.

O resto são títulos de gráfico ("Evolução do faturamento", "Concentração da
receita"), que citam a base e não anotam número nenhum.

**Falso positivo ≈ 95%.** Uma guarda com oitenta exceções não é guarda: é uma
lista de arquivos que alguém desliga na primeira semana.

## O que mata a versão estreita, que parecia salvável

A saída legítima exigida — *"se a frase é derivada do dado, ela passa"* — **não é
decidível pelo fonte.** O caso real:

```tsx
sub={costsIncomplete ? "aguardando todos os custos" : "sobre a receita"}
```

Tem ternário, então qualquer detector de "derivado" diz **derivado**. Mas a
condição é sobre o **custo**, não sobre a **base**: o ramo que declara a base é
uma constante. É exatamente a bomba-relógio que a guarda existiria para pegar, e
ela passa pela porta da frente.

E o teste de recall fecha o caso: **a guarda não teria pego nenhum dos dois casos
reais achados hoje.** O do `ShopeeModulePage` era um ternário (`cond ? sinais :
"sobre a receita processada"`), e o do `BriefingLead` **não era string nenhuma** —
era a janela vindo da URL em vez do hook.

Recall medido nos casos conhecidos: **0 de 2.**

## O que DÁ, e é pequeno

Não uma guarda sobre o texto — uma guarda sobre **de onde o texto vem**:

> **A frase que nomeia a base de um número só pode sair de `declaracaoDeBase()`.**
> O vocabulário de base ("sobre o faturamento", "sobre a receita", "% do
> faturamento") não aparece como literal em nenhuma tela.

Isso é verificável com precisão alta porque não julga o texto: julga a
**procedência** dele. Hoje o ML, a Shopee e o `ShopeeWorkspace` já passam pela
peça. Faltam três sítios:

| onde | estado |
|---|---|
| `monitor/page.tsx:333` | **constante** — `"sobre a receita"`. Verdadeira hoje (`marginPct = estimatedProfit / finance.revenue`, e o cartão ao lado é essa mesma receita). Bomba, não mentira. |
| `page.tsx:329` | derivação **à mão** — o ramo está certo, mas é a mesma lógica da peça, escrita de novo |
| `ShopeeModulePage.tsx:166` | derivação **à mão**, escrita hoje |

Roteando os três pela peça, a guarda nasce com **zero exceções permanentes** — e
aí ela é a asserção de comportamento que a família da forma pede
(`docs/achado-guarda-que-depende-da-forma.md`): a peça é função pura, testável
chamando e conferindo a saída, sem casar fonte nenhum.

**Isso é refatoração de três telas e não estava aprovado.** Fica proposto.

## A regra que sobra, e não precisa de guarda

Quando o número muda de base, quem muda a frase é **quem muda o número** — o
mesmo commit. É a mesma regra da migration que move dado: *"quem lê isso agora?"*
antes do apply. Não é vigilância automática; é ordem de trabalho.
