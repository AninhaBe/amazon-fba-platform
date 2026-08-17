<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# O produto se chama NEXO

**SellerCore é o nome antigo.** Em qualquer texto que uma pessoa lê — tela, doc novo,
mensagem, commit — o produto é **NEXO**.

⚠️ **Isso NÃO autoriza um find-and-replace.** O identificador `sellercore` continua vivo
de propósito em três lugares que quebram se você mexer:

| Onde | Por que não trocar |
|---|---|
| `sellercore.onrender.com` | Está cadastrada como **Redirect URI** na allowlist da Shopee e do TikTok. Trocar a URL **quebra o OAuth** dos dois canais. |
| `admin@sellercore.test`, `admin2@sellercore.test` | Contas reais no banco de produção. |
| Nomes de variável, arquivo e tabela | Renomear é churn sem ganho e conflita com tudo em andamento. |

A renomeação de verdade precisa de plano próprio (qual allowlist atualizar, em que ordem)
e **não foi pedida**. Está registrada em `TODO.md` → "Marca NEXO". Até lá: **texto novo diz
NEXO, identificador existente fica quieto.**

# Comece por aqui

**`docs/estado-atual.md`** — foto de onde cada frente parou, o passo exato para
retomar o que está no meio do caminho e o que está bloqueado esperando terceiros.
Leia antes de propor trabalho: metade do que parece "faltando" já está feito, e
parte do que parece pronto está esperando aprovação de marketplace.

Depois, `docs/README.md` para o mapa completo da documentação.

# Qualidade e segurança vêm antes de "só entregar"

Você não é só um desenvolvedor de features — é um dev responsável também por
**qualidade de software** e **segurança/vulnerabilidades**. Antes de fazer
qualquer coisa, bata o que vai fazer contra estes requisitos e só entregue
quando os cumprir:

- **Requisitos primeiro.** Entenda o que o pedido realmente exige (funcional e
  não-funcional) antes de codar. Se algo estiver ambíguo ou faltando, esclareça —
  não saia implementando por cima de suposição.
- **Qualidade por padrão.** Legibilidade, consistência com o padrão do código já
  existente, casos de borda, tratamento de erro e validação. Nada de meia-feature,
  gambiarra ou código morto. Ao terminar, revise se está limpo e coerente.
- **Segurança por padrão.** Não exponha segredos, valide entrada não-confiável,
  cubra rotas com auth, respeite RLS/menor privilégio e nunca deixe nada "aberto".
  Ao mexer em algo sensível (auth, tokens, storage, dados de conta), revise o
  impacto de segurança **antes** de concluir e sinalize qualquer brecha.

Regra prática: antes de dar por pronto, confirme os três — **funciona, está limpo,
não abre brecha**. Só então entregue.

# Arquitetura e decisões — leia antes de implementar

A arquitetura é **fonte de verdade no repo**. O mapa completo da documentação está em
`docs/README.md`. Antes de implementar algo que toque dados, sync, cache, auth ou um
canal, leia o(s) doc(s) relevante(s) — não re-deduza:

- Visão geral, contexto e mapa de arquivos: `docs/architecture/overview.md`
- Modelo canônico: `docs/architecture/canonical-model.md` (+ `docs/canonical-schema.md`)
- Ingestão e cron: `docs/architecture/sync-engine.md`
- Leitura por SQL e cache: `docs/architecture/read-and-cache.md`
- Decisões e trade-offs (o **porquê**): `docs/adr/`

**Não mude uma decisão arquitetural enquanto implementa.** Se uma feature exigir
mudar, **pare, explique e proponha um novo ADR** (`docs/adr/`) antes de codar.

# APIs dos marketplaces

Antes de mexer em qualquer integração, leia a documentação interna — ela registra os endpoints usados e as pegadinhas já pagas caro (semântica de PATCH da Amazon, regra de faturamento do ML, etc.):

- `docs/api-amazon-sp-api.md` — SP-API: endpoints, selectors do PATCH, orderMetrics vs Transactions, FNSKU/FBA
- `docs/api-mercado-livre.md` — ML: endpoints, regra do faturamento (aprovadas+canceladas, sem frete), webhooks
- `docs/api-shopee.md` — Shopee Open Platform v2 (**implementada; aguardando Go Live para conectar loja real**): assinatura HMAC validada em sandbox, OAuth, escrow, limites reais (janela de 15 dias, 50 pedidos por detalhe), App Types
- `docs/conexoes-que-expiram.md` — por que a autorização de cada canal cai e como evitar

Cada doc de API termina num **"Changelog observado"** (datado, mais recente primeiro).
Os marketplaces mudam comportamento sem aviso — ao esbarrar numa mudança nova, registre
lá na hora.

# Como este projeto trata dado incerto

Três regras que atravessam o código todo e não são negociáveis sem ADR:

- **`null` ≠ `0`.** Taxa, frete ou custo desconhecido é `null`; zero é um fato
  ("não houve frete"). Confundir os dois corrompe lucro, margem e a cobertura
  que o dashboard exibe.
- **Não extrapolar.** Enquanto tarifas e fretes não estiverem completos, o painel
  mostra só o que foi capturado e diz que está parcial — nunca projeta o resto.
- **Tela sem dado mostra o estado real** ("conecte uma loja", "sincronização
  pendente"), nunca zeros que pareçam "não vendeu nada".
