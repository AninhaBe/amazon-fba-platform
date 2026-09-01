# Alarme de silêncio do webhook — desenho

**Medido em 01/09/2026, produção.** Proposta; não implementado.

## Por que agora

A janela de frescor do ML foi de 2 para 10 minutos (`2f4aca3`), porque o webhook
já entrega. **Isso não criou um buraco — tirou um curativo que o escondia:** o
polling de 2 em 2 minutos mascarava uma falha do webhook, recuperando o atraso
antes de alguém notar. Com 10 minutos, uma falha silenciosa custa mais e continua
invisível.

Hoje **não existe alarme**: `/api/health` não olha o webhook, e `metricas.ts` só
conta eventos por status — métrica, não alarme.

## O problema difícil: silêncio ≠ volume baixo

Alarme por volume falharia. Medido, eventos por hora do dia (7 dias, fuso de São
Paulo):

| faixa | eventos/hora |
|---|---|
| Pico (10h–12h) | **~307** |
| Madrugada (4h–5h) | **~44** |

**Sete vezes de diferença.** Qualquer limite de volume que não dispare às 11h
dispara às 4h — e *"alarme que toca sozinho toda noite é desligado em uma
semana"*.

## A saída: medir o INTERVALO, não o volume

O intervalo entre eventos é **muito mais estável que o volume**. Medido sobre 7
dias, incluindo todas as madrugadas:

| | |
|---|---|
| Intervalo médio entre eventos | **< 1 minuto** |
| p99 do intervalo | **4 minutos** |
| **Maior silêncio observado em 7 dias** | **18 minutos** |

Mesmo na hora mais fraca — 44 eventos/hora, um a cada 82 segundos — o intervalo
não estica. É por isso que ele serve de sinal e o volume não: **o intervalo é
quase independente da carga; o volume varia 7×.**

## O limite proposto: 45 minutos

**2,5× o pior silêncio já observado** em 7 dias. Pelo registro histórico, esse
limite **nunca teria disparado** — zero alarme falso no período medido — e
detecta uma parada real em menos de uma hora.

⚠️ **Não escolhi 30 minutos**, que era o palpite inicial. 30 min é só 1,7× o pior
caso observado, e a amostra é de 7 dias: um domingo de baixa ou uma manutenção do
próprio ML podem produzir um silêncio legítimo maior do que qualquer coisa que
apareceu na semana medida. Alarme novo deve começar folgado e apertar com
evidência — o contrário treina todo mundo a ignorá-lo.

## O que `/api/health` passa a reportar

Um estado a mais, **degradado e não falho**: o app está de pé, o que parou foi a
entrega de um canal.

```
webhook_mercado_livre: {
  ultimo_evento_ha_minutos: 3,
  limite_minutos: 45,
  estado: "ok" | "silencioso"
}
```

⚠️ **`silencioso` não pode derrubar o health check.** Se derrubar, uma parada do
ML vira reinício da máquina e o problema piora. É sinal para quem observa, não
para o orquestrador.

⚠️ **E ele precisa dizer o que fazer.** Pela regra da casa, aviso que não aponta
ação é ruído: *"o Mercado Livre não envia evento há 52 minutos (normal: menos de
5). Os pedidos ainda chegam pela sincronização de 10 em 10 minutos."* — isso diz
o que quebrou **e** o que ainda funciona, que é o que evita pânico.

## Serve aos outros canais?

**Não do mesmo jeito, e o motivo é que só um canal tem entrega por evento
funcionando.**

| canal | webhook | o limite de intervalo serve? |
|---|---|---|
| **Mercado Livre** | ✅ em produção, 447 eventos/h medidos | **Sim — é o caso desta proposta** |
| **Amazon** | Notificações SP-API existem (`docs/sp-api-notifications.md`), mas o produto não depende delas | Não hoje: a ingestão é por polling, e o alarme certo lá é o passo do cron falhando, que já existe |
| **Shopee** | Sem push em produção (Go Live pendente) | Não se aplica |
| **TikTok** | Sem push em produção | Não se aplica |

📌 **O padrão é generalizável; o limite não.** Cada canal precisaria da própria
medição de intervalo — copiar os 45 minutos do ML para um canal com décimo do
volume produziria exatamente o alarme falso que este desenho evita. Se a Amazon
passar a depender de notificação, a conta se refaz com os dados dela.

## O que falta decidir

1. Onde o `silencioso` aparece além do `/api/health` — a tela do admin já mostra
   estado de conexão e seria o lugar natural.
2. Se vale alarme ativo (mensagem) ou só estado consultável. **Recomendo começar
   consultável**: alarme ativo sem alguém de plantão às 4h é ruído com custo.
