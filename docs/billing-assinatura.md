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

## Sync: só sincroniza quem tem acesso

Decisão da dona do produto em 07/09/2026, verbatim: *"basicamente todos que não
estão com assinatura ativa, pode pausar"*.

**O sync pausa exatamente quando o acesso está bloqueado** — mesma fronteira da
tranca, mesmos quatro casos:

| assinatura | trial | sync | por quê |
|---|---|---|---|
| `cortada` | qualquer | **pausa** | cortou, parou |
| ausente | vencido | **pausa** | quem não vê o dado não precisa dele |
| ausente | ativo | continua | avaliação sem dado não converte ninguém |
| ausente | ausente | continua | o mundo interno de hoje |

(`ativa` continua em qualquer combinação: é o sinal específico.)

### Uma regra, uma fonte — e como isso é provado

A tranca decide em TypeScript (`decidirAcesso`), o scheduler decide em SQL
(`filtroDeAcessoLiberado`). Como SQL não roda em JavaScript, a equivalência não
é promessa: `tests-integracao/acessoPausaSyncEquivale.test.mjs` roda os **sete**
casos nos dois motores e compara um a um. `scripts/prova-equivalencia-acesso.mjs`
roda a mesma conferência contra qualquer banco, **só lendo**.

⚠️ **Isso não é zelo — pegou um defeito na primeira execução.** A primeira versão
do SQL protegia um cast com RegExp escrita dentro de template literal: `\d` virou
`d`, o filtro nasceu comparando com `^d{4}-d{2}-d{2}T` e a conta de trial vencido
**continuava sincronizando**. Passou na leitura em voz alta. É a mesma família do
`` virando BACKSPACE já registrada no `AGENTS.md`.

Por isso o filtro hoje **não usa RegExp nem cast**: compara `endsAt` como texto
ISO. O cast também era perigoso por outro motivo, medido — uma única linha com
`endsAt` malformado devolve `invalid input syntax for type timestamp with time
zone` e **derruba a consulta do canal inteiro, para todos os inquilinos**.

### Por que é filtro e não uma coluna

A **retomada é de graça**: nada é marcado ao cortar, nada precisa ser desmarcado
ao reativar. No ciclo seguinte a conexão volta a ser eleita com o `covered_from`
intocado e o scheduler recupera a janela parada pelo caminho que já usa. Uma
coluna `pausada` exigiria lembrar de limpá-la — e o dia em que alguém esquecesse,
a conta paga ficaria muda.

E o filtro **não olha `sync.status`**: reusar a coluna de status daria dois
significados a ela, que é a família que custou 11 horas de varredura parada em
03/09/2026.

### Efeito medido em produção (07/09/2026, sem escrever nada)

Elegíveis hoje: **7 → 6**. A única conexão que passa a pausar é a
`amazon:A16J64DRXI7OAU` (workspace `4f73ae94`), cujo trial venceu em 26/08 e que
sincronizava enquanto a pessoa levava 403 em toda tela. As contas com registro
nenhum — a da dona, a do colega, as de demonstração — **não são afetadas**.

⚠️ **Se essa conta precisar voltar a sincronizar, o caminho é estender o trial
dela no banco — nunca uma exceção no código.** Exceção no código vira a próxima
salvaguarda temporária que sobrevive à limitação que a justificou; um `endsAt`
novo é reversível, visível e não mente.

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
- **07/09/2026** — a fronteira do sync passou de "só cortada" para "todos que
  não estão com assinatura ativa", por decisão da dona, e passou a **derivar da
  mesma decisão da tranca**. A tradução para SQL nasceu errada (RegExp comida
  pelo template literal) e foi pega pela primeira execução da prova de
  equivalência, não pela revisão.
- **07/09/2026** — a tranca das rotas de dado **já existia** e eu havia relatado
  o contrário na medição da manhã: cortei um `grep` com `head -12` e tratei a
  truncagem como o conjunto. O que faltava era a navegação, a porta de volta, o
  sinal próprio, a pausa do sync, o checkout e os e-mails.
