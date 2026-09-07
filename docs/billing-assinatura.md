# Assinatura — como o dinheiro vira acesso

Mapa do caminho inteiro: visitante → paga → conta ativa → e-mails. Medido em
07/09/2026 e redesenhado no mesmo dia, por decisão da dona do produto.

## A regra, em uma frase

**Conta cortada ou avaliação vencida não abre nenhuma tela e não sincroniza
nada; conta sem registro nenhum passa.** A última metade é a que protege o mundo
de hoje: ausência é *"não se aplica"*, nunca *"não pagou"*.

## As peças

| peça | arquivo | o que faz |
|---|---|---|
| decisão | `src/lib/billing/acesso.ts` | `decidirAcesso({assinatura, trial})` → `{liberado, motivo}`. Pura, testada nos dois lados da fronteira. |
| leitor | `src/lib/billing/acessoDoServidor.ts` | `lerAcesso(workspaceId)` — lê `workspace_settings.assinatura` + trial e chama a decisão. |
| portão das rotas | `src/lib/workspaceContext.ts` | `withAuthenticatedWorkspace` devolve **403** com `errorInfo.motivo`. |
| portão da navegação | `src/app/(app)/layout.tsx` | redireciona para `/reativar?motivo=…`. |
| porta de volta | `src/app/reativar/page.tsx` | **fora** do grupo `(app)`, senão a tranca a barraria e mandaria para ela mesma. |
| pagamento | `src/app/api/billing/checkout/route.ts` + `src/lib/billing/checkoutStripe.ts` | cria a Checkout Session. Preço vem da Stripe (`STRIPE_PRICE_ID`). |
| webhook | `src/app/api/webhooks/stripe/route.ts` + `src/lib/billing/*` | traduz evento → intenção → estado. |
| pausa do sync | `src/lib/integrations/assinaturaPausaSync.ts` | fragmento SQL usado pelos 6 eleitores de conexão. |
| e-mails | `src/lib/billing/emailsDaAssinatura.ts` | boas-vindas e cobrança recusada, pelo Resend. |

## A fronteira, escrita

| assinatura | trial | resultado | motivo |
|---|---|---|---|
| — | — | **passa** | `sem-registro` |
| — | ativo | passa | `trial-ativo` |
| — | vencido | **bloqueia** | `trial-vencido` |
| `ativa` | qualquer | passa | `assinatura-ativa` |
| `cortada` | qualquer | **bloqueia** | `assinatura-cortada` |

A assinatura decide primeiro quando existe. Sem essa precedência, quem paga
depois da avaliação vencer não conseguiria entrar — o defeito mais caro possível
nesta tela.

## As exceções à tranca, e por que cada uma existe

- **`/api/trial`** (`allowExpiredTrial`) — é a rota que *alimenta* o aviso.
- **`/api/billing/checkout`** (`allowExpiredTrial`) — quem está cortado é
  exatamente quem precisa pagar. Sem esta, a tranca vira prisão.
- **`/reativar`** — fora do grupo `(app)`, pelo mesmo motivo.
- **13 rotas sem guarda**: 5 cron, 3 webhooks, `/api/health`, `/api/vivo`, o
  formulário público de orçamento e 2 de admin (que têm guarda própria, `comAdmin`,
  404 para não-admin). Conferido em 07/09/2026: 81 rotas, 68 com guarda.

Crescer essa lista é decisão, não acidente: `tests/trancaDaAssinatura.test.mjs`
conta quantas rotas ignoram a tranca e fica vermelho quando o número muda.

## Sync: "cortou, parou"

O filtro olha `workspace_settings.assinatura`, **nunca** `sync.status` — reusar a
coluna de status daria dois significados a ela, que é a família de defeito que
custou 11 horas de varredura parada em 03/09/2026.

A **retomada é de graça**, e é por isso que o desenho é um filtro e não uma
escrita: nada é marcado ao cortar, nada precisa ser desmarcado ao reativar. No
ciclo seguinte a conexão volta a ser eleita com o `covered_from` intocado e o
scheduler recupera a janela parada pelo caminho que já usa.

**Medido em 07/09/2026, contra produção, sem escrever nada** (CTE sombreando
`workspace_settings`): eleitos para a Amazon passaram de **3 para 3** com o filtro
e assinatura ausente — *nenhuma regressão para as contas de hoje* — e de **3 para
2** ao cortar a conta `4f73ae94`, com as outras duas intactas.

⚠️ **O que o filtro NÃO cobre:** conta com **avaliação vencida** e sem assinatura
continua sincronizando. Isso é intencional — a ordem foi sobre conta cortada. Se
mudar, o lugar é um só, e está escrito no próprio arquivo.

## E-mails

| quando | assunto | observação |
|---|---|---|
| primeira ativação ou volta depois do corte | "Sua assinatura do NEXO está ativa" | conta nova recebe a menção à senha; quem volta, não |
| `invoice.payment_failed` | "Não conseguimos processar o pagamento do NEXO" | **não** corta ninguém, e o texto diz isso |

Nenhum dos dois cita valor: o recibo com o preço é da Stripe. Falha de envio é
**log, nunca exceção** — e-mail que não sai não pode fazer a Stripe reentregar o
evento de um pagamento que deu certo.

O e-mail de **criação de senha** não sai daqui: é o convite do Supabase
(`inviteUserByEmail`), que usa o SMTP configurado no painel do Supabase.

## O que ainda falta (FASE B — depende da conta de produção)

1. Trocar `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` pelas chaves LIVE.
   ⚠️ São chaves **únicas**, não há par teste/produção: no instante da troca o
   sandbox para de funcionar.
2. Criar o produto e o preço LIVE e pôr o id em `STRIPE_PRICE_ID`.
3. Registrar o endpoint do webhook na conta de produção.
4. Conferir no painel da Stripe se o **recibo automático** está ligado.
5. Conferir no painel do Supabase que o SMTP é o Resend e que o template pt está lá.

## Changelog observado

- **07/09/2026** — `billing_stripe_events` tinha **uma** linha desde sempre
  (`checkout.session.expired`, 27/08, ignorado): o webhook já provara que
  *recebe*, mas o caminho de pagamento confirmado nunca fora exercido, nem no
  sandbox. `workspace_settings` não tinha nenhuma assinatura gravada.
- **07/09/2026** — a tranca das rotas de dado **já existia** e eu havia relatado
  o contrário na medição da manhã: cortei um `grep` com `head -12` e tratei a
  truncagem como o conjunto. O que faltava era a navegação, a porta de volta, o
  sinal próprio, a pausa do sync, o checkout e os e-mails.
