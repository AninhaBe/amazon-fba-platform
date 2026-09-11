# Assinatura — como o dinheiro vira acesso

Mapa do caminho inteiro: visitante → paga → conta ativa → e-mails. Medido em
07/09/2026 e redesenhado três vezes no mesmo dia, por decisão da dona do produto.

## A regra, em uma frase

**Só entra e só sincroniza quem tem assinatura ativa — ou é admin. Todo o resto
bloqueia e pausa.** Não existe período de avaliação: o que substitui a
experimentação é a **garantia de 7 dias**, que é dinheiro de volta, não acesso
adiantado.

Modelo v3, verbatim: *"nao tem mais trial, todos os planos passam a valer com o
pagamento, mas sera os 7 dias de garantia caso a pessoa queira cancelar, e ela
recebe o dinheiro de volta"*.

## As peças

| peça | arquivo | o que faz |
|---|---|---|
| decisão | `src/lib/billing/acesso.ts` | `decidirAcesso({admin, assinatura})` → `{liberado, motivo}`. Pura. |
| quem é admin | `src/lib/adminAllowlist.ts` + `src/lib/adminWorkspaces.ts` | a allowlist do `/admin` (`ADMIN_EMAILS`) traduzida para `workspace_id` por consulta a `auth.users`. |
| leitor | `src/lib/billing/acessoDoServidor.ts` | `lerAcesso(workspaceId)` — uma consulta traz e-mail e assinatura, e chama a decisão. |
| portão das rotas | `src/lib/workspaceContext.ts` | `withAuthenticatedWorkspace` devolve **403** com `errorInfo.motivo`. |
| portão da navegação | `src/app/(app)/layout.tsx` | redireciona para `/reativar?motivo=…`. |
| porta de entrada | `src/app/reativar/page.tsx` | **fora** do grupo `(app)`. Serve quem nunca assinou **e** quem cancelou. |
| pagamento | `src/app/api/billing/checkout/route.ts` + `checkoutStripe.ts` | Checkout Session. Preço vem da Stripe (`STRIPE_PRICE_ID`). |
| garantia de 7 dias | `src/lib/billing/garantiaDeSeteDias.ts` + `reembolsoStripe.ts` | decide e executa a devolução no cancelamento. |
| webhook | `src/app/api/webhooks/stripe/route.ts` + `src/lib/billing/*` | traduz evento → intenção → estado. |
| pausa do sync | `src/lib/integrations/assinaturaPausaSync.ts` | fragmento SQL usado pelos 6 eleitores de conexão. |
| e-mails | `src/lib/billing/emailsDaAssinatura.ts` | boas-vindas, cobrança recusada e os dois de cancelamento. |
| seed da demo | `scripts/semear-acesso-demo.mjs` | assinatura interna para as contas 100% de demonstração. |

## A fronteira, escrita

| admin | assinatura | resultado | motivo |
|---|---|---|---|
| **sim** | qualquer | **passa** | `admin` |
| não | `ativa` | passa | `assinatura-ativa` |
| não | `cortada` | **bloqueia** | `assinatura-cortada` |
| não | outro valor | **bloqueia** | `assinatura-cortada` |
| não | ausente | **bloqueia** | `sem-assinatura` |

Três decisões com um defeito atrás de cada:

1. **Admin primeiro, sem olhar mais nada.** Se dependesse da assinatura, um corte
   acidental trancaria justamente quem precisa entrar para consertá-lo. A exceção
   é ancorada na **mesma allowlist do `/admin`**, nunca num `workspace_id`
   escrito no código: id fixo seria uma segunda allowlist que ninguém revisa
   junto com a primeira.
2. **Só `"ativa"` libera; qualquer outro valor bloqueia.** O tipo admite dois
   valores, mas o dado vem de JSON: se um dia chegar `"pausada"`, o desconhecido
   **para** em vez de abrir. Mesma escolha do `currentWorkspaceId()`, que lança
   em vez de devolver um padrão.
3. **O trial ficou dormente, não foi removido.** As colunas e o `src/lib/trial.ts`
   continuam existindo e **não concedem nada**. Remover a infra é limpeza
   própria. Enquanto viver, há guarda nos dois motores reprovando quem religar a
   leitura — porque o efeito seria conta antiga entrando sem pagar.

### As três versões do mesmo dia

| versão | regra | por que caiu |
|---|---|---|
| v1 (manhã) | sem registro **passa** | era o mundo inteiro: nenhuma conta tinha assinatura |
| v2 (tarde) | admin e trial ativo passam; resto bloqueia | apertada pela dona |
| v3 (agora) | só admin e assinatura ativa | o trial deixou de existir como modelo |

### Quem fica de fora, medido antes do apply

