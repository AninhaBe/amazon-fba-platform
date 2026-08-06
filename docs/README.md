# Mapa do `docs/` — leia isto primeiro

Guia de orientação para qualquer pessoa (ou agente de IA) chegando no projeto. O
conhecimento do SellerCore mora no repo: **antes de implementar, leia o doc da área** —
não re-deduza o que já foi decidido nem repita pegadinha já paga.

## Convenções

- **ADRs mandam.** Decisão arquitetural não muda durante implementação de feature — se
  precisar mudar, pare e proponha um ADR novo em [`adr/`](./adr/).
- **Docs de API têm "Changelog observado".** Os marketplaces mudam comportamento sem
  aviso; toda mudança observada entra datada no fim do doc do canal, mais recente
  primeiro. Ao esbarrar num comportamento novo, registre na hora.
- **Pegadinhas ficam no doc do canal**, junto do endpoint — não em arquivo separado.

## APIs dos marketplaces (leia antes de mexer em integração)

| Doc | O que tem |
|---|---|
| [`api-amazon-sp-api.md`](./api-amazon-sp-api.md) | SP-API: endpoints usados, semântica de PATCH com selectors, orderMetrics vs Transactions, FNSKU/FBA, agendamento de entrega, changelog |
| [`api-mercado-livre.md`](./api-mercado-livre.md) | ML: endpoints, regra do faturamento (validada ao centavo), refresh token rotativo, endpoints bloqueados (403), o que sobrou para pesquisa de mercado, changelog |
| [`api-shopee.md`](./api-shopee.md) | Shopee Open Platform v2 — **engatilhado, não implementado**: assinatura HMAC, OAuth, escrow, roteiro de arquivos |
| [`api-endpoints.md`](./api-endpoints.md) | Panorama geral das duas APIs (grupos e endpoints principais) — visão de mapa, não substitui os docs acima |
| [`sp-api-notifications.md`](./sp-api-notifications.md) | Notificações/webhooks da SP-API (SQS/EventBridge) |
| [`tiktok-shop-integracao.md`](./tiktok-shop-integracao.md) | Plano da integração TikTok Shop — backlog, aguardando credenciais do Partner Center |

## Arquitetura (fonte de verdade)

| Doc | O que tem |
|---|---|
| [`architecture/overview.md`](./architecture/overview.md) | Visão geral, contexto e mapa de arquivos |
| [`architecture/canonical-model.md`](./architecture/canonical-model.md) | Modelo canônico multicanal |
| [`architecture/sync-engine.md`](./architecture/sync-engine.md) | Ingestão e cron |
| [`architecture/read-and-cache.md`](./architecture/read-and-cache.md) | Leitura por SQL e cache |
| [`canonical-schema.md`](./canonical-schema.md) | Schema canônico detalhado (pedidos, taxas, produtos) |
| [`integrations-architecture.md`](./integrations-architecture.md) | Arquitetura multicanal (visão que o schema materializa) |
| [`adr/`](./adr/) | Decisões e trade-offs — o **porquê** de cada escolha (11 ADRs; índice no [`adr/README.md`](./adr/README.md)) |
| [`arquitetura-plano.md`](./arquitetura-plano.md) | Plano de arquitetura faseado — o que já foi feito e o que espera volume |

## Operação nos canais

| Doc | O que tem |
|---|---|
| [`amazon-politicas.md`](./amazon-politicas.md) | Políticas da Amazon extraídas do Seller Central BR: título ≤75 chars, capa fundo branco sem texto, atributos fiscais do FBA, limites de caixa, manual de entrega no CD |
| [`amazon-ads.md`](./amazon-ads.md) | Amazon Ads BR: como funciona, créditos, plano de campanha (aguardando estoque FBA chegar) |
| [`conexoes-que-expiram.md`](./conexoes-que-expiram.md) | Por que a autorização de cada canal cai, o que o app já detecta/mostra e o backlog para evitar (self-authorization da Amazon, vencimento de 365 dias da Shopee) |

## Planos e ideias

| Doc | O que tem |
|---|---|
| [`plans/plano-aquisicao-e-posicionamento.md`](./plans/plano-aquisicao-e-posicionamento.md) | GTM: aquisição e posicionamento |
| [`plans/seller-intelligence-plan.md`](./plans/seller-intelligence-plan.md) | Plano do Seller Intelligence (briefing diário de prioridades — ver ADR-008) |
| [`plans/migracao-coolify.md`](./plans/migracao-coolify.md) | Migração para self-hosted Coolify (ver ADR-006) |
| [`ai-agent-harness.md`](./ai-agent-harness.md) | Ideia/backlog: AI agent harness no produto |
| [`vercel-deploy.md`](./vercel-deploy.md) | Deploy na Vercel (Render permanece ligado durante a migração) |

## Compliance

| Doc | O que tem |
|---|---|
| [`compliance/personal-information-protection-standard.md`](./compliance/personal-information-protection-standard.md) | Padrão de proteção de dados pessoais |
| [`compliance/tiktok-review-response.md`](./compliance/tiktok-review-response.md) | Resposta à revisão do app TikTok |
