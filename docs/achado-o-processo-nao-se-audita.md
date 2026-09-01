# O número que o processo produz não audita o processo

**Achado em 01/09/2026, no backfill de decomposição da tarifa da Amazon.**

Três defeitos meus, num script só, no mesmo dia. Os três passaram **limpos** pelo
relatório da própria execução — que dizia "concluído", "faltam 1", "sem
decomposição: 0" — e os três caíram na **primeira conferência contra a fonte**.

| defeito | o que o relatório dizia | o que a fonte dizia |
|---|---|---|
| fatiar por data do **pedido**, quando a Transactions API responde por data de **lançamento** | `28 de 73 sem decomposição` — lido como "esses não têm mesmo" | 38% dos pedidos ficariam colados para sempre |
| escrever dentro do laço e tirar o pedido da lista no **primeiro** acerto | `3.113 decompostos, faltam 1` | a soma do banco ficou **R$ 965,42 abaixo** da soma da API |
| exigir `JOIN` com a tabela de tarifa para eleger o alvo | `zero divergentes` | 74 pedidos **sem linha nenhuma**, R$ 817,52 |

Depois dos três consertos: **R$ 15.931,93 na API e R$ 15.931,93 no banco**, em
1.605 pedidos, zero ausentes e zero divergentes.

## O padrão, que é o que interessa

Cada um dos três era **um recorte que parecia natural** — fatiar pela data do
pedido, sair do laço no primeiro acerto, exigir o join. E **cada recorte
escondia exatamente aquilo que ele cortava**: o relatório contava o que estava
dentro do recorte, e o que ficou de fora não aparecia como falta, aparecia como
inexistente.

> **O relatório mede o que o processo FEZ. Só a fonte mede o que ele DEVIA ter
> feito.**

Por isso o contador do próprio script nunca serve de prova. Ele é feito da mesma
premissa que o script — se a premissa está errada, os dois erram juntos, e erram
com confiança.

## Na prática

- **Todo backfill, migração de dado ou reprocessamento termina com uma
  conferência contra a fonte**, não com o resumo da execução. A conferência
  precisa ser escrita separada, idealmente por outro caminho de leitura.
- **Compare somas, e depois compare item a item.** A soma bate por acaso mais
  vezes do que parece; foi a contagem de "pedidos sem linha" e "pedidos
  divergentes" que separou *ausência* de *valor errado* — duas causas com
  consertos diferentes que a soma agregava num número só.
- **Desconfie de zero.** `sem decomposição: 0` e `divergentes: 0` foram os dois
  números que mais atrasaram o diagnóstico, porque zero se lê como "nada a
  fazer" e aqui significava "nada que eu tenha olhado".
- **Diga o que o relatório NÃO cobre.** Se o script conta só o que ele tocou, a
  linha final tem que dizer isso com todas as letras.
- **Número implausível é para ser investigado, não reportado** — e este é o
  gêmeo de "desconfie de zero". Uma medição de comissão por ASIN devolveu **18%
  a 45%**; comissão de 45% na Amazon não existe, e a implausibilidade sozinha
  deveria ter parado o relato antes da conferência. Conferindo, a receita batia
  ao centavo contra o `gross` do pedido e o defeito era outro: duas procedências
  misturadas no mesmo agregado (12,38% na parte já decomposta, 43,12% na parte
  ainda colada).

  > O número que parece **demais** e o que parece **de menos** merecem a mesma
  > desconfiança. Zero se lê como "nada a fazer"; um número alto se lê como
  > "achado importante" — e os dois são, com a mesma frequência, a consulta
  > errada.

---

# O corolário: conserto que trata o sintoma esconde a próxima forma

**Mesmo dia, e é o fecho da família das sete formas** — o defeito
"numerador de um universo, subtraendo de outro", que apareceu sete vezes em três
dias e sempre com cara nova.

De manhã, a **sexta forma**: a tela exibia Faturamento de 31 pedidos e afirmava
*"Margem 91,7%"* calculada sobre 1. O conserto foi **suprimir a margem** quando a
base cobre a minoria, dizendo o que falta com número. Certo, e aprovado.

À tarde, a **sétima**: a mesma tela mostrava **Lucro R$ 743,76 sobre faturamento
de R$ 824,64** — noventa por cento —, porque a receita cheia dos 31 pedidos era
descontada do custo e da tarifa de **um**. A vendedora viu antes de nós.

⚠️ **E a supressão da margem foi o que escondeu.** Com o percentual na tela,
"90% de margem" salta aos olhos de qualquer um. Sem ele, sobra um número de
lucro sozinho, sem escala, que não denuncia nada.

> **Número visível não é só informação — é instrumento de detecção.** Ao
> suprimir um número porque ele está errado, você também desliga o alarme que
> apontaria a próxima causa.

## Na prática

- Ao suprimir um número, pergunte **o que ele denunciava** além de si mesmo, e
  garanta que a denúncia continue existindo por outro meio.
- Supressão é **estado transitório**, não desenho: a margem volta a ser afirmada
  assim que a base cobrir a maioria, e é por isso que a regra é dinâmica em vez
  de um `null` fixo.
- E o conserto de causa da família inteira é estrutural: **um valor governando
  os dois lados**. As sete formas nasceram sempre de dois lugares editados em
  momentos diferentes — a base num commit, o custo noutro. Amarrar os dois no
  mesmo parâmetro (`baseCobreTodosOsPedidos`) é o que torna impossível corrigir
  um e esquecer o outro; a guarda que prova isso é a que troca o flag
  compartilhado por um valor fixo em **um** dos lados e exige vermelho.
- **Condicione o filtro antigo, não o apague.** Consertar a sétima apagando o
  filtro ressuscitaria a quinta (base de R$ 12,89 contra custo de R$ 222,95,
  margem de −1692,4%). A prova exigida é nos **dois** modos, não no que você
  está consertando.