| conta | v3 | conexões |
|---|---|---|
| `admin@` / `admin2@` | passa (`admin`) | 3 + 3 |
| `+trial` (demo) | passa (`assinatura-ativa`, semeada) | 3 |
| `+tiktokreview` (demo) | passa (`assinatura-ativa`, semeada) | 4 |
| `emmanuvitorio` | **bloqueia** | 1 |
| `trial.sellercore` | **bloqueia** | 0 |

**1 conexão de 14 passa a pausar.** Para reviver uma conta bloqueada o caminho é
o dado — assinar, ou semear como interna —, nunca exceção no código.

### As contas de demonstração

Resolvidas por **dado**: `scripts/semear-acesso-demo.mjs` grava
`{status: "ativa", origem: "interna"}` para todo workspace cujas conexões são
**todas** de demonstração. O alvo sai de consulta, então a demo que alguém criar
amanhã entra sozinha.

⚠️ **A dívida que isso cria, por escrito:** a palavra `"ativa"` passa a significar
duas coisas — "pagou" e "é nossa" —, que é a família de defeito que já custou
caro aqui três vezes. O antídoto de hoje é o campo `origem`, que deixa a
diferença **legível**: qualquer contagem futura de assinantes ou receita filtra
por ele em vez de contar demonstração como cliente. Se doer mais que isso, a
conversa é sobre um estado próprio — nunca sobre voltar a inventar exceção no
código.

Os `stripeCustomerId`/`stripeSubscriptionId` ficam **nulos** de propósito:
`buscarWorkspacePorStripe` só casa valor não-nulo, então nenhum evento real da
Stripe acerta uma conta semeada.

## A garantia de 7 dias

No cancelamento (`customer.subscription.deleted`), se a **primeira** cobrança da
assinatura foi há 7 dias ou menos, o valor é devolvido automaticamente e a pessoa
recebe o e-mail *"cancelado e reembolsado"*. Passados os 7 dias, cancela sem
devolução, com e-mail dizendo o que acontece com o acesso.

⚠️ **A janela conta da PRIMEIRA cobrança, nunca da última.** Se contasse da fatura
recorrente, toda renovação reabriria a garantia: no 13º mês, cancelar no dia
seguinte à cobrança devolveria o dinheiro. Por isso a listagem é ordenada
explicitamente em ordem crescente — a Stripe devolve as faturas da mais nova para
a mais velha, e pegar `data[0]` daria exatamente a fatura errada.

⚠️ **Reembolso duplicado é impossível por duas travas independentes:** o
`Idempotency-Key` derivado da assinatura (que a Stripe honra por 24h) e a
pergunta à própria cobrança se ela já foi devolvida (que não expira). O ledger de
eventos protege contra a mesma entrega, não contra um segundo evento — por isso
nenhuma das duas é dispensável.

⚠️ **O corte vem antes do dinheiro**, e o reembolso **nunca derruba** o
processamento. Se a ordem fosse inversa e o processo morresse no meio, a conta
ficaria aberta com o pagamento já devolvido. Falha de reembolso vira registro no
desfecho do evento, para alguém olhar.

📌 **Uma lição de teste que ficou daqui:** eu escrevi um teste afirmando que "a
idempotência é conferida antes da janela" e ele ficou **verde** quando movi a
checagem para o fim — porque todos os outros ramos já devolvem `false`, então a
ordem não mudava desfecho nenhum. A ordem só pesa contra o único ramo que devolve
`true` cedo: a cobrança datada no futuro. O teste foi reescrito para exercer
exatamente esse caso.

## Os dois caminhos até a conta ativa

Sem trial, a ordem "cria conta → paga" deixou de ser a única, e a outra já
existia sem ninguém ter olhado:

- **A — conta antes do pagamento:** o webhook acha o workspace por e-mail e
  libera. **Não** convida de novo: mandaria "crie sua senha" para quem já tem.
- **B — pagamento antes da conta:** o webhook convida por e-mail
  (`inviteUserByEmail`) e grava a assinatura **ativa** na mesma passada. Se a
  conta só ficasse ativa depois da senha, a pessoa pagaria, entraria e seria
  mandada de volta para pagar.

Pagamento sem e-mail e sem cliente conhecido **não inventa conta** — adivinhar
seria mexer no workspace errado.

## As exceções à tranca, e por que cada uma existe

- **`/api/trial`** (`allowExpiredTrial`) — é a rota que *alimenta* o aviso da
  interface. Dormente junto com o resto do trial.
- **`/api/billing/checkout`** (`allowExpiredTrial`) — quem está sem assinatura é
  exatamente quem precisa pagar. Sem esta, a tranca vira prisão.
- **`/reativar`** — fora do grupo `(app)`, pelo mesmo motivo: dentro, a própria
  tranca a barraria e mandaria para ela mesma, em laço.
