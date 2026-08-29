# ADR-018: Ingestão por evento — webhook primeiro, cron como reconciliação

- **Status:** Aceito (execução por fases)
- **Data:** 2026-08-20

## Contexto

A pergunta da dona: *"os pedidos aparecem assim que caem, ou tem cron que puxa X vezes
por dia?"* — e a decisão dela: **ter os dados em tempo real**.

Hoje a ingestão é híbrida e desigual:

| Canal | Transporte | Latência |
|---|---|---|
| Mercado Livre | **webhook** + cron-vassoura | segundos |
| Amazon | só cron (5 min via ADR-019) | minutos |
| TikTok | só cron | minutos |
| Shopee | só cron | minutos |

O modelo do ML é o certo e já se provou (~8 mil eventos/dia, caixa de entrada com
retenção do ADR-016). Os outros três canais têm push disponível e não usam.

### O que "tempo real" NÃO resolve (expectativa honesta)

Na Amazon, o pedido nasce `Pending` **sem valor e sem itens** — a própria Amazon só
libera os detalhes minutos ou horas depois. Evento dá o *"vendi agora"*; o valor completo
continua chegando na segunda passada (a reverificação do sync). Esse teto é do fornecedor
do dado e nenhuma arquitetura fura.

### Mongo foi considerado e rejeitado

A sugestão "usar um Mongo talvez" confunde transporte com armazenamento. Tempo real é o
evento **chegar** em vez de ser buscado; o banco de destino é indiferente. Os números:
nosso volume é ~8 mil eventos/dia (0,1/s) e o Postgres lê 37 mil pedidos agregados em
21ms — não há dor que um segundo banco cure, e haveria custo real (dois bancos para
operar, backup duplo, modelo canônico do ADR-001 reescrito). Mesma lógica que rejeitou
Databricks no ADR-016.

## Decisão

**Todo canal com push disponível usa push como transporte primário. O cron (ADR-019)
permanece PARA SEMPRE como reconciliação** — não é fase de transição: webhook perde
mensagem (deploy, queda, bug do canal), e a varredura periódica é o que garante que o
canônico converge. O par evento+varredura é o desenho final, não um meio-termo.

O padrão de consumo é o já provado no ML:

```
canal → endpoint/fila → caixa de entrada (workspace_marketplace_events)
      → processamento idempotente → canônico → retenção (ADR-016)
```

Regras herdadas do que o ML ensinou:
- **Validar origem** antes de aceitar (o endpoint do ML já recusa aplicação desconhecida).
- **Deduplicar** por chave de evento antes de tocar o canônico.
- **Caixa de entrada com retenção** — fila sem expurgo foi o que estourou o banco.
- O evento **aciona** a busca do dado completo; não se confia no payload do push como
  fonte final (o ML manda o recurso, não o dado).

## Fases (ordem por esforço ÷ valor)

| Fase | Canal | O quê | Depende de |
|---|---|---|---|
| 0 | ML | ✅ já feito — referência do padrão | — |
| 1 | **TikTok** | webhook de pedidos do Partner Center para `/api/webhooks/tiktok` | app já aprovado em privacidade; falta Listing/App review |
| 2 | **Shopee** | push de pedidos | Go Live pendente |
| 3 | **Amazon** | SP-API Notifications (`ORDER_CHANGE`, `TRANSACTION_UPDATE`, `FBA_INVENTORY_AVAILABILITY_CHANGES`) via **SQS** — desenho detalhado em [`../sp-api-notifications.md`](../sp-api-notifications.md) | ⚠️ **conta AWS** (fila SQS + política) — infra nova, a única do plano |

A Amazon fica por último **apesar de ser o canal principal** porque é a única que exige
infraestrutura fora do app (a Amazon não posta em HTTP próprio, só SQS/EventBridge) — e o
cron de 5 min já dá latência aceitável enquanto isso.

## Consequências

- ➕ Pedido aparece em segundos nos canais com push; o cron vira rede de segurança.
- ➕ Menos chamadas de polling → menos rate limit, menos custo de API.
- ➕ Nenhum banco novo, nenhum serviço novo além da fila SQS da fase 3.
- ➖ Cada webhook novo é superfície pública nova — validação de origem é requisito de
  entrada, não melhoria (o hardening do webhook ML segue no TODO e vira pré-requisito
  desta expansão).
- ➖ Fase 3 introduz dependência de AWS (conta, fila, política) — primeira peça de infra
  fora de Fly+Supabase+GitHub; decidir na hora se vale ou se EventBridge simplifica.
