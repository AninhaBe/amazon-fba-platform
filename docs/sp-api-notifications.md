# Notificações da Amazon SP-API

> ⚠️ **O transporte e o consumo deste documento foram substituídos pelo
> [ADR-023](adr/ADR-023-notificacoes-da-amazon.md) em 21/08/2026.** A escolha de
> eventos (`ORDER_CHANGE`, `TRANSACTION_UPDATE`, `FBA_INVENTORY_AVAILABILITY_CHANGES`)
> e as regras do consumidor seguem valendo. O que mudou: **não haverá worker
> separado** — o agendador interno (ADR-019) consome a fila no mesmo processo,
> porque criar peça nova para operar contraria a decisão que acabou de ser tomada.

> 📌 **Estado medido em 07/09/2026: nada disto está no ar.** Consultado
> `GET /notifications/v1/subscriptions/{tipo}` com o token do vendedor, os cinco
> tipos testados (`TRANSACTION_UPDATE`, `ORDER_CHANGE`,
> `FBA_INVENTORY_AVAILABILITY_CHANGES`, `ANY_OFFER_CHANGED`,
> `REPORT_PROCESSING_FINISHED`) devolvem **404 NotFound** — não há assinatura
> nenhuma. E `GET /notifications/v1/destinations`, com token grantless de escopo
> `sellingpartnerapi::notifications`, devolve **lista vazia**: não existe nem
> destino cadastrado, que é o pré-requisito da assinatura.
>
> Ou seja, hoje **toda a ingestão da Amazon é por varredura**. O ADR-023 continua
> `Proposto`. Isto está registrado aqui para que a próxima leitura não precise
> chamar a API para descobrir — e para que "o repo menciona a notificação" não
> seja confundido com "a notificação está ativa".

## Objetivo

Substituir parte das consultas periódicas por eventos da Amazon, mantendo as consultas atuais como reconciliação e recuperação em caso de atraso.

## Eventos recomendados

| Evento | Uso no produto | Ação ao receber |
| --- | --- | --- |
| `TRANSACTION_UPDATE` | Atualizar saldos liberados/diferidos e conciliação | Invalidar o cache de transações e buscar a transação atualizada |
| `ORDER_CHANGE` | Atualizar pedidos e métricas do Monitor | Invalidar o cache de pedidos da conta |
| `FBA_INVENTORY_AVAILABILITY_CHANGES` | Atualizar estoque e alertas | Atualizar o SKU afetado e recalcular risco de ruptura |

## Arquitetura

```text
Amazon SP-API -> SQS ou EventBridge -> consumidor autenticado
              -> deduplicação por notificationId
              -> invalidação do cache por conta
              -> atualização da tela na próxima consulta
```

A Amazon não envia essas notificações diretamente para uma rota HTTP da aplicação. É necessário criar um destino compatível na AWS, registrar esse destino pela Notifications API e criar uma assinatura para cada tipo de evento.

## Dados externos necessários

- Região e conta AWS que receberão os eventos.
- ARN da fila SQS ou do barramento EventBridge.
- Política do recurso autorizando a Amazon a publicar.
- Associação segura entre a assinatura/destino e a conta de vendedor local.
- Uma fila de mensagens mortas e alarmes para falhas de processamento.

## Regras do consumidor

1. Validar o envelope e rejeitar tipos desconhecidos.
2. Deduplicar antes de alterar cache ou banco.
3. Registrar somente identificadores operacionais; nunca tokens LWA.
4. Confirmar a mensagem apenas depois do processamento.
5. Se a atualização falhar, deixar a fila tentar novamente e enviar para a DLQ após o limite.
6. Manter uma reconciliação periódica pelas APIs de Orders, Finances e Inventory.

## Próxima etapa de implantação

Depois que o destino AWS estiver definido, implementar um worker separado da aplicação web. O worker deve chamar funções de invalidação por conta; a aplicação continua funcionando normalmente caso a fila esteja indisponível.
