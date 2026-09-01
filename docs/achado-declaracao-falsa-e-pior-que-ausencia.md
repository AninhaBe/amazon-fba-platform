# Achado: declaração falsa é pior que ausência de declaração

**Data:** 01/09/2026 · **Onde:** dashboard do Mercado Livre · **Corrigido em:** `3e14274`

## O fato

O `sub` do card de **Margem** do ML afirmava, em texto fixo:

> *"sobre o faturamento"*

E não era. Lucro e margem saíam de `revenueProcessed` — o **apurado** —, enquanto
o card ao lado exibia `revenue30d`, o **faturamento**. A frase declarava uma base
que a conta não usava.

## Por que isso é pior que não ter frase nenhuma

**Não declarar deixa a pessoa desconfiar de dois números que não fecham** — foi
exatamente assim que a Ana achou o defeito da Amazon em 31/08/2026: viu lucro e
margem sobre R$ 748,56 ao lado de um Faturamento de R$ 1.068,37, e concluiu, com
razão, que a tela estava errada. A ausência de explicação preservou o instinto
dela, e o instinto achou o defeito.

**Declarar errado desliga a desconfiança.** A tela responde a pergunta antes de
ela ser feita, com a resposta errada. Quem lê "sobre o faturamento" para de
procurar: a incoerência que ela veria passa a ter uma justificativa oficial, e
some do radar.

É o mesmo mecanismo do comentário do `emVoo` em `prefetchDePeriodos.ts` (achado
no mesmo dia): o comentário afirmava uma invariante que o código não tinha, e por
isso ninguém foi conferir se as duas bocas realmente compartilhavam o controle.
**Texto que afirma o que o código não faz não é neutro — ele consome a atenção
que teria achado o defeito.**

## O que isso muda no critério

Toda frase explicativa que existe hoje na tela passa a ter de responder:

1. **ela é verdadeira sobre a conta que a tela realmente faz** — não sobre a que
   a gente pretendia fazer;
2. **ela morre sozinha quando deixa de ser necessária**, ou alguém vai ter de
   lembrar de apagá-la (e não vai);
3. **ela não é texto fixo quando descreve algo que varia.** Texto fixo sobre
   número variável é uma afirmação que só está certa por coincidência.

Frase explicativa não é decoração nem cortesia: ela **gasta** a desconfiança da
pessoa. Só vale a pena quando o que ela compra é maior do que o que ela gasta.

## O conserto, e por que ele não espera ninguém

A frase passou a sair de `declaracaoDeBase` — a peça compartilhada dos quatro
canais — em vez de ser escrita à mão:

- **enquanto o denominador for o apurado**, ela diz a verdade *com número*:
  *"sobre R$ 748,56 apurados de R$ 1.068,37 — 2 pedidos aguardando confirmação"*;
- **quando o backend trocar o denominador para o faturamento**, as bases
  coincidem, `declaracaoDeBase` devolve `null` e a frase **some sozinha**.

Ninguém precisa lembrar de voltar lá. É o oposto da dívida com prazo que depende
de memória — e a diferença entre uma correção que sobrevive e uma que dura até a
próxima pessoa esquecer.

## Efeito colateral: o teste exigia a mentira

`tests/aliquotaNaoBloqueia.test.mjs` casava literalmente
`comSemImposto("sobre o faturamento", semAliquota)`. Ou seja: **o teste exigia a
frase falsa**, e a suíte verde era a prova de que o defeito continuava lá.

O critério que resolveu, e que vale para toda guarda nessa situação: *o que este
teste existe para garantir?* Aqui, que a margem leve o rótulo "sem imposto"
quando não há alíquota. O texto da base era **incidental**. A asserção passou a
casar o envelope e não o recheio — nem afrouxada, nem fossilizada.

Foi a segunda guarda no mesmo dia a proteger o defeito que deveria reprovar (a
outra: `tiktokModulesFrontend.test.mjs` exigindo que o contrato *inventasse* uma
janela de 30 dias).

---

## O critério operacional (01/09/2026, depois da varredura)

A varredura das nove telas achou **duas** frases mentindo e absolveu todas as
outras. A distinção que separou umas das outras é a regra que faltava, e ela é
aplicável sem perguntar a ninguém:

> **Texto fixo está CERTO quando descreve a NATUREZA do número — que não varia.
> Está ERRADO quando descreve a JANELA, a BASE ou a COBERTURA — que variam.**

| frase | descreve | veredito |
|---|---|---|
| "comissões e taxas do canal" (Shopee) | a natureza da tarifa | ✅ fixa, e sempre verdadeira |
| "pagos, enviados ou entregues" (TikTok) | o que a contagem inclui | ✅ fixa |
| "após tarifa e frete" (ML) | a composição do número | ✅ fixa |
| "no período" (14 ocorrências) | a janela, **sem nomeá-la** | ✅ genérica de propósito |
| "Últimos 30 dias" (central) | a **janela**, nomeada | ❌ mentia com o seletor em Hoje |
| "sobre o faturamento" (ML) | a **base** | ❌ a conta saía do apurado |

O padrão "no período" merece nota: é uma frase que declara **sem afirmar qual**,
e por isso continua verdadeira quando o seletor muda. Quando a janela precisa
ser nomeada, o nome tem de vir do mesmo lugar que decide a busca — nunca de uma
string.

## O padrão a imitar

A melhor frase explicativa do produto hoje está na aba de Ads:

> *"Receita, tarifa e custo são do período selecionado — não da janela de
> atribuição do canal."*

Ela **compra mais desconfiança do que gasta**: existe para a vendedora não ler o
ACOS do canal contra os nossos totais, que é um erro que ela cometeria sozinha e
que nenhum número na tela denunciaria. Frase explicativa é um gasto — só vale
quando o que ela evita é maior do que a atenção que consome.

## Corolário: uma tela que funciona pode esconder três que não

O segundo defeito da varredura (`BriefingLead`) tinha guard escrito, correto e
inoperante em três das quatro telas — porque ele lia a URL, e só o TikTok
escreve o período lá. **O funcionamento numa tela mascarou a falha nas outras
três.**

Regra que fica: quando uma correção vale para os quatro canais, o teste cobre os
**quatro**, sempre — mesmo que pareça repetição. Foi a única tela que testava a
condição de verdade que manteve o defeito invisível por um mês.
