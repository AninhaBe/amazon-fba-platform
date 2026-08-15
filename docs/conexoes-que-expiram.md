# Conexões que expiram — por que caem e como evitar

Toda integração do SellerCore depende de uma autorização que o vendedor concedeu
e que **pode ser perdida**. Quando isso acontece, os dados param de entrar e o
painel fica "velho" sem avisar. Este doc mapeia as causas por canal, o que já
está feito e o que falta para reduzir a frequência.

Origem: em 06/08/2026 a conta Amazon `A15NQMF7A6J1Y0` parou de sincronizar com
`invalid_grant` e a tela mostrou apenas "Não foi possível abrir esta área" — o
tempo foi gasto investigando a Amazon quando a causa era autorização revogada
deste lado.

## O que o app faz hoje (implementado em 06/08/2026)

- **Detecta**: falha de refresh vira `ChannelAuthExpiredError`
  (`src/lib/integrations/authErrors.ts`), que a API devolve como HTTP 401 com
  `errorInfo.code = CHANNEL_AUTH_EXPIRED`. Na Amazon, `SpApiError` já trazia
  `AMAZON_AUTH_EXPIRED`.
- **Persiste**: ML e Shopee marcam a conexão como `disconnected` em
  `workspace_integrations` no momento da falha — o estado não se perde ao
  recarregar a página.
- **Mostra**: componente `ConnectionBroken` explica o motivo real e leva direto
  ao fluxo de reconexão do canal, em vez do erro genérico.
- **Não perde histórico**: os pedidos já ingeridos continuam no modelo canônico,
  então o painel segue mostrando o passado. Só para de entrar dado novo.

## Por canal: por que a autorização cai

### Amazon (SP-API)

| Causa | Evita? |
|---|---|
| Vendedor revoga o app no Seller Central | Não — é direito dele |
| App em **modo rascunho** autorizado com `version=beta` | **Sim** — ver abaixo |
| Não ser Primary User ao autorizar | Sim — autorizar com o usuário principal |

Hoje o app usa `SPAPI_APP_DRAFT` e envia `version=beta`
(`src/app/api/auth/login/route.ts`). Esse parâmetro existe para autorizar
aplicações em Draft. Há **dois caminhos** para sair dessa situação, conforme a
doc oficial:

1. **Self-authorization** (app privado, uso próprio ou poucas contas):
   *"You can self-authorize your application in draft status because there is no
   reason to publish a private application."* O refresh token é gerado direto no
   Solution Provider Portal / Seller Central, em **Authorize app**, sem passar
   pelo fluxo OAuth. Exige ser **Primary User** da conta autorizada.
   → https://developer-docs.amazon/sp-api/docs/self-authorization
2. **Publicar na Appstore** (necessário para vender o SellerCore a terceiros):
   remove o `version=beta` e usa OAuth normal. Depende de estar registrada no
   **Solution Provider Portal** — candidatura que está pendente (caso
   21250777631), portanto é caminho crítico para a Amazon virar canal de produto.

⚠️ Não está comprovado que autorizações beta expirem sozinhas por design; o que
se sabe do caso real é que o token foi revogado ou invalidado. Ao reconectar,
vale anotar a data para medir se cai de novo e em quanto tempo.

### Mercado Livre

| Causa | Evita? |
|---|---|
| **Refresh token rotativo**: cada refresh invalida o anterior | Sim — persistir sempre o novo (já feito) |
| Duas execuções renovando ao mesmo tempo | Sim — refresh deduplicado por conexão (já feito) |
| Vendedor revoga o app | Não |

O risco maior aqui é de implementação, e já está coberto: o adapter guarda o
token novo a cada refresh e serializa chamadas concorrentes.

### Shopee

| Causa | Evita? |
|---|---|
| Refresh token rotativo (mesma lógica do ML) | Sim — já tratado |
| **Autorização da loja vence em até 365 dias** | Não, mas dá para avisar antes |
| Vendedor revoga no Seller Centre | Não |

O vencimento em 365 dias é peculiar: mesmo com tudo funcionando, a conexão
morre na data. A data da autorização é guardada em `metadata.authorizedAt` no
callback, justamente para permitir o aviso.

### TikTok Shop

| Causa | Evita? |
|---|---|
| `access_token` curto, renovado pelo `refresh_token` | Sim — `refreshAccessToken` |
| **Autorização da loja nasce com 90 dias** — o vendedor pode estender | Sim — pedir para estender no ato |
| Vendedor revoga no Seller Center | Não |

⚠️ **O padrão são 90 dias, não 365 como a Shopee** — a janela nasce 4× mais curta.
**Mas o vendedor pode estender para ilimitado**, e é isso que se deve pedir no
momento da autorização: um clique dele evita a re-autorização trimestral.

✅ **Nossa conexão está ilimitada.** Reverificado no Partner Center em **14/08/2026**:
autorização `7671858184827848468` (loja Crystal Fancy, `7494291387899806731`) com
`Authorization period: Unlimited (Extended)` e status *Active*. O histórico mostra
*"Client extended the authorization — Extended until: unlimited (valid until seller
deauthorizes)"* em **09/08/2026 21:57**.

📌 **Lição de manutenção, não de API.** Este doc afirmava "válida de 09/08 a
07/11/2026" e estava **correto quando foi escrito** — a loja estendeu para ilimitado
poucas horas depois, na noite do mesmo dia. Prazo copiado de tela envelhece sem avisar;
por isso a data agora vem sempre com **a data em que foi verificada**.

O prazo conta da autorização, não do último refresh: renovar token não estende a data.
Se a autorização for a de 90 dias e vencer, o vendedor precisa passar pelo link de
convite de novo.

## O que falta (backlog, em ordem de valor)

1. **Avisar antes de quebrar.** O cron já roda a cada 5 min; quando marcar uma
   conexão como `disconnected`, exibir isso na central e em `/integracoes` — hoje
   o aviso só aparece ao abrir a tela do canal.
2. **Alerta de vencimento da Shopee**: avisar a 30 dias de completar 365 dias
   desde `authorizedAt`, enquanto ainda dá para reautorizar sem interrupção.
3. **Amazon: migrar para self-authorization** nas contas próprias — é o método
   que a Amazon indica para app privado e não depende de publicação.
4. **Destravar o Solution Provider Portal** — sem ele a Amazon nunca vira canal
   vendável, só de uso interno.
5. **Registrar o histórico de quedas** (quando caiu, quanto tempo ficou fora):
   é o que permite saber se o problema é recorrente ou foi um evento isolado.
