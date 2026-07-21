# Webhooks e eventos do SellerCore

## Mercado Livre

Endpoint público:

```text
POST {APP_BASE_URL}/api/webhooks/mercado-livre
```

Configure essa URL no gerenciador do aplicativo do Mercado Livre e habilite inicialmente:

- `orders_v2`
- `items`
- `items_prices`
- `shipments`

O endpoint:

1. valida `application_id` contra `MELI_CLIENT_ID`;
2. associa `user_id` à conexão e ao workspace corretos;
3. grava o evento com chave idempotente no PostgreSQL;
4. responde HTTP 200 imediatamente;
5. consulta o recurso oficial do Mercado Livre após a resposta;
6. atualiza pedidos, produtos ou custos de remessa já usados pelo dashboard.

Reentregas não duplicam eventos concluídos. Eventos que falharam ou ficaram
pendentes são retomados, e uma execução interrompida pode ser reclamada após
cinco minutos.

O payload do webhook é tratado apenas como aviso. Dados de negócio são sempre
obtidos novamente da API autenticada do Mercado Livre.

Requisitos de produção:

```text
APP_BASE_URL=https://seu-dominio-publico
DATABASE_URL=postgresql://...
MELI_CLIENT_ID=...
MELI_CLIENT_SECRET=...
```

Verificação de disponibilidade:

```text
GET {APP_BASE_URL}/api/webhooks/mercado-livre
```

## Amazon

A Amazon não entrega notificações SP-API diretamente a um Route Handler HTTP.
O fluxo recomendado será Amazon Notifications API -> EventBridge/SQS ->
consumidor do SellerCore. As notificações devem ser complementadas por uma
reconciliação periódica, porque nem toda mudança operacional de FBA possui um
evento específico e entregas podem atrasar.

## Performance e histórico

As telas do Mercado Livre leem primeiro os dados já persistidos e aceitam
exibir cobertura parcial durante a carga inicial. O endpoint `/overview`
continua a importação depois de responder, sem fazer o navegador executar cada
etapa do histórico, e mantém snapshots por conta, período e tela durante dois
minutos. Sincronizações, webhooks e alterações de custo invalidam esses
snapshots.

A reconciliação automática passou de dez minutos para seis horas, pois os
eventos cobrem as mudanças rotineiras. O próximo passo de infraestrutura é
mover a execução pós-resposta para um Background Worker ou Cron Job dedicado,
permitindo continuar cargas longas mesmo sem uma tela aberta. As páginas Amazon
também precisam passar a ler snapshots persistidos no banco, deixando SP-API
apenas para workers, reconciliação e ações explícitas.
