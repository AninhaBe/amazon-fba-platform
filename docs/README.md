# Mapa do `docs/` — leia isto primeiro

Guia de orientação para qualquer pessoa (ou agente de IA) chegando no projeto. O
conhecimento do **NEXO** mora no repo: **antes de implementar, leia o doc da área** —
não re-deduza o que já foi decidido nem repita pegadinha já paga.

> **Chegando agora ou retomando o trabalho?** Comece por
> [`estado-atual.md`](./estado-atual.md): diz onde cada frente parou, o passo
> exato para retomar as que estão no meio do caminho, e o que está bloqueado
> esperando terceiros.

> ⚠️ **"SellerCore" é o nome antigo do produto** e aparece em docs escritos antes de
> 15/08. Continua nos identificadores de propósito (URL, contas, variáveis) — ver
> `AGENTS.md` antes de renomear qualquer coisa.

## Convenções

- **ADRs mandam.** Decisão arquitetural não muda durante implementação de feature — se
  precisar mudar, pare e proponha um ADR novo em [`adr/`](./adr/).
- **Docs de API têm "Changelog observado".** Os marketplaces mudam comportamento sem
  aviso; toda mudança observada entra datada no fim do doc do canal, mais recente
  primeiro. Ao esbarrar num comportamento novo, registre na hora.
- **Pegadinhas ficam no doc do canal**, junto do endpoint — não em arquivo separado.
- **Doc datado é doc verificável.** Ao afirmar algo observado (estado de uma
  candidatura, resposta de uma API, número de produção), registre **quando** foi medido.
  Data velha não quer dizer errado — quer dizer *não reconferido*.

## Desenvolvimento e qualidade

| Doc | O que tem |
|---|---|
| [`../SELLERCORE_DEV_GUIDE.md`](../SELLERCORE_DEV_GUIDE.md) | Ponto de entrada para desenvolvimento e regra obrigatória do gate contínuo. |
| [`gate-continuo-de-saude.md`](./gate-continuo-de-saude.md) | Gatilhos, checklist integrado em `localhost:3000`, evidências, estados `PASS`/`FAIL`/`BLOCKED` e responsabilidades. |
| [`migrations.md`](./migrations.md) | Runner fail-closed, plano, autorização curta e resposta ao incidente 0003/0004. |
| [`tiktok-qa-evidence.md`](./tiktok-qa-evidence.md) | Evidência agregada e procedimento fail-closed para QA autenticado TikTok; atualmente bloqueado por ownership duplicado e pela 0005 ainda não aplicada. |
| [`achado-o-processo-nao-se-audita.md`](./achado-o-processo-nao-se-audita.md) | **Como auditar backfill e reprocessamento.** Três defeitos que o relatório da execução deu por concluídos e a conferência contra a fonte pegou; e o fecho da família das sete formas — por que suprimir um número errado desliga o alarme da próxima causa. |
| [`figma-e-codigo.md`](./figma-e-codigo.md) | **Mapa Figma ↔ código.** Qual componente do Figma aponta para qual classe ou componente React, e por que o mapa e manual (Code Connect exige plano Organization). |

## APIs dos marketplaces (leia antes de mexer em integração)

| Doc | O que tem |
|---|---|
| [`api-amazon-sp-api.md`](./api-amazon-sp-api.md) | SP-API: endpoints usados, semântica de PATCH com selectors, orderMetrics vs Transactions, FNSKU/FBA, agendamento de entrega, changelog |
| [`api-mercado-livre.md`](./api-mercado-livre.md) | ML: endpoints, regra do faturamento (validada ao centavo), refresh token rotativo, endpoints bloqueados (403), **API do Mercado Pago** (abre com o mesmo token do ML), changelog |
| [`api-mercado-livre-superficie.md`](./api-mercado-livre-superficie.md) | O que a API do ML **respondeu de verdade** com as nossas credenciais, testado endpoint a endpoint (14–15/08) — não é lista de documentação |
| [`api-shopee.md`](./api-shopee.md) | Shopee Open Platform v2 — implementação local com HTTP fail-closed, OAuth, sweep retomável multi-status, multi-loja, settings e remoção local; Go Live e payload Live seguem bloqueados |
| [`api-endpoints.md`](./api-endpoints.md) | Panorama geral das duas APIs (grupos e endpoints principais) — visão de mapa, não substitui os docs acima |
| [`sp-api-notifications.md`](./sp-api-notifications.md) | Notificações/webhooks da SP-API (SQS/EventBridge) |
| [`tiktok-shop-integracao.md`](./tiktok-shop-integracao.md) | Histórico, contrato e estado TikTok — OAuth, sync, cron e leitura canônica implementados, com Dashboard, Financeiro e módulos filtráveis; validação financeira real ainda parcial |
| [`tiktok-modules-api.md`](./tiktok-modules-api.md) | Contrato modular de leitura do TikTok — rotas, erros seguros e paginação |

