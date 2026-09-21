# ADR-023: Notificações da Amazon por SQS, consumidas pelo agendador que já existe

- **Status:** Proposto
- **Data:** 2026-08-21
- **Implementa a fase 3 de:** [ADR-018](./ADR-018-ingestao-por-evento.md)
- **Substitui o desenho de:** [`../sp-api-notifications.md`](../sp-api-notifications.md)
  na parte de consumo (worker separado)

## Contexto

O painel da Amazon mostrava dado de horas atrás sem avisar. Medido em 21/08/2026 na
conta do sócio: último pedido ingerido às **16:05**, tela aberta às **22:15**.

A causa imediata eram **duas travas de 6 horas em série** — a candidatura do
agendador e a abertura de janela do sync. Corrigidas no mesmo dia para 2 minutos,
junto com o intervalo do agendador (5 → 2 min). Isso derrubou o atraso de horas para
minutos, mas continua sendo polling.

A pergunta que motivou este ADR foi dela: *"não tem como fazer um webhook igual do
mercado livre?"*. É a pergunta certa — e a prova está no próprio código: o
`FRESH_FOR_MS` do Mercado Livre **também é 6 horas**. O ML está fresco por causa do
webhook, não do polling. A Amazon nunca teve o equivalente.

## A restrição que define tudo

**A SP-API não posta em endpoint HTTP.** Os únicos destinos são **SQS** e
**EventBridge**. Não há contorno: sem uma conta AWS, não existe push da Amazon.

## Decisão

Usar **SQS**, com o consumo feito **dentro do agendador interno que já roda**
(ADR-019). Nenhum processo novo.

```
Amazon SP-API
  → fila SQS (na conta AWS dela)
  → long polling do agendador interno, no mesmo processo web
  → workspace_marketplace_events (a MESMA caixa de entrada do Mercado Livre)
  → sync busca o dado na SP-API e grava no canônico
```

### Por que SQS e não EventBridge

A primeira versão deste ADR escolheu EventBridge com API Destination, para receber um
`POST` como o Mercado Livre faz. Descartado por **custo**, depois de verificar os
preços — o critério dela foi explícito: *"topo se for de graça, se não, deixa quieto"*.

| | Preço | No volume atual (~7–20 mil eventos/mês) |
|---|---|---|
| **SQS** | 1 milhão de requisições grátis/mês, **todos os clientes, sem prazo** | **R$ 0,00** |
| EventBridge | US$ 1,00/milhão de eventos + US$ 0,20/milhão de entregas | ~US$ 0,02/mês |

Long polling de 20 em 20 segundos consome ~130 mil requisições/mês — **13% da cota
gratuita**. Sobra folga para o volume crescer uma ordem de grandeza.

### Por que não o "worker separado" do desenho antigo

`sp-api-notifications.md` previa um processo à parte para consumir a fila. Isso
contraria o ADR-019, que acabou de trazer o agendamento para dentro do processo web
justamente para não ter peça extra para operar, monitorar e implantar.

**O agendador já roda a cada 2 minutos.** Consumir a fila é uma chamada a mais no
mesmo laço — e, para ganhar latência de verdade, um long poll contínuo em vez de uma
leitura por ciclo. Ambos cabem no processo atual.

### O que fica igual ao Mercado Livre

A caixa de entrada é a mesma tabela, `workspace_marketplace_events`, com dedup por
`event_key`, ciclo `pending → processing → done` e retenção de 7 dias (ADR-016).

E o mais importante: **a notificação não traz o dado, traz o aviso de que mudou.**
Quem busca continua sendo a SP-API autenticada. Isso significa que evento perdido não
corrompe nada — só atrasa. **O polling de 2 minutos permanece como reconciliação**,
exatamente como o ADR-018 determina. Push é o caminho rápido; polling é a rede.

## Segurança

- Credenciais AWS entram como secret do Fly, nunca no repositório.
- Usuário IAM **dedicado**, com permissão apenas de `ReceiveMessage` e
  `DeleteMessage` naquela fila — não um usuário administrativo.
- Mensagem só é apagada **depois** de gravada na caixa de entrada; falha deixa a
  mensagem voltar para a fila.
- Fila de mensagens mortas após N tentativas, para veneno não travar o consumo.
- Nada do corpo da mensagem vira dado de negócio sem passar por busca autenticada.

