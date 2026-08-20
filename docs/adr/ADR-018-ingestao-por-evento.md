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