## Arquitetura (fonte de verdade)

| Doc | O que tem |
|---|---|
| [`architecture/overview.md`](./architecture/overview.md) | Visão geral, contexto e mapa de arquivos |
| [`architecture/canonical-model.md`](./architecture/canonical-model.md) | Modelo canônico multicanal |
| [`architecture/sync-engine.md`](./architecture/sync-engine.md) | Ingestão e cron |
| [`architecture/read-and-cache.md`](./architecture/read-and-cache.md) | Leitura por SQL e cache |
| [`canonical-schema.md`](./canonical-schema.md) | Schema canônico detalhado (pedidos, taxas, produtos) |
| [`integrations-architecture.md`](./integrations-architecture.md) | Arquitetura multicanal (visão que o schema materializa) |
| [`adr/`](./adr/) | Decisões e trade-offs — o **porquê** de cada escolha (25 ADRs; índice no [`adr/README.md`](./adr/README.md)). ADR-013 e ADR-014 tratam de escala (worker de sync separado do web; cache fora do processo). **ADR-015** divide o ADR-006 em fases: compute em São Paulo primeiro, banco e auth gerenciados por enquanto |
| [`arquitetura-plano.md`](./arquitetura-plano.md) | Plano de arquitetura faseado — o que já foi feito e o que espera volume |

## Operação nos canais

| Doc | O que tem |
|---|---|
| [`amazon-politicas.md`](./amazon-politicas.md) | Políticas da Amazon extraídas do Seller Central BR: título ≤75 chars, capa fundo branco sem texto, atributos fiscais do FBA, limites de caixa, manual de entrega no CD |
| [`amazon-ads.md`](./amazon-ads.md) | Amazon Ads BR: como funciona, créditos, as campanhas no ar, as pegadinhas da tela de criação e o **Changelog observado da Ads API** (o que a API faz de verdade, medido) |
| [`playbook-operacao-amazon.md`](./playbook-operacao-amazon.md) | Regras comerciais adotadas em 14/09: piso de 25% de margem e réguas de ACOS derivadas, recompra por curva ABC (vira feature, ver TODO), cupom de lançamento, ciclo mensal de reciclagem — e o que foi **rejeitado** do workshop de origem, com o porquê |
| [`pesquisa-de-mercado.md`](./pesquisa-de-mercado.md) | Método de pesquisa de mercado com o NEXO e o caso de validação (conta do Lucas, set/2026): 26 SKUs novos = ~31% do volume em 3 semanas; % de faturamento pendente até os preços postarem; consulta SQL para re-medir |
| [`mercado-livre-diferencial.md`](./mercado-livre-diferencial.md) | Levantamento do que dá para oferecer no ML que a concorrência não oferece (13/08) — pesquisa, não implementação |
| [`amazon-ads-especialista.pdf`](./amazon-ads-especialista.pdf) | Material de estudo (18 páginas): leilão, correspondências, matemática do lance, colheita, benchmarks 2026, COSMO/Rufus, glossário PT↔EN. Fonte em `amazon-ads-especialista.html` |
| [`ferramentas-locais.md`](./ferramentas-locais.md) | Scripts de apoio que rodam fora do app: monitor de estoque FBA, seed do workspace demo, contas de avaliação |
| [`conexoes-que-expiram.md`](./conexoes-que-expiram.md) | Por que a autorização de cada canal cai, o que o app já detecta/mostra e o backlog para evitar (self-authorization da Amazon, vencimento de 365 dias da Shopee) |
| [`contas-de-avaliacao.md`](./contas-de-avaliacao.md) | Contas de teste com prazo: como criar, consultar, estender e excluir; o que a pessoa vê; por que o vencimento bloqueia em vez de apagar |