- **13 rotas sem guarda**: 5 cron, 3 webhooks, `/api/health`, `/api/vivo`, o
  formulário público de orçamento e 2 de admin (que têm guarda própria,
  `comAdmin`, 404 para não-admin). Conferido: 81 rotas, 68 com guarda.

Crescer essa lista é decisão, não acidente: `tests/trancaDaAssinatura.test.mjs`
conta quantas rotas ignoram a tranca e fica vermelho quando o número muda.

### ⚠️ A tranca mora no layout de `(app)` — quem fica fora dele não passa por ela

`/lab/*` **não está no grupo `(app)`**. Consequência exata, e ela não é acidente:
o proxy exige **sessão** (em produção `/lab` não está em `publicPaths`, então
visitante sem login leva redirect para `/login`), mas a **tranca não é aplicada**,
porque quem a aplica é `src/app/(app)/layout.tsx`. Um workspace **logado e
inadimplente alcança `/lab/*`**.

Hoje isso é inofensivo e de propósito: `/lab` é protótipo visual — sem dado real,
sem API atrás. A assimetria está registrada aqui porque o dia em que alguém puser
**dado real numa página de `/lab`**, ela nasce sem tranca e **nada fica vermelho**
para avisar. A guarda que existe (`tests/trancaDaAssinatura.test.mjs`) conta
**rotas de API** sem guarda; página fora de `(app)` não entra nessa conta.

**Na prática:** página que serve dado de workspace mora **dentro de `(app)`**.
Se precisar mesmo ficar fora, ela chama `lerAcesso()` por conta própria — e o
motivo de estar fora fica escrito ao lado da chamada.

📌 Vale para **qualquer** rota fora de `(app)`, não só `/lab`. `/reativar` já é o
caso legítimo e está logo acima: ela fica fora **porque** a tranca a barraria e a
mandaria para ela mesma, em laço. A diferença entre as duas é que uma escolheu
ficar fora e disse por quê; a outra ficou fora por ser protótipo — e é essa que
envelhece calada.

⚠️ E a mesma fronteira vale para **código de bancada**: instrumento que existe
para desenhar (dado de amostra, intercepto de `fetch`, atalho de acesso) precisa
**morrer de produção por construção** — guarda de `NODE_ENV` no código, nunca
aviso em comentário. Encontrado em 11/09/2026 na leva do redesign do ML: um
atalho de `lerAcesso` por variável de ambiente, e um intercepto global de
`window.fetch` sem desinstalação que servia dado de exemplo às telas reais e
respondia `{ ok: true }` a `/api/costs` sem persistir nada. Os dois se anunciavam
locais em comentário; comentário não é guarda.

## Sync: só sincroniza quem tem acesso

**O sync pausa exatamente quando o acesso está bloqueado** — a mesma fronteira da
tranca, sem uma segunda regra ao lado:

| admin | assinatura | sync | por quê |
|---|---|---|---|
| sim | qualquer | continua | chave-mestra, por definição |
| não | `ativa` | continua | pagou |
| não | `cortada` | **pausa** | cortou, parou |
| não | outro | **pausa** | desconhecido para tudo |
| não | ausente | **pausa** | nunca assinou |

### Uma regra, uma fonte — e como isso é provado

A tranca decide em TypeScript (`decidirAcesso`), o scheduler decide em SQL
(`filtroDeAcessoLiberado`). Como SQL não roda em JavaScript, a equivalência não é
promessa: `tests-integracao/acessoPausaSyncEquivale.test.mjs` roda todos os casos
da fronteira nos dois motores e compara um a um.
`scripts/prova-equivalencia-acesso.mjs` roda a mesma conferência contra qualquer
banco, **só lendo**.

⚠️ **Isso não é zelo — pegou dois defeitos na primeira execução.**

1. Uma RegExp escrita dentro de template literal: `\d` virou `d`, o filtro nasceu
   comparando com `^d{4}-d{2}-d{2}T` e a conta bloqueada **continuava
   sincronizando**. Passou na leitura em voz alta. Mesma família do `\b` virando
   BACKSPACE já registrada no `AGENTS.md`.
2. Um `::timestamptz` sobre valor vindo de JSON: uma única linha malformada
   devolve `invalid input syntax for type timestamp with time zone` e **derruba a
   consulta do canal inteiro, para todos os inquilinos**.

Por isso o filtro **não usa RegExp nem cast**, e há guarda de unidade proibindo os
dois — a próxima condição com data vai encontrar a armadilha já sinalizada.

⚠️ **E o filtro é assíncrono desde que resolve os ids de admin.** Interpolar
`${filtroDeAcessoLiberado("sync")}` direto no template escreveria
`[object Promise]` na consulta, e **o TypeScript aceita calado** — para ele é só
uma string. A guarda exige a variável já resolvida na consulta e o `await` no
arquivo.