- 📌 Eventos entram na categoria **efêmero** do ADR-016 desde o dia zero: retenção de 7
  dias definida na criação de cada caixa de entrada nova.

Relacionado: [ADR-016](./ADR-016-ciclo-de-vida-do-dado.md) ·
[ADR-019](./ADR-019-agendador-interno.md) ·
[`../sp-api-notifications.md`](../sp-api-notifications.md) ·
[`../tiktok-shop-integracao.md`](../tiktok-shop-integracao.md)

## Atualização de 29/08/2026 — o que a operação ensinou desde a decisão

A decisão acima não muda. O que segue são **fatos medidos** que a execução ainda
não tinha, e que alteram a ordem das fases e acrescentam um passo zero.

### 📌 O push do ML não é só "referência": ele é um experimento em produção

Medido em 29/08/2026, na caixa de entrada:

```
mercado_livre  complete   35.791
mercado_livre  pending       207   ← parados desde 28/08 14:52 (~13 horas)
mercado_livre  error           3
```

**4.032 eventos nas últimas 24h** — o push funciona. E **207 parados por 13
horas sem ninguém perceber** — o push falha em silêncio, porque o cron encobre.

Isso é exatamente a razão de o cron ser permanente (a decisão já dizia). Mas é
também uma oportunidade que estava sendo desperdiçada: **temos um push real de
onde extrair números antes de integrar o segundo canal.**

### Fase 0.5 (nova): aprender com o push que já existe

Custo de horas, zero integração nova, e ela dimensiona as três fases seguintes:

1. **Por que 207 estão `pending`?** Fila que não drena é o modo de falha nº 1 de
   push, e é silencioso.
2. **Qual a taxa real de perda?** Pedidos que chegaram por webhook contra os que
   só a varredura encontrou, na mesma janela. É esse número que dimensiona a
   rede de segurança dos outros três — hoje ela é dimensionada por intuição.
3. **Qual a latência real?** Do `occurred_at` no canal até o `received_at` aqui.
   É o número que responde *"quão tempo real?"* com fato em vez de promessa.

Sem isso, os três canais seguintes copiam um desenho sem saber onde ele vaza, e
descobrimos os mesmos defeitos três vezes.

### ⚠️ A ordem das fases 1 e 2 depende de terceiros, e a situação mudou

| Canal | Bloqueio na decisão (20/08) | Situação em 29/08 |
|---|---|---|
| TikTok (fase 1) | "falta Listing/App review" | **app público submetido em 27/08** — aguardando |
| Shopee (fase 2) | "Go Live pendente" | **Go Live segue pendente**; sem ele não há chave de produção |

Ou seja: **os dois seguem bloqueados por terceiros**, e a ordem entre eles não é
escolha nossa — é quem destravar primeiro. Um plano que fixe "Shopee antes de
TikTok" por volume de pedidos ignora que a Shopee **não tem credencial de
produção para push** enquanto o Go Live não sair.

📌 Consequência prática: **a fase 0.5 é a única que não depende de ninguém** — e
por isso deve começar primeiro, independentemente de qual review sair antes.

### O segundo eixo: tempo real é até os OLHOS dela, não até a nossa tabela

De que adianta o pedido chegar no banco em 1 segundo se a tela pede **28
transações** para compor — e, sob contenção, levou **54 segundos** em 29/08?

| Eixo | Onde está | Dono |
|---|---|---|
| **Ingestão** — do canal ao nosso banco | 3–10 min (polling) + segundos (ML por push) | este ADR |
| **Leitura** — do nosso banco à tela | 28 transações, ~280ms em regime bom | [ADR-030](./ADR-030-fundo-nao-compete-com-a-tela.md) |

**São a mesma frente.** Entregar só a ingestão produz um sistema que ingere
rápido e mostra devagar — e a pessoa que pediu tempo real não vê diferença.

### E uma consequência que vale nos dois eixos ao mesmo tempo

> **Intervalo de 10 minutos COM push é melhor que 2 minutos SEM push** — mais
> rápido para o que importa e mais leve para o banco.

Os intervalos do ADR-030 (3/5/10/10 min, medidos) não afastam o produto do tempo
real: afastam o produto de um custo que **não comprava tempo real nenhum**. Push
é o que compra, e o polling de 2 minutos foi, em 29/08, causa direta de a tela
não carregar.

### Requisito acrescentado à lista original

O consumo de push é **trabalho de FUNDO** (ADR-030): usa o pool do fundo, nunca o
da tela. Um pico de webhook não pode competir com a dona olhando o painel — que
é a forma exata do incidente de 29/08.