## Planos e ideias

| Doc | O que tem |
|---|---|
| [`landing-nexo.md`](./landing-nexo.md) | Landing do NEXO: estrutura mapeada do dub.co, efeitos do midday.ai, três versões de hero, contadores e os riscos a resolver antes de publicar. Esboço navegável em `/landing` |
| [`menu-lateral.md`](./menu-lateral.md) | Menu que encolhe: a mecânica medida no dub/DataDive (aside de largura fixa + painel `absolute` que abre por cima), por que a forma de duas calhas venceu, o botão de fixar e as bancadas em `/lab` |
| [`identidade-visual.md`](./identidade-visual.md) | Especificação canônica do front: marca, tokens, tipografia, cor semântica, shell, componentes, gráficos, movimento, estados, responsividade e checklist de continuidade |
| [`plans/plano-aquisicao-e-posicionamento.md`](./plans/plano-aquisicao-e-posicionamento.md) | GTM: aquisição e posicionamento |
| [`plans/seller-intelligence-plan.md`](./plans/seller-intelligence-plan.md) | Plano do Seller Intelligence (briefing diário de prioridades — ver ADR-008) |
| [`plans/migracao-coolify.md`](./plans/migracao-coolify.md) | Migração para self-hosted Coolify (ver ADR-006) |
| [`ai-agent-harness.md`](./ai-agent-harness.md) | Ideia/backlog: AI agent harness no produto |
| [`infra-decisao-hospedagem.md`](./infra-decisao-hospedagem.md) | Onde hospedar o NEXO: o que temos, as 4 opções e por que ficar no Render agora (19/08) — com os gatilhos medidos que reabrem a decisão |
| [`vercel-deploy.md`](./vercel-deploy.md) | Deploy na Vercel (Render permanece ligado durante a migração) |

## Compliance

| Doc | O que tem |
|---|---|
| [`compliance/personal-information-protection-standard.md`](./compliance/personal-information-protection-standard.md) | Padrão de proteção de dados pessoais |
| [`compliance/tiktok-review-response.md`](./compliance/tiktok-review-response.md) | Resposta à revisão do app TikTok |

## ⚠️ Conhecimento que NÃO está aqui

Nem tudo o que o projeto sabe está em `docs/`. Duas fontes ficam fora e são fáceis de
não encontrar:

| Onde | O que tem | Por que fora |
|---|---|---|
| `.claude/skills/gerenciar-ads/` | **Gerenciador de Amazon Ads**: motor de decisão, matemática do lance (com calculadora `scripts/lance.mjs`), ciclo de colheita e negativas, armadilhas da tela de criação, diagnóstico, benchmarks 2026 e os dados da conta NEXAHUB | ✅ **versionado desde 17/08/2026** |
| `.claude/skills/monitorar-ads/SKILL.md` | **Leitura e log**: cada leitura datada, mudanças aplicadas com data e hora, e o histórico da operação | ✅ versionado |
| `~/.claude/skills/pesquisa-produto-amazon/` | Análise de nicho por termo (menor preço FBA via `competitiveSummary`, BSR, margem) e comparação por atributo | Ferramenta pessoal, não faz parte do produto |

📌 **Antes de opinar sobre campanha de Ads, leia as duas skills.** Elas guardam o
histórico que o git não tem — inclusive erros já cometidos e a regra de que toda leitura
termina em **esperar**, **agir** ou **investigar**.

✅ **Resolvido em 17/08/2026.** As três skills nossas (`monitorar-ads`, `gerenciar-ads`,
`amazon-listing`) passaram a ser versionadas — o `.gitignore` libera só elas, mantendo de
fora o `settings.local.json` e as skills bundled da Anthropic.

📌 **Ao criar uma skill nova que valha guardar, adicione a exceção no `.gitignore`** — o
padrão continua sendo ignorar `/.claude/*`.

As fontes **versionadas** desse conhecimento são [`amazon-ads.md`](./amazon-ads.md) e
[`amazon-ads-especialista.html`](./amazon-ads-especialista.html) — as skills destilam esses
dois em procedimento.
