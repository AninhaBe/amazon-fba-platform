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
