# Auditoria de empilhamento de avisos — quatro canais e a central

**Status:** cortes 1 e 2 aplicados; corte 3 dispensado (ver §6). · **Data:** 01/09/2026

## Por que agora

Em dois dias estas telas ganharam declaração de base, marca de estimativa (no
agregado e na linha), sinalização de custo não cadastrado, pendências por canal,
a mensagem do NEXO e as faixas de estado. **Cada um entrou certo, um de cada
vez, e ninguém olhou o conjunto.**

## 0. O nome do problema

**NÃO ERA EXCESSO DE INFORMAÇÃO. ERA A MESMA INFORMAÇÃO REPETIDA.** Nove a doze
marcas dizendo **três** coisas. Repetição ensina a varrer a faixa sem ler
nenhuma — e é por isso que o conserto **não tira informação**.

⚠️ **A condição que atravessa os três cortes: NADA DESAPARECE.** Os três sinais
continuam visíveis, uma vez cada, com número e link. O que sai é a repetição. Se
em algum ponto um corte fizer um sinal sumir de vez, o corte está errado — vira
o oposto do que ela pediu, que é apontar o que falta com número.

## 0.1. O critério que esta auditoria produziu

> **Hierarquia não é propriedade de cada peça; é do conjunto.**

A marca de estimativa foi desenhada para não competir com alarme — tinta
terciária, sem cor de aviso, colada ao número. Ela cumpre a regra e mesmo assim
sumia, porque acima dela havia faixas e nove "⚠". **Cada peça respeitou a regra
sozinha e o conjunto violou.**

É assim que se chega aqui fazendo tudo certo, um de cada vez. Por isso esta
auditoria **precisa acontecer de novo toda vez que uma tela ganhar mais de duas
peças novas**: nenhuma revisão de peça isolada consegue ver este defeito, por
construção.

## 0.2. A referência é a CENTRAL

**As telas de canal se alinham ao formato da central, e não o contrário.** A
Visão geral já estava certa: uma frase de alerta escolhida por prioridade, mais
a narração. **Quem for criar tela nova olha para lá.**

## 1. Inventário — o que pede atenção hoje

### Faixas (largura inteira, antes do conteúdo)

| peça | gatilho | onde |
|---|---|---|
| `ConnectionBroken` | conexão caída ou expirada | Amazon, ML, Shopee, TikTok |
| `AvisoDeSyncInterrompido` | sync parou no meio | TikTok |
| `EstadoDoSync` | sync rodando / atrasado | ML |
| `NexoDoDia` | narração do dia existe | os quatro |
| `BriefingLead` | janela = 30 dias e faturamento > 0 | os quatro |
| `SincronizacaoCompleta` | primeira carga terminou | os quatro |

### Dentro dos cartões

| peça | gatilho | quantos por tela |
|---|---|---|
| `declaracaoDeBase` (`sub`) | base do lucro ≠ faturamento | 1–2 |
| `MarcaDeEstimativa` (agregado) | há pedido com tarifa estimada | 1 |
| `MarcaDeEstimativa` (linha) | a linha tem tarifa estimada | **1 por pedido** |
| `SinaisDoResultado` | até **3** sinais, sem limite | ver §2 |
| pendência "Cadastrar alíquota" | alíquota ausente | 2 (CTA + rodapé) |
| `AindaConsolidando` / janela do canal | dia ainda muda | por canal, na aba de Ads |

### A central

Disciplinada, e serve de referência: **uma** frase de alerta, escolhida por
prioridade (`detectarAlerta`), mais a narração. Não empilha.

## 2. A medição que mais importa: o MESMO aviso, repetido

`sinaisDoResultado()` devolve **até 3** sinais (custo não cadastrado, tarifa não
postada, pedido não conciliado). `SinaisDoResultado` renderiza **todos**, sem
corte. E a lista é passada para **vários cartões da mesma faixa**:

| tela | pontos que renderizam a MESMA lista | marcas visíveis no pior caso |
|---|---|---|
| Mercado Livre | 3 (`Lucro`, `Margem`, painel de baixo) | **9** |
| Shopee | 4 (`Resultado`, `Margem`, e dois no fluxo) | **12** |
| Amazon | 1 | 3 |
| TikTok | 1 | 3 |

Nove a doze marcas "⚠" dizendo **três coisas**. Não é excesso de informação: é a
mesma informação três ou quatro vezes, o que é pior — treina a pessoa a varrer a
faixa inteira sem ler nenhuma.

## 3. O pior caso REAL (não teórico)

Conta da Ana, hoje, no dashboard do **Mercado Livre**, período "Hoje":

1. `ConnectionBroken` — faixa (as conexões Amazon estão com token revogado; o ML
   cai no mesmo caminho quando a autorização expira);
2. `EstadoDoSync` — faixa;
3. `NexoDoDia` — faixa com a narração;
4. `BriefingLead` — frase de abertura;
5. `SincronizacaoCompleta` — faixa;
6. `declaracaoDeBase` no `sub` da Margem — *"sobre R$ X apurados de R$ Y"*;
7. **9 marcas** de `SinaisDoResultado` (3 sinais × 3 cartões);
8. pendência "Cadastrar alíquota", duas vezes;
9. na tabela de pedidos: `MarcaDeEstimativa` **em cada linha estimada** — hoje,
   todo pedido do dia.

**Total antes do primeiro número: 5 faixas empilhadas.** Depois delas, 12
elementos pedindo atenção na faixa de KPIs. E a tabela abaixo marca cada linha.

⚠️ E note o que isso faz com a peça mais nova: a marca de estimativa foi
desenhada para **não** competir com alarme — tinta terciária, sem cor de aviso.
Ela cumpre a regra e mesmo assim desaparece, porque acima dela há cinco faixas e
nove "⚠". **A hierarquia não é propriedade de cada peça; é do conjunto.**

## 4. Hierarquia proposta — um de cada, no máximo

| categoria | o que é | quem entra hoje | regra |
|---|---|---|---|
| **ALARME** | pede ação dela, e ela pode agir agora | `ConnectionBroken`, custo não cadastrado, alíquota ausente | **1 por tela**, o de maior prioridade, com número e link |
| **INFORMAÇÃO** | muda como o número é lido, e não há o que fazer | `declaracaoDeBase`, `MarcaDeEstimativa`, tarifa não postada | **1 por número**, colada a ele — nunca em faixa |
| **PROGRESSO** | some sozinho | `SincronizacaoCompleta`, `EstadoDoSync`, `AvisoDeSyncInterrompido` | **1 por tela**, e some ao terminar |

Fora da hierarquia, por serem conteúdo e não aviso: `NexoDoDia` e `BriefingLead`
— são a leitura do dia, não um pedido de atenção. Mas ocupam o mesmo topo, e
entram na conta de quanto se atravessa antes do primeiro número.

### Os três cortes que a hierarquia implica

1. **`SinaisDoResultado` aparece UMA vez por tela**, não uma por cartão. Os
   sinais são do resultado, não de cada número — repeti-los não acrescenta
   informação nenhuma. (De 9–12 marcas para 3.)
2. **Alarme escolhido por prioridade, como a central já faz.** Conexão caída
   torna o resto irrelevante: sem dado, custo não cadastrado não é o problema
   dela.
3. **Progresso não divide espaço com progresso.** `EstadoDoSync` e
   `SincronizacaoCompleta` descrevem o mesmo eixo; duas faixas para isso é uma
   a mais.

## 5. O que eu NÃO proponho tocar

- a marca de estimativa **por linha** da tabela: ali ela qualifica *aquele*
  número e não tem substituto — a repetição é o ponto;
