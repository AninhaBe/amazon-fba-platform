# Duas mensagens do NEXO na mesma tela — diagnóstico

**Status:** medido, **nada corrigido**. A decisão de qual fica é do cérebro.
**Data:** 01/09/2026

## É possível hoje? Sim, e é reproduzível

**Não é o mesmo componente duas vezes. São DUAS peças diferentes**, e as duas
renderizam `NexoMensagem` — o mesmo avatar escuro, a mesma seta branca inline, e
o **mesmo rótulo de CTA**.

| | `NexoDoDia` | `BriefingLead` |
|---|---|---|
| o que busca | `GET /api/central/briefing?modo=resumo` | `POST /api/central/briefing` com o snapshot do canal |
| escopo | **multicanal** (rota sem escopo) | **o canal da tela** (`escopo="amazon"`, …) |
| CTA | "Ver briefing" → `/briefing` | "Ver briefing" → `/amazon/briefing`, `/mercado-livre/monitor`, … |
| onde | os quatro dashboards de canal | os quatro dashboards de canal |

Nos quatro arquivos as duas ficam **uma imediatamente abaixo da outra**
(`amazon/page.tsx:806` e `:807`; `MercadoLivreWorkspace:473` e `:476`;
`ShopeeWorkspace:773` e `:775`; `TikTokWorkspace:349` e `:358`).

> ⚠️ Os **dois** `<NexoDoDia />` que aparecem em cada arquivo NÃO são o
> empilhamento: estão em ramos de `return` diferentes (tela sem conta × tela com
> dado) e nunca coexistem. Verifiquei antes de afirmar.

## O estado exato que reproduz

Num dashboard de canal, ao mesmo tempo:

1. **período = 30 dias.** É a única janela em que a narração do `BriefingLead`
   sai (`janela === "days=30"`);
2. **faturamento > 0** no período;
3. **a narração diária do resumo já existe** no cache do servidor (chave do
   modelo configurada e o dia já gerado).

Então aparecem, uma sob a outra: a mensagem **multicanal** e a mensagem **do
canal**, com textos diferentes e o mesmo botão "Ver briefing" apontando para
lugares diferentes.

📌 **Isto era o estado PADRÃO até 31/08/2026**, quando o padrão da tela era 30
dias. Desde que o padrão virou "Hoje", só acontece quando a pessoa escolhe 30
dias — o que explica por que sumiu do caminho sem ninguém consertar nada, e por
que volta assim que ela troca o período.

## Por que isso é pior que uma faixa a mais

Não é ruído: são **duas vozes do produto dizendo coisas diferentes na mesma
tela**, com o mesmo rosto e o mesmo convite. A vendedora precisa decidir em qual
acreditar — e nada na tela diz que uma fala dos quatro canais e a outra só deste.
O CTA idêntico apontando para destinos diferentes fecha a armadilha: clicar no de
cima e no de baixo leva a lugares distintos sem nenhum sinal disso.

## As três saídas

**(a) Uma voz por tela — a do canal.** `NexoDoDia` sai dos dashboards de canal e
fica onde é a voz certa: a central, que é a tela multicanal. Numa tela de canal,
quem responde *"como está ESTE canal"* é a narração do canal.
*Custo:* quem só abre o canal deixa de ver a leitura multicanal ali.
*Ganho:* de 4 para **3** elementos antes do primeiro número, e some a colisão de
CTA.

**(b) Manter as duas, diferenciando.** A multicanal perde o tratamento de
`NexoMensagem` na tela de canal e vira uma linha comum, com rótulo próprio
("Nos quatro canais…"). *Continuam duas vozes* — só fica explícito qual é qual.

**(c) Fundir num bloco só**, canal primeiro, multicanal como segunda frase, um
CTA. Mais trabalho e mistura dois textos que foram gerados separadamente, com
janelas diferentes (o resumo é diário; a narração do canal é dos 30 dias) — o
que reabre o risco de rotular um recorte com o número de outro.

## Recomendação

**(a).** É a única que resolve a pergunta *"em qual eu acredito"* em vez de
explicá-la, e é coerente com o que a auditoria de empilhamento já concluiu: **as
telas de canal se alinham ao formato da central**, e a central é onde a voz
multicanal pertence.

**A decisão de qual fica não é minha** — as duas peças existem por desenho e
alguém escolheu pôr as duas ali.

---

## Achado próprio: a central gera o texto que ela mesma não mostra

`src/app/(app)/page.tsx` tem `narracao`, `narracaoCarregando` e o import de
`NexoMensagem` — e **não renderiza nenhum deles**. Parece sobra. **Não é.**

A faixa do NEXO saiu da Visão geral em **24/08/2026, a pedido dela**: a central é
tela de passagem, e a leitura do dia mora no dashboard de cada canal. O que ficou
na central é a **geração**: o `POST /api/central/briefing` manda o snapshot
multicanal, e é ele que faz o texto existir. `NexoDoDia`, nos quatro canais, só
**lê o ponteiro** que essa chamada escreveu.

> ⚠️ **Quem limpar aquilo achando que é código morto quebra a leitura do dia dos
> quatro canais de uma vez** — e o sintoma aparece longe dali, numa tela que
> ninguém tocou, como *"a mensagem do NEXO sumiu"*.

O aviso está escrito **ao lado do código**, não só aqui: doc não é lido por quem
está apagando uma linha que o editor marca como não usada.

## ⚠️ A recomendação mudou depois deste achado

A primeira versão deste documento recomendava **(a)**: tirar `NexoDoDia` das
telas de canal e devolver a voz multicanal à central. **Isso desfaria a decisão
dela de 24/08.** A informação estava a um comentário de distância, no arquivo que
eu só fui abrir depois.

**Quem chegou depois foi a narração do `BriefingLead`**, que passou a usar o
mesmo rosto (`NexoMensagem`) e o mesmo rótulo de CTA da voz que ela já tinha
mandado para lá. A peça nova é a do canal — e é ela que deve ceder.

**(a-1), a recomendação corrigida:** fica a multicanal; o `BriefingLead` deixa de
renderizar `NexoMensagem` e volta à frase calculada (`montarFrase`), que já é o
fallback dele hoje. Uma voz por tela, e é a que ela escolheu.

### O que ela perde, com as palavras (conta dela, ws `1803d1fe`, últimos 30 dias)

Amazon:

> **"51 vendas e R$ 777,46 nos últimos 30 dias."**
> *"Quanto sobrou ainda não dá para dizer — falta custo ou tarifa. O lucro fica
> em branco até fechar."*

Mercado Livre:

> **"45 vendas e R$ 2.035,95 nos últimos 30 dias."**
> *"Quanto sobrou ainda não dá para dizer — falta custo ou tarifa. O lucro fica
> em branco até fechar."*

E quando o lucro está fechado, a segunda linha some e a primeira vira
*"45 vendas e R$ 2.035,95 nos últimos 30 dias — sobraram R$ X."*, com a variação
contra o período anterior como segunda linha quando ela existe.

📌 **Faturamento e contagem são reais** (lidos do canônico). O valor de "sobraram"
é ilustrativo: o lucro sai do cálculo canônico e não de uma coluna. O ramo **sem
lucro** acima é integralmente real — e é o ramo em que a conta dela está hoje.

📌 E a Amazon dela aparece com pedidos **sem estar em `workspace_integrations`**:
a conexão caiu (token revogado) e as vendas antigas continuam no canônico.