## Consequências

- ➕ Pedido novo aparece em segundos, não em ~2 minutos.
- ➕ Custo zero no volume atual, e o limite gratuito é permanente.
- ➕ Nenhum processo novo; entra no deploy que já existe.
- ➕ O mesmo caminho serve depois para estoque e transações financeiras.
- ➖ **Depende de uma conta AWS.** Enquanto não existir, o consumidor fica ocioso e o
  polling de 2 minutos cobre — degradação limpa, não quebra.
- ⚠️ **A conta AWS exige cartão e habilita todos os serviços.** O SQS não cobra neste
  volume; o risco é ligar outra coisa sem perceber. Mitigação obrigatória: **alerta
  de faturamento em US$ 1** (a AWS oferece; o Fly, notadamente, não).

## O que fica em aberto

**A assinatura por conta de vendedor.** Cada vendedor precisa de `createDestination`
e `createSubscription` chamados com o token dele, e o destino aponta para a mesma
fila. Isso é código de integração e entra junto do fluxo de conectar conta — não está
nesta ADR.

**O que fazer com o Mercado Livre.** O `FRESH_FOR_MS` dele segue em 6 horas: se o
webhook falhar, o painel envelhece sem aviso, exatamente como a Amazon envelhecia.
Não foi tocado hoje e merece decisão própria.

## Estado da implementação (21/09/2026) — infra e assinatura LIGADAS

⚠️ **Atualiza o Status:** o desenho saiu do papel. A AWS e o lado da Amazon já
estão de pé; falta só o consumidor (abaixo).

### AWS (feito com a dona, no console)
- **Conta AWS:** `073856425324` · **Região:** `us-east-1`.
- **Fila:** `nexo-amazon-notifications`
  ARN `arn:aws:sqs:us-east-1:073856425324:nexo-amazon-notifications`.
- **DLQ + alerta de faturamento US$ 1** criados (mitigação obrigatória do ADR).
- **Usuário IAM dedicado:** `nexo-sqs-consumer`, só `ReceiveMessage`/`DeleteMessage`
  na fila (não administrativo).
- **Política da fila** concede `SendMessage` ao principal da SP-API
  (`437568002678`) — validada pela Amazon no `createDestination` (aceito).
- **Secrets no Fly** (nunca no repo): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_REGION`, `SQS_QUEUE_URL`.

### Amazon (feito pela SP-API, Notifications API)
- **Destino:** `createDestination` → `destinationId d291e8e3-d80c-4d58-840c-8e072cd94d9c`
  (nome `nexo-amazon-sqs`), apontando para a fila acima. App-level (token grantless,
  scope `sellingpartnerapi::notifications`).
- **Assinatura:** `createSubscription` `ORDER_CHANGE` →
  `subscriptionId 95023e60-e75b-4a7e-8096-e98ba5ba269c`, na conta do Lucas
  (`A15NQMF7A6J1Y0`, SILVEIRAS). Confirmada por `GET` (200).
- ⚠️ **PEGADINHA MEDIDA:** o `eventFilter` do `ORDER_CHANGE` **NÃO aceita
  `marketplaceIds`** — incluir devolve `InvalidInput ... failed to validate`
  (há issue oficial: amzn/selling-partner-api-models#4135). O corpo certo é só
  `{"orderChangeTypes":["OrderStatusChange"],"eventFilterType":"ORDER_CHANGE"}`.
- ⚠️ `ORDER_STATUS_CHANGE` está **morta** (sunset 31/12/2023) — usar `ORDER_CHANGE`.

### O que falta
1. **Consumidor** (esta branch): passo no agendador interno que faz long poll da
   fila (SigV4, `ReceiveMessage` WaitTimeSeconds=20), grava em
   `workspace_marketplace_events` (dedup `event_key`, provider `amazon`,
   `connection_id = amazon:<sellerId>`), e só então `DeleteMessage`. O processador
   marca o pedido para re-sync — a busca continua sendo SP-API autenticada
   (evento perdido só atrasa, não corrompe; o polling de 2 min é a rede).
2. **Auto-assinatura das outras contas** no fluxo de conectar conta
   (`createDestination` é uma vez; `createSubscription` é por vendedor). Hoje só a
   do Lucas está assinada, à mão.