### Por que é filtro e não uma coluna

A **retomada é de graça**: nada é marcado ao cortar, nada precisa ser desmarcado
ao reativar. No ciclo seguinte a conexão volta a ser eleita com o `covered_from`
intocado e o scheduler recupera a janela parada pelo caminho que já usa. Uma
coluna `pausada` exigiria lembrar de limpá-la — e o dia em que alguém esquecesse,
a conta paga ficaria muda.

E o filtro **não olha `sync.status`**: reusar a coluna de status daria dois
significados a ela, que é a família que custou 11 horas de varredura parada em
03/09/2026.

## E-mails

| quando | assunto | observação |
|---|---|---|
| primeira ativação ou volta depois do corte | "Sua assinatura do NEXO está ativa" | conta nova recebe a menção à senha; quem volta, não |
| `invoice.payment_failed` | "Não conseguimos processar o pagamento do NEXO" | **não** corta ninguém, e o texto diz isso |
| cancelamento dentro dos 7 dias | "Assinatura cancelada e valor devolvido" | o prazo do estorno é do banco, e o texto não promete data |
| cancelamento depois dos 7 dias | "Assinatura do NEXO cancelada" | não fala em devolução — prometer estorno que não vem é pior que o cancelamento |

Nenhum deles cita valor: o recibo com o preço é da Stripe. Falha de envio é
**log, nunca exceção** — e-mail que não sai não pode fazer a Stripe reentregar o
evento de um pagamento que deu certo.

O e-mail de **criação de senha** não sai daqui: é o convite do Supabase
(`inviteUserByEmail`), que usa o SMTP configurado no painel do Supabase.

## O que ainda falta (FASE B — depende da conta de produção)

1. Trocar `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` pelas chaves LIVE.
   ⚠️ São chaves **únicas**, não há par teste/produção: no instante da troca o
   sandbox para de funcionar.
2. Criar o produto e o preço LIVE e pôr o id em `STRIPE_PRICE_ID` — que **ainda
   não existe nem em teste**, então o botão de pagar devolve 503 até alguém pôr.
3. Registrar o endpoint do webhook na conta de produção.
4. Conferir no painel da Stripe se o **recibo automático** está ligado.
5. Conferir no painel do Supabase que o SMTP é o Resend e que o template pt está lá.
6. ⚠️ **Antes do deploy da tranca:** confirmar que `ADMIN_EMAILS` no Fly contém
   `admin@sellercore.test` **e** `admin2@sellercore.test`. Se faltar uma, aquela
   conta é trancada para fora do próprio produto no instante do deploy. O teste é
   abrir `/admin` com cada uma: 200 é admin, 404 não é.

## Changelog observado

- **11/09/2026** — registrada a assimetria de **quem fica fora do grupo `(app)`**:
  o proxy exige sessão, mas a tranca não alcança essas rotas, porque ela mora no
  layout de `(app)`. Vale hoje para `/lab/*` (protótipo, sem dado), e a nota
  existe para o dia em que alguém puser dado real lá — nada ficaria vermelho.
  Veio da auditoria da leva do redesign do ML, que trouxe junto dois instrumentos
  de bancada atravessando para produção (atalho de `lerAcesso` por variável de
  ambiente, e intercepto global de `window.fetch` sem desinstalação). Ambos
  barrados antes de subir. A regra que ficou: **instrumento de desenho morre de
  produção por construção — guarda de `NODE_ENV` no código, nunca em comentário.**
- **07/09/2026 (v3)** — o trial saiu do modelo: só assinatura ativa e admin
  entram, e a experimentação virou **garantia de 7 dias**. As contas de
  demonstração passaram de trial semeado para assinatura interna, porque o trial
  deixou de conceder qualquer coisa.
- **07/09/2026 (v2)** — "sem registro" deixou de passar e as contas de admin
  viraram exceção explícita, derivada da allowlist do `/admin`.
- **07/09/2026** — a fronteira do sync passou a **derivar da mesma decisão da
  tranca**. A tradução para SQL nasceu errada (RegExp comida pelo template
  literal) e foi pega pela primeira execução da prova de equivalência, não pela
  revisão.
- **07/09/2026** — `billing_stripe_events` tinha **uma** linha desde sempre
  (`checkout.session.expired`, 27/08, ignorado): o webhook já provara que
  *recebe*, mas o caminho de pagamento confirmado nunca fora exercido, nem no
  sandbox.
- **07/09/2026** — a tranca das rotas de dado **já existia** e eu havia relatado
  o contrário na medição da manhã: cortei um `grep` com `head -12` e tratei a
  truncagem como o conjunto.
