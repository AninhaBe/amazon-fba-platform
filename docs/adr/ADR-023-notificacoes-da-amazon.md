# ADR-023: Notificações da Amazon por EventBridge com destino HTTP

- **Status:** 🔴 **Recusado em 21/08/2026 — sem AWS.** Decisão dela, no mesmo dia em
  que foi proposto: *"alguma outra alternativa? não quero usar aws"*. Fica
  registrado porque a alternativa escolhida (polling curto) tem limite conhecido, e
  se um dia o atraso incomodar, este é o desenho pronto.
- ~~Status: Proposto~~
- **Data:** 2026-08-21
- **Implementa a fase 3 de:** [ADR-018](./ADR-018-ingestao-por-evento.md)
- **Substitui o desenho de:** [`../sp-api-notifications.md`](../sp-api-notifications.md)
  na parte de transporte (SQS + worker separado)

## Contexto

O painel da Amazon mostrava dado de horas atrás sem avisar. Medido em 21/08/2026 na
conta do sócio: último pedido ingerido às **16:05**, tela aberta às **22:15**.

A causa imediata eram duas travas de 6 horas — corrigidas para 10 minutos no mesmo
dia. Mas isso é polling: reduz o atraso, não o elimina. A vendedora foi direta:
*"como eu disse, quero tudo real time"* e, em seguida, *"não tem como fazer um
webhook igual do mercado livre?"*.

**A pergunta é a certa, e a prova está no próprio código:** o `FRESH_FOR_MS` do
Mercado Livre **também é 6 horas**. O ML está fresco por causa do webhook, não do
polling. A Amazon nunca teve o equivalente.

## O que a Amazon oferece

A SP-API **não posta em endpoint HTTP próprio**. Os destinos possíveis são **SQS** e
**EventBridge**. Os eventos que interessam já estão escolhidos no ADR-018:
`ORDER_CHANGE`, `TRANSACTION_UPDATE`, `FBA_INVENTORY_AVAILABILITY_CHANGES`.

## Decisão

Usar **EventBridge com API Destination**, não SQS com worker.

```
Amazon SP-API
  → EventBridge (partner event source, criado pela Amazon na conta AWS)
  → Rule
  → API Destination (HTTP POST autenticado)
  → POST /api/webhooks/amazon   ← o NEXO, como já é no Mercado Livre
```

### Por que não SQS + worker

O desenho anterior (`sp-api-notifications.md`) previa uma fila SQS e **um worker
separado da aplicação**. Isso adiciona um processo novo para manter, monitorar e
implantar — e o ADR-019 acabou de consolidar o oposto, trazendo o agendamento para
dentro do processo web justamente para não ter peça extra.

Com API Destination, o NEXO recebe um `POST` como já recebe do Mercado Livre. Nenhum
worker, nenhum polling de fila, nenhum processo novo. A infraestrutura AWS existe,
mas fica **inerte**: é encanamento de entrega, não código nosso rodando lá.

### O que fica igual ao Mercado Livre

A caixa de entrada é a mesma: `workspace_marketplace_events`, com dedup por
`event_key`, `status` de `pending → processing → done`, e retenção de 7 dias
(ADR-016). O processamento reaproveita o sync existente — a notificação **não traz o
dado**, traz o aviso de que mudou; quem busca continua sendo a SP-API.

Isso importa: um evento perdido não corrompe nada, só atrasa. **O cron de 10 minutos
permanece como reconciliação**, exatamente como o ADR-018 determina. Push é o
caminho rápido; polling é a rede de segurança.

## Segurança

A rota é pública por necessidade (quem chama é a AWS, não uma sessão). Duas defesas:

1. **Segredo compartilhado no header**, configurado na API Destination e conferido
   na rota. Sem ele, `401` antes de qualquer leitura do corpo.
2. **A notificação não é fonte de verdade.** Ela dispara uma busca autenticada na
   SP-API; nada do corpo entra no banco como dado de negócio. Mesmo forjada, o pior
   efeito é uma consulta a mais.

⚠️ Não usar o `CRON_SECRET`: escopos diferentes vazam juntos. Segredo próprio.

## Custo

EventBridge cobra por milhão de eventos publicados; no volume atual (1.826 pedidos
em 30 dias no maior workspace) o custo fica na casa de centavos. A conta AWS é o
único item novo de infraestrutura — o ADR-018 já a previa e chamava de "a única do
plano".

## Consequências

- ➕ Pedido novo aparece em segundos, não em minutos.
- ➕ Nenhum processo novo para operar; a rota entra no deploy que já existe.
- ➕ O mesmo caminho serve depois para estoque e transações financeiras.
- ➖ Depende de uma conta AWS. **Enquanto ela não existir, a rota fica pronta e
  ociosa** — o que é aceitável: o polling de 10 minutos cobre o intervalo.
- ➖ Mais um endpoint público. Mitigado acima.

## A alternativa adotada: polling curto

Sem AWS não há push — a limitação é da Amazon, não nossa. Sobra reduzir o intervalo,
e o teto é o rate limit da SP-API, não a nossa vontade.

| Camada | Antes | Agora |
|---|---|---|
| Agendador interno (ADR-019) | 5 min | **2 min** |
| Janela de sync (`FRESH_FOR_MS`) | 6 horas | **2 min** |

⚠️ **As duas travas são em série.** Baixar só uma não adianta: com a janela em 10
minutos e o agendador em 5, o atraso continuava sendo múltiplo de 5. Foi assim que a
primeira correção do dia não mudou nada.

**O limite real é o `getOrders`**, documentado pela Amazon em ~1 requisição por
minuto por conta de vendedor, com burst. Dois minutos deixa margem, mas é **estimado,
não medido** — o sinal de que passamos do ponto é `429` no log do sync. Se aparecer,
subir para 3 minutos é a correção, não desligar.

**O que isso entrega:** atraso máximo de ~2 minutos, contra as 6 horas de antes.
Não é tempo real de verdade — push seria —, mas é a diferença entre "a venda aparece
enquanto você olha" e "a venda aparece amanhã".

## O que fica em aberto

**A assinatura por conta de vendedor.** Cada vendedor precisa de `createDestination`
e `createSubscription` chamados com o token dele. Isso é código de integração e
entra junto do fluxo de conectar conta — não está nesta ADR.