- a janela colada ao valor na aba de Ads: é a única defesa contra somar recortes
  diferentes;
- a central: já está no formato que as outras deveriam ter.

---

## 6. Depois dos cortes — e duas correções ao meu próprio inventário

### O que foi aplicado

- **Corte 1 (sinais uma vez por tela):** aplicado. ML de **3 pontos de render
  para 1**, Shopee de **4 para 1**. Amazon e TikTok já tinham 1.
- **Corte 2 (alarme por prioridade):** aplicado **na Amazon e no ML**.

### ⚠️ Correção 1: o corte 2 só faz sentido em duas telas, não em quatro

Na **Shopee e no TikTok a conexão caída é TAKEOVER** — ela substitui a tela
inteira (`return <ConnectionBroken/>`). Não há conteúdo embaixo, então não há o
que calar. Meu inventário disse "os quatro" sem verificar; aplicar a supressão
ali seria código que não muda nada.

### ⚠️ Correção 2: o corte 3 não tinha o que cortar

Eu listei `EstadoDoSync` e `SincronizacaoCompleta` como duas faixas de progresso
empilhadas no ML. **Não são:** `EstadoDoSync` está na view do **Monitor**, não no
dashboard. E no TikTok, `SincronizacaoCompleta` só age com `status === "complete"`
enquanto `AvisoDeSyncInterrompido` só aparece com erro de sync — **mutuamente
exclusivos por construção**.

O corte foi aprovado com base num erro meu de inventário. Implementá-lo seria
entregar código que não move número nenhum, então não foi implementado. A peça
`progressoQueAparece` fica como contrato para quando um terceiro estado de
progresso aparecer — hoje ela não tem dois candidatos para escolher.

### O pior caso REAL, antes e depois

Conta da Ana, dashboard do **Mercado Livre**, período "Hoje", conexão caída:

| | antes | depois |
|---|---|---|
| faixas antes do primeiro número | 4 | 4 |
| marcas "⚠" na faixa de KPIs | **9** | **0** (caladas pelo alarme) |
| marcas "⚠" com a conexão OK | **9** | **3** |
| declaração de base visível nos cartões | escondida pelos sinais | **visível** |

**O que ela atravessa antes do primeiro número continua sendo 4** —
`ConnectionBroken`, `NexoDoDia`, `BriefingLead`, `SincronizacaoCompleta`. Os
cortes não mexeram nisso, porque `NexoDoDia` e `BriefingLead` são conteúdo e não
aviso. Fica o número na mesa: **se 4 ainda for muito, decide-se sobre eles com
este número e não por impressão.**

### ⚠️ O EFEITO COLATERAL É O ARGUMENTO DA AUDITORIA INTEIRA

**O empilhamento não estava só poluindo: estava SUPRIMINDO INFORMAÇÃO.** E é o
pior tipo de supressão — a que acontece exatamente no caso em que a informação é
necessária.

O `sub` do cartão era `sinais.length > 0 ? <SinaisDoResultado/> : declaração`. A
declaração de base **só aparecia quando não havia sinal nenhum**. Ou seja: a peça
que existe para impedir a leitura *"o lucro não sai do faturamento, logo está
errado"* estava escondida justamente nas contas **com pendência** — as que mais
precisam dela.

Nenhuma revisão de peça isolada acharia isso. A declaração está correta; os
sinais estão corretos; o `sub` que os multiplexa é que troca um pelo outro. **É
por isso que se audita o conjunto, e não a peça.**

### O efeito colateral que não estava no plano

Tirar os sinais dos cartões **devolveu a declaração de base**. O `sub` era
`sinais.length > 0 ? <SinaisDoResultado/> : declaração` — ou seja, a declaração
só aparecia quando não havia sinal nenhum. A peça que existe para impedir a
leitura *"o lucro não sai do faturamento, logo está errado"* estava sendo
escondida justamente nas contas com pendência, que são as que mais precisam
dela.
