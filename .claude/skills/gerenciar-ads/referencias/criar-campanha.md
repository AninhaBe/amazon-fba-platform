# Criar campanha

## A estrutura padrão desta conta

Por produto: **1 automática + 1 manual**, e a manual com **dois grupos de anúncios** — um
em correspondência **exata** e outro com as **mesmas palavras** em **frase**.

```
PRODUTO
  ├── Auto - <produto>          segmentação automática, lance baixo
  └── Manual - <produto>        ├── Exata - <produto>
                                └── Frase - <produto>   (mesmas palavras)
```

**Por que assim:** a automática **descobre** termos que você não imaginou; a manual
**controla** o lance dos termos que já provaram valer. Exata trava o termo exato; Frase
captura as variações em volta dele.

⚠️ **Exata e Frase moram na mesma campanha e DIVIDEM o orçamento.** Não é erro — é o
desenho recomendado — mas muda como ler o número de cada grupo.

⚠️ **A automática precisa das negativas exatas das palavras que estão na manual**, senão
as duas leiloam entre si e encarecem o próprio clique. → [`colheita.md`](colheita.md)

## Antes de criar

1. **Estoque vendável existe?** Oferta sem estoque não é a Oferta em destaque, e sem ela
   o Sponsored Products **não veicula**. Campanha ligada sem estoque não entrega nada.
2. **Título ≤75 caracteres e capa com fundo branco sem texto?** Anúncio suprimido não
   aparece nem organicamente. Corrigir **antes** de pagar por clique.
3. **A margem aguenta?** Rodar `node scripts/lance.mjs` com o preço e o custo reais antes
   de escolher lance. Produto com margem apertada não deve ser anunciado ainda — nesta
   conta o `kitprote-32` ficou de fora por isso (13,6% de margem bruta que a comissão de
   15% já consome).
4. **Não anunciar tudo de uma vez.** Começar pelo de melhor margem e maior estoque.

## 🪤 As armadilhas da tela de criação

Todas observadas nesta conta. **Todos os defaults favorecem gasto, não aprendizado.**

| # | Armadilha | O que fazer |
|---|---|---|
| 1 | **O grupo novo nasce com lance padrão R$ 2,75**, mesmo quando todas as palavras têm lance próprio | Corrigir na lista de grupos **logo após criar**. Só morde se um alvo sem lance entrar depois — mas nasce errado em **todo** grupo criado por essa tela |
| 2 | **Campanha nova nasce em "lances dinâmicos — aumento e redução"**, não herda a configuração das outras | Trocar para **somente redução** antes de publicar |
| 3 | **O lance sugerido muda depois de adicionar o produto** — antes mostra um genérico (R$ 0,98), com o produto dentro a sugestão real era R$ 0,33 | **Nunca aceitar o número que aparece antes de o produto entrar** |
| 4 | **Sem sugestão, o padrão é R$ 2,75** | Calcular pela margem, não aceitar |
| 5 | **Frase pode ser mais barata que exata** — "ponteira de cadeira" sugeria R$ 1,60 em exata e R$ 0,33 em frase | Ler a sugestão de **cada** correspondência; não presumir a ordem |
| 6 | **O ASIN pai não é anunciável** — aparece como `Ineligible` | Sponsored Products anuncia **ofertas**, ou seja, os filhos. Adicionar os filhos no mesmo grupo; o relatório sai por ASIN filho |
| 7 | **O fluxo "campanhas prontas para lançar"** (`/cb/sp/presets`) pré-seleciona todos os ASINs com orçamento e lance escolhidos pela Amazon | **Não usar** |
| 8 | **A tela sugere R$ 40/dia de orçamento** e diz que o mínimo é R$ 50 | O mínimo real é o equivalente a **US$ 1**. A recomendação não é o mínimo |

📌 **Onde a sugestão passar de ~R$ 1,00**, baixar para o **piso da faixa que a própria
Amazon exibe** (ex.: R$ 1,89 → R$ 1,14), **não** para um número arbitrário: fora da faixa o
anúncio simplesmente não entra no leilão. Foi exatamente esse erro que custou o dia 13/08.

## Configuração padrão a aplicar

| Item | Valor | Por quê |
|---|---|---|
| Estratégia de lance | **Dinâmico — somente redução** | Produto novo, sem histórico para a Amazon prever bem |
| Ajuste de topo da pesquisa | **0%** | Compra posição, não aprendizado. Última alavanca a mexer |
| Ajuste por canal | **0%** | Idem |
| Data de término | **sem data** | — |
| Correspondência na manual | **exata + frase**, nunca ampla | `clip`/`clipe` puxam `nail clippers` e `hair clippers` no autocomplete — em ampla isso vaza |

## Depois de criar

1. **Conferir o lance padrão do grupo** (armadilha nº 1).
2. **Conferir a estratégia de lance** (armadilha nº 2).
3. **Negativar em exata, na automática, todas as palavras que entraram na manual.**
4. **Registrar em `../monitorar-ads/SKILL.md`**: data, IDs, lances e orçamento.
5. **Conferir 2 a 4 vezes na primeira semana** — campanha nova é a exceção à regra de
   ajustar lance só semanalmente, porque o objetivo é achar rápido o lance que destrava
   impressão.
6. **Depois disso, deixar rodar 2–3 semanas sem mexer.** É coleta de dados, não
   performance.
