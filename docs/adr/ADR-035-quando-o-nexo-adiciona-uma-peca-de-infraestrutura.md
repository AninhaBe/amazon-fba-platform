# ADR-035: Quando o NEXO adiciona uma peça de infraestrutura

- **Status:** Aceito
- **Data:** 2026-08-30
- **Relacionado:** [ADR-002](./ADR-002-cache-swr.md) ·
  [ADR-018](./ADR-018-ingestao-por-evento.md) ·
  [ADR-019](./ADR-019-agendador-interno.md) ·
  [ADR-023](./ADR-023-notificacoes-da-amazon.md) ·
  [ADR-028](./ADR-028-modo-do-pooler-e-teto-de-conexoes.md) ·
  [ADR-030](./ADR-030-fundo-nao-compete-com-a-tela.md) ·
  [ADR-032](./ADR-032-quanto-o-nexo-pode-perguntar-a-um-marketplace.md) ·
  [postmortem de 29/08](../postmortem-2026-08-29-pool-esgotado.md)

> ## A regra
>
> **Peça nova de infraestrutura entra por GATILHO MEDIDO, nunca por antecipação.**
> Hoje a resposta é **não** para microserviços, cache distribuído e fila externa —
> e cada "não" está escrito abaixo com o **número que o transforma em sim**.
>
> Antes de propor qualquer peça, responda duas perguntas: **qual medição mostra
> que ela é necessária?** e **quantas conexões ela abre contra as 15 que o
> projeto inteiro tem?** Sem as duas respostas, a proposta não está pronta.
>
> Se você só for ler uma linha deste documento daqui a um ano, é esta.
>
> ⚠️ **E se você veio aqui para escalar o app: vá primeiro para a
> [seção 5](#5-pré-requisito-da-segunda-máquina-o-desvio-do-lease).**
> `fly scale count > 1` hoje **dobra chamada a marketplace** por um caminho
> específico do código, e ele tem endereço.

## Contexto

Esta semana o NEXO teve **dois apagões em 29/08/2026** por esgotamento do pooler.
A investigação mostrou uma coisa que muda o critério de arquitetura do produto:

📌 **O recurso escasso do NEXO não é CPU, memória ou disco. É conexão de banco.**
O projeto inteiro tem **15 conexões de servidor** no Supavisor
([ADR-028](./ADR-028-modo-do-pooler-e-teto-de-conexoes.md)) — e "o projeto
inteiro" quer dizer o app, os crons, as migrations, as sondas e qualquer script
que alguém rode do notebook contra produção.

O orçamento atual, em `src/lib/db.ts`, está assim:

| Pool | `max` | Quem usa |
|---|---:|---|
| Usuário | **8** | requisições que a Ana está esperando |
| Fundo | **5** | sync dos 4 canais, webhook do ML, `after()` |
| **Total do app** | **13** | de 15 |
| Margem | **2** | migration e sonda |

**Sobram duas conexões.** É esse o tamanho do espaço livre em que qualquer peça
nova precisa caber. Um serviço novo não é "mais um processo": é **mais um pool**
contra as mesmas 15.

E a topologia de hoje é deliberadamente pequena: **uma máquina no Fly**
(`min_machines_running = 1`, `auto_stop_machines = false`), **agendador dentro do
processo web** ([ADR-019](./ADR-019-agendador-interno.md)), **sem worker separado**
([ADR-023](./ADR-023-notificacoes-da-amazon.md)).

Este ADR existe porque a pergunta "e quando a gente adiciona X?" vai voltar — e a
resposta certa não é um veredito, é um **gatilho observável**. Pedido literal da
dona: *"registra os gatilhos como ADR"*.

## Decisão

**Nenhuma das quatro peças entra hoje.** Cada seção abaixo traz o mecanismo do
"não" e o gatilho que muda a resposta.

---

## 1. Microserviços — não, e "tempo real" é argumento CONTRA

### O erro de categoria

O pedido de microserviços costuma vir junto com "a gente precisa de tempo real".
Isso confunde duas coisas que não têm relação:

📌 **Tempo real aqui é um padrão de INGESTÃO (push), não uma topologia.**
O que deixa o dado fresco é o marketplace **avisar** em vez de a gente
**perguntar** ([ADR-018](./ADR-018-ingestao-por-evento.md)). A prova já está no
código: o `FRESH_FOR_MS` do Mercado Livre é o mesmo 6h da Amazon, e o ML está
fresco assim mesmo — **por causa do webhook, não da topologia**
([ADR-023](./ADR-023-notificacoes-da-amazon.md)).

Fatiar o monólito não deixa nada mais fresco. Quem deixa é o push, e o push
funciona **dentro** do processo que já existe.

### Motivo concreto nº 1: cada serviço abre pool próprio contra as MESMAS 15

Um serviço separado não compartilha o `Pool` do `db.ts` — ele instancia o seu.
Com 13 das 15 conexões já comprometidas, **um único serviço novo com `max: 5`
estoura o teto do projeto**. Não é "fica apertado": é o mesmo `EMAXCONNSESSION` /
`timeout exceeded when trying to connect` que derrubou a produção em 29/08.

Fatiar em três serviços, no orçamento de hoje, significa **tirar conexão da tela
da Ana** para dar a eles. O custo da separação é cobrado exatamente do recurso
mais escasso que o produto tem.

### Motivo concreto nº 2: a duplicação de lógica viraria versões diferentes NO AR

Esta semana foram dois dias consertando conta financeira — frete que não era
custo da vendedora, anúncio fora do lucro, tarifa estimada, faturamento bruto vs.
conciliado. Esses defeitos existiam **em mais de um lugar dentro de um único
repositório**, e mesmo assim custaram dois dias para achar e alinhar.

Em serviços separados, o mesmo defeito vira **versões diferentes rodando ao mesmo
tempo**: o serviço A já corrigido, o B ainda não implantado, e a tela mostrando
um número que não bate com o outro. O trabalho de dois dias viraria trabalho
permanente — e o sintoma seria "os números não fecham", que é o pior sintoma
possível num produto cujo valor é justamente fechar os números.

### 🎯 Gatilho para reabrir

> **Um pedaço do sistema com perfil de escala genuinamente diferente do resto,
> MEDIDO** — não "a gente cresceu".

Medição que fecha: pelo contador de chamadas
(`workspace_marketplace_api_calls`, migration 0019) e pelas métricas do Fly,
um componente que consuma **≥ 60% do CPU ou das conexões do processo** de forma
sustentada por **≥ 7 dias**, e cuja curva de crescimento seja **descolada** da
das telas (ex.: ingestão crescendo com nº de pedidos enquanto as telas crescem
com nº de contas).

Mesmo aí, a resposta provável é a **seção 4** (grupo de processo), não
microserviço: ela resolve o isolamento sem duplicar código nem multiplicar pools.

---

## 2. Cache distribuído — o gatilho é a SEGUNDA MÁQUINA, não uma data

### Como o cache vive hoje

[ADR-002](./ADR-002-cache-swr.md) tem duas camadas, e a distinção importa:

| Camada | Onde vive | Sobrevive a deploy? | Compartilhada entre máquinas? |
|---|---|---|---|
| `cached()` (`memoryCache.ts`) | **memória do processo** | ❌ morre | ❌ não |
| `swr()` (`workspace_persistent_cache`) | **Postgres** | ✅ | ✅ **já é** |

📌 A camada persistida **já é compartilhada** — ela mora no banco. O problema de
divergência atinge **só a camada de memória**, e isso reduz o tamanho do
incômodo antes mesmo de medir. É mais um motivo para não comprar peça no escuro.

É também por isso que o `fly.toml` proíbe `auto_stop_machines`: máquina que
hiberna perde a camada de memória.

### O que acontece com duas máquinas

Cada máquina passa a ter **o seu** `memoryCache`. Duas abas da Ana atendidas por
máquinas diferentes podem mostrar números diferentes por até um TTL. Isso é real
e não se resolve sozinho.

### ⚠️ A ordem certa, e ela é o ponto desta seção

A tentação é **comprar antes de medir** — subir um Redis "porque agora são duas
máquinas". A ordem correta é:

1. **Subir a segunda máquina.**
2. **Deixar cada uma com o seu cache de memória.**
3. **MEDIR se a divergência incomoda** — e "incomoda" tem definição, não é
   sensação.
4. **Só então** comprar peça.

### 🎯 Gatilho para reabrir

> **Existir a segunda máquina E a divergência ser medida como incômoda.**
> A segunda máquina sozinha **não** autoriza a peça.

Medição que fecha: com N ≥ 2 máquinas, comparar a mesma chave de cache servida
por instâncias diferentes na mesma janela. Vira gatilho se **a mesma pergunta
devolver números diferentes em ≥ 1% das cargas de tela**, ou se aparecer **uma
única reclamação da dona de "o número mudou sozinho"** — a segunda condição vale
por si, porque confiança no número é o produto.

Antes de comprar Redis, avaliar a alternativa barata: **encurtar o TTL da camada
de memória e empurrar mais chaves para a camada Postgres**, que já é
compartilhada. Peça nova só se essa não resolver.

---

## 3. Fila de mensagens — a gente JÁ TEM uma, e ela funciona

### A fila que já existe

`workspace_marketplace_events`, no Postgres:

```
status: 'pending' | 'complete' | 'error'
attempts, processing_at, processed_at, last_error
PRIMARY KEY (workspace_id, provider, event_key)   ← idempotência por construção
```

Medido em 29/08/2026 ([ADR-018](./ADR-018-ingestao-por-evento.md)):

```
mercado_livre  complete   35.791
mercado_livre  pending       207
mercado_livre  error           3
```

**4.032 eventos nas últimas 24h.** A fila recebeu tudo, guardou tudo, deduplicou
tudo pela chave primária e registrou o erro dos 3 que falharam.

### ⚠️ Os 207 parados foram defeito no DRENO, não na fila

Este é o ponto que impede a conclusão errada. Ninguém perdeu evento; **207
eventos ficaram `pending` por 13 horas porque o consumidor não os buscou.**
Trocar Postgres por SQS/RabbitMQ **não conserta um consumidor que não consome** —
só muda onde a mensagem parada fica esperando, e tira a visibilidade de poder
perguntar `SELECT status, count(*)` com uma linha de SQL.

Regra derivada: **fila que não drena é o modo de falha nº 1 de push, e é
silencioso.** O alarme mora no dreno, não na tecnologia da fila.

### 🎯 Gatilho para reabrir — e ele muda QUEM decide

> **O push da Amazon.** A SP-API **não posta em endpoint HTTP**: os únicos
> destinos são **SQS** e **EventBridge** ([ADR-023](./ADR-023-notificacoes-da-amazon.md)).

📌 Escreva assim, porque muda quem decide: **a fila da AWS entra como PREÇO DO
PUSH da Amazon, não como preferência de arquitetura.** Não é escolha nossa — é
requisito do fornecedor. Quem quiser citar esta seção para justificar "vamos
adotar filas" está citando errado: o que ela autoriza é **uma** fila, **de um**
fornecedor, para **um** canal que não aceita outra coisa.

E mesmo aí o desenho já está decidido e é conservador: o SQS é **lido pelo
agendador interno que já roda**, e o evento cai **na mesma caixa de entrada**
`workspace_marketplace_events`. Nenhum processo novo; a fila da AWS é um
transporte, não a nova espinha dorsal.

Segundo gatilho, independente da Amazon: **o dreno no Postgres virar gargalo
medido** — contenção de lock ou latência de claim acima de ~100ms sustentada, com
`EXPLAIN (ANALYZE, BUFFERS)`. Nada perto disso foi observado; o volume atual é
~4 mil eventos/dia.

---

## 4. Processo separado — o único que eu recomendo, e não é microserviço

### O coração deste ADR: a pergunta da dona

> *"a cada aumento de máquina teria um agendador lá dentro também, executando o
> mesmo job"*
> — Ana, 29/08/2026

**Ela está certa, e essa é a consequência mais cara de escalar hoje.**

O agendador vive **dentro** do app (`src/instrumentation.ts`, gancho `register`,
armado por `INTERNAL_SCHEDULER=1`). Escalar o app para N máquinas sobe **N
agendadores**, cada um disparando o mesmo ciclo dos quatro canais.

### A proteção que existe é PARCIAL, e o "parcial" tem endereço

Existe lease no banco (`workspace_marketplace_syncs.lease_until`), com fencing:
o próprio `lease_until::text` é o token, e quem perdeu o lease falha ao escrever.
Isso protege contra **escrita duplicada**.

⚠️ **Mas o lease só protege a CHAMADA EXTERNA se for reivindicado ANTES dela.**
Se a chamada vier primeiro, duas máquinas perguntam ao marketplace e só depois
descobrem que uma delas não devia — a escrita fica correta e **as chamadas
dobram**. Chamada dobrada ao marketplace é exatamente o comportamento que rendeu
o **alerta de comportamento anormal da Shopee** em 29/08
([ADR-032](./ADR-032-quanto-o-nexo-pode-perguntar-a-um-marketplace.md)).

### 🔍 Campo aberto — a verificação da ordem, com a medição ao lado

Na forma adotada em 29/08: **toda pendência de "não sabemos se X" nasce com a
medição que a resolve ao lado.**

**O que já foi verificado na leitura de código (30/08/2026), e não fecha a
pendência:**

- ✅ **Importação de janela da Amazon:** o lease é reivindicado **antes** das
  chamadas de janela (`amazonSync.ts:408`, o `UPDATE ... RETURNING` vem antes do
  laço de `getOrders`). Ordem correta.
- ⚠️ **Caminho de conciliação da Amazon, quando o lease NÃO é ganho**
  (`amazonSync.ts:417`–`435`): o passo **não retorna**. Ele segue para
  `reverifyPendingById`, `reverifyUpdatedOrders`, `syncMissingOrderItems`,
  `syncMissingOrderFees` e `ingerirRelatorioDePedidos` — **todas com chamada
  externa, nenhuma sob lease**. É deliberado hoje (com **uma** máquina não há
  concorrente), mas significa que **este caminho não tem proteção nenhuma contra
  N agendadores**. Com 2 máquinas, essas chamadas dobram.
- ⚠️ **Shopee:** o claim de conciliação (`shopeeSync.ts:722`) é próprio e vem
  antes do trabalho — ordem correta —, mas ele é o **remendo** descrito no
  [ADR-034](./ADR-034-conciliacao-e-passo-proprio.md), não o desenho final.
- ❔ **Mercado Livre e TikTok:** não auditados nesta passagem.

**A medição que resolve:** com o contador da migration 0019 já no ar, subir o
grupo `web` para 2 máquinas em **janela combinada e curta**, e comparar
`chamadas` por `(provider, endpoint, hora)` contra a hora anterior com 1 máquina.

- **Decide "ordem correta"**: contagem por endpoint **≈ igual** (variação dentro
  do ruído normal do dia).
- **Decide "ordem errada"**: qualquer endpoint com contagem **≈ 2× (≥ 1,7×)**.
- **Bloqueia o teste**: se a auditoria de código dos 4 canais já mostrar chamada
  externa fora de lease — como a de cima mostra para a Amazon —, **corrigir a
  ordem primeiro**. Não se mede duplicação contra um marketplace que já abriu
  alerta contra a gente; a hipótese aqui já tem evidência suficiente para virar
  conserto antes de virar experimento.

Enquanto essa verificação não fechar, **escalar o grupo web para N > 1 está
condicionado à solução (a) abaixo** — e o furo já confirmado na Amazon, mais a
auditoria pendente do ML e do TikTok, viraram **portão com nome próprio na
[seção 5](#5-pré-requisito-da-segunda-máquina-o-desvio-do-lease)**.

### Solução (a): GRUPO DE PROCESSO no Fly — recomendada

Mesmo código, mesmo repositório, mesmo deploy, **dois entrypoints**:

| Grupo | Escala | O que roda |
|---|---:|---|
| `web` | **N** | atende as telas; `INTERNAL_SCHEDULER` **desligado** |
| `scheduler` | **1** | o agendador e o trabalho de fundo |

Resolve duas coisas de uma vez:

1. **A duplicação de agendador** — N máquinas de tela, **um** agendador.
2. **A competição por CPU e conexão** dentro do processo que atende a Ana. É a
   continuação natural do [ADR-030](./ADR-030-fundo-nao-compete-com-a-tela.md):
   lá o fundo ganhou pool próprio; aqui ele ganha **processo** próprio.

#### ⚠️ Por que isso NÃO é microserviço

Está explícito aqui porque alguém **vai** citar este ADR para justificar o
contrário:

| | Grupo de processo | Microserviço |
|---|---|---|
| Repositório | **um** | vários |
| Deploy | **um**, atômico | independentes |
| Versão no ar | **uma** | várias ao mesmo tempo |
| Lógica de negócio | **não duplica** | duplica ou vira contrato de rede |
| Pools de banco | **os mesmos dois** do `db.ts` | um por serviço |

📌 **A diferença que importa é a última linha.** O grupo de processo **não
adiciona pool novo**: a soma continua sendo o orçamento de 13 do `db.ts`, agora
distribuída entre grupos — e é obrigação de quem implementar **repartir**, não
duplicar (ex.: `web` fica com o pool de usuário, `scheduler` com o de fundo).
Microserviço adiciona pool. Contra 15 conexões, é a diferença entre "funciona" e
"apagão".

Nenhum dos dois "nãos" da seção 1 se aplica: não há duplicação de lógica e não há
pool novo.

### Solução (b): ADVISORY LOCK como cinto de segurança

O grupo de processo depende de **configuração** — alguém escala o grupo errado, e
volta a haver dois agendadores sem que ninguém perceba. O cinto é reivindicar o
tique no banco:

```sql
SELECT pg_try_advisory_xact_lock(hashtextextended('agendador:' || $1, 0));
```

#### ⚠️ A armadilha técnica: lock de SESSÃO em transaction mode

O NEXO conecta no pooler em **modo `transaction`** (porta 6543,
[ADR-028](./ADR-028-modo-do-pooler-e-teto-de-conexoes.md)): a conexão de servidor
**volta ao pool a cada transação**, e o comando seguinte pode sair por outra
conexão física.

📌 **`pg_advisory_lock` (escopo de SESSÃO) nesse modo é armadilha: você acha que
segurou e não segurou.** Pior — o lock fica preso numa conexão de servidor que
foi devolvida ao pool, e `pg_advisory_unlock` chamado depois pode nem chegar na
mesma conexão. Não é teoria: é a razão pela qual `databaseUrl.ts` documenta que
**os dois únicos locks do repositório são `pg_advisory_xact_lock`**, e por que a
sonda `scripts/pooler-mode-probe.mjs` exercita exatamente essa diferença nas duas
portas.

O que funciona é a **variante de transação** (`_xact_`), que vale **enquanto a
transação durar** e é liberada no `COMMIT`/`ROLLBACK` — inclusive se o processo
morrer:

| Serve para | Não serve para |
|---|---|
| "reivindicar **este** tique" | "manter liderança entre tiques" |
| seção crítica curta, dentro de uma transação | eleição de líder de longa duração |

O helper já existe: `withDbTransactionAdvisoryLock` (`db.ts:542`). **Liderança
duradoura, se um dia for preciso, se faz com lease em tabela + `now()`** — que é
o que os leases de sync já fazem —, **nunca com advisory lock de sessão.**

### Ordem de implementação

A ordem completa, com o desenho do lease que a dona fechou, está na
**[seção 6.6](#66-a-ordem-e-o-que-continua-na-frente-de-tudo)** — é a única lista
de ordem deste ADR, para não existirem duas se contradizendo daqui a seis meses.

---

## 5. Pré-requisito da segunda máquina: o desvio do lease

> ### 🚧 Portão
>
> **`fly scale count > 1` está bloqueado até este item fechar.** Não é
> recomendação: é pré-requisito. Enquanto existir caminho de código que faz
> chamada externa **sem** ter ganho o lease, a segunda máquina dobra pergunta ao
> marketplace — e a Shopee já abriu alerta de comportamento anormal contra o app
> em 29/08/2026 por esse tipo de comportamento.

### Por que isto virou seção, e não rodapé

Porque o defeito **não é uniforme**, e tratá-lo como "o sync não tem lease" seria
tão errado quanto "o sync tem lease". O caminho principal está certo; o que
existe é um **desvio**: quando o lease não é ganho, o passo não retorna — segue
para as rotinas de conciliação, todas com chamada externa e nenhuma sob claim.

E porque a semana inteira o padrão foi **consertar onde alguém apontou**. Apontar
a Amazon e assumir que os outros três são iguais repetiria exatamente esse erro,
nos dois sentidos: pode haver furo onde ninguém olhou, e pode haver conserto
desnecessário onde já está certo. Por isso cada canal abaixo tem estado próprio.

### Estado por canal (auditoria de 30/08/2026, leitura de código)

| Canal | Ordem lease → chamada externa | Estado |
|---|---|---|
| **Amazon** — janela | lease em `amazonSync.ts:408`, antes do laço de `getOrders` | ✅ correta |
| **Amazon** — conciliação | `amazonSync.ts:417`–`435`: sem o lease, o passo **não retorna** e chama `reverifyPendingById`, `reverifyUpdatedOrders`, `syncMissingOrderItems`, `syncMissingOrderFees`, `ingerirRelatorioDePedidos` | ❌ **furo confirmado** |
| **Shopee** | claim próprio em `shopeeSync.ts:722`, antes do trabalho | ⚠️ correta, mas é o **remendo** do [ADR-034](./ADR-034-conciliacao-e-passo-proprio.md) |
| **Mercado Livre** | — | ❔ **não auditado** |
| **TikTok** | — | ❔ **não auditado** |

### As pendências, cada uma com a medição que a resolve

Forma adotada em 29/08: **pendência de "não sabemos se X" nasce com a medição que
a resolve ao lado** — qual chamada, contra o que, o que decide.

**P1 — Fechar o desvio da Amazon.**
- *O que decide:* no caminho em que o lease não é ganho, ou o passo retorna, ou
  cada rotina de conciliação passa a ter **claim próprio antes da chamada
  externa** (o desenho do ADR-034).
- *Medição:* contador da migration 0019 — `chamadas` por
  `(provider='amazon', endpoint, hora)` estável antes e depois do conserto, com
  **uma** máquina. Se cair, alguma conciliação parou junto: é regressão, não
  sucesso. Fila que some é o modo de falha do escrow da Shopee.
- *Dono:* backend. **Bloqueia P3.**

**P2 — Auditar Mercado Livre e TikTok, item nomeado e não rodapé.**
- *O que decide:* para cada passo de sync dos dois canais, uma pergunta binária —
  *existe algum caminho que chama a API do canal sem ter ganho o lease/claim?*
  Resposta com arquivo e linha, como a tabela acima.
- *Medição, se a leitura de código ficar ambígua:* rodar o passo duas vezes em
  paralelo contra a **conexão de teste** e comparar o contador 0019 por endpoint.
  Dobrou, é furo.
- *Atenção:* o ML tem webhook, então o caminho disparado por evento precisa ser
  auditado **junto com** o do agendador — são dois gatilhos para o mesmo trabalho.
- *Dono:* backend. **Bloqueia P3.**

**P3 — Só então medir duplicação com duas máquinas.**
- *O que decide:* com P1 e P2 fechadas, subir o grupo `web` para 2 em janela
  combinada e curta e comparar `chamadas` por `(provider, endpoint, hora)` contra
  a hora anterior com 1 máquina. **≈ igual** = ordem correta em todo lugar;
  **≥ 1,7×** em qualquer endpoint = ainda há caminho sem claim.
- ⚠️ *Ordem invertida de propósito:* a versão anterior deste plano media primeiro
  e consertava depois. **Não se testa duplicação contra um marketplace que já
  abriu alerta contra a gente quando a auditoria de código já mostrou o furo.**
  Conserta primeiro, mede depois — e o que a medição vira é **confirmação**, não
  descoberta.

### Como este portão sai do caminho

Fechado P1, P2 e P3 — e implementado o **grupo de processo** (seção 4a) com o
`scheduler` em 1 —, a segunda máquina deixa de dobrar agendador e o portão cai.
O cinto do `pg_try_advisory_xact_lock` (seção 4b) continua valendo, para o dia em
que alguém escalar o grupo errado.

---

## 6. O desenho do agendador — fechado pela dona em 30/08/2026

> **"Process group + lease, porque resolvem problemas diferentes: o grupo garante
> que normalmente só exista um agendador; o lease protege se, por erro de
> configuração ou falha, dois tentarem o mesmo job."**
> — Ana, 30/08/2026

📌 **As duas peças não são redundantes, e é por isso que as duas entram.** O grupo
de processo é a regra; o lease é o que acontece quando a regra falha. Quem
implementar só uma das duas não implementou metade do desenho — implementou um
desenho diferente.

O desenho fechado tem **cinco peças**. As quatro primeiras são o mecanismo; a
quinta é o que impede o mecanismo de ser decoração.

### 6.1 O claim é atômico, e vem antes de qualquer chamada externa

```sql
UPDATE workspace_marketplace_syncs
   SET lease_owner = $owner,
       lease_until = now() + ($ttl || ' seconds')::interval,
       updated_at  = now()
 WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
   AND (lease_until IS NULL OR lease_until < now())
RETURNING lease_owner, lease_until;
```

Regras que esse comando carrega, e cada uma tem motivo:

- **Sem `SELECT` separado.** Ler e depois escrever abre janela entre os dois
  comandos — e no modo `transaction` do pooler os dois comandos podem nem sair
  pela mesma conexão de servidor. O `UPDATE ... WHERE ... RETURNING` **é** a
  decisão: quem recebe linha ganhou, quem recebe vazio perdeu.
- **`now()` é o relógio do BANCO, nunca o da aplicação.** Duas máquinas no Fly
  têm relógios que derivam; o banco é o único árbitro comum. Nenhum
  `Date.now()` entra nessa conta.
- **O predicado do claim não carrega significado de negócio.** O claim de hoje da
  Amazon exige `status <> 'complete'`, e foi exatamente isso que silenciou a
  conciliação da Shopee: *sucesso de uma etapa virou condição de parada de outra*
  ([ADR-034](./ADR-034-conciliacao-e-passo-proprio.md)). O claim pergunta **"tem
  dono?"**, e nada além disso.
- **Nada de `FOR UPDATE SKIP LOCKED`** aqui: o `UPDATE` de uma linha já é atômico,
  e o lock explícito só acrescentaria tempo de transação.

⚠️ **Falta coluna.** Hoje a tabela tem `lease_until` e usa `lease_until::text`
como token de fencing — não existe `lease_owner`. O desenho exige a coluna; é
migration de uma linha, e é do backend com aprovação de migration.

### 6.2 O lease dura mais que o job: TTL, renovação e dono

Os syncs medidos duram **129–170 segundos**. Um lease que expira no meio do job é
pior que não ter lease: outro worker assume enquanto o primeiro ainda está
escrevendo.

**A renovação é escopada pelo dono** — e este é o acréscimo que evita o pior modo
de falha:

```sql
UPDATE workspace_marketplace_syncs
   SET lease_until = now() + ($ttl || ' seconds')::interval
 WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
   AND lease_owner = $owner            -- ⚠️ sem isto, a renovação ROUBA
   AND lease_until > now();
```

📌 **Sem `lease_owner = $owner`, a renovação de um worker pode renovar o lease de
outro sem perceber — e aí os dois trabalham achando que cada um é o único. Isso é
PIOR que não ter lease nenhum**, porque o sistema fica confiante e errado ao mesmo
tempo: o defeito de 29/08 não foi o erro que apareceu, foi o silêncio.

**Os números saem de conta, não de gosto.** O TTL precisa ser maior que duas ou
três renovações (para tolerar um soluço de rede) e curto o bastante para que um
worker morto libere rápido:

| Parâmetro | Valor inicial | De onde sai |
|---|---:|---|
| Duração típica do job | 129–170s | medido |
| Intervalo de renovação | **30s** | ~5–6 renovações por job |
| TTL do lease | **90s** | 3× o intervalo; worker morto libera em ≤1min30 |

Os dois entram por **variável de ambiente**, porque a duração dos jobs muda
quando as consultas mudarem — e vai mudar: as 28 transações por carga ainda não
foram tocadas ([ADR-030](./ADR-030-fundo-nao-compete-com-a-tela.md), Pendências).

⚠️ **A renovação precisa de timeout próprio, bem abaixo do TTL.** O
`statement_timeout` padrão do pool é **120.000ms** (`db.ts`), maior que o TTL de
90s: uma renovação presa esperando o timeout padrão perderia o lease enquanto
espera, sem saber. A consulta de renovação roda com teto próprio na casa de
**5s** — ela é um `UPDATE` de uma linha por chave primária; se demorar mais que
isso, o problema já não é o lease.

### 6.3 Perder o lease é ZERO LINHAS, e o worker aborta

Não é preciso canal extra, heartbeat de rede nem coordenação: **se a renovação
afetar zero linhas, o worker perdeu.** `rowCount === 0` é o sinal, e ele é
fail-closed por construção — qualquer causa (outro dono, lease expirado, linha
sumida) leva à mesma conclusão segura: *pare*.

- O aborto acontece **entre chamadas**, nunca no meio de uma escrita.
- Isso é seguro porque **o sync já é idempotente por chave externa**: um trabalho
  interrompido na metade é retomado pelo próximo dono sem duplicar nada.
- Na prática: a renovação levanta uma bandeira, e o laço consulta a bandeira
  **antes de cada chamada externa** — que é a mesma regra da 6.1, aplicada
  durante o job em vez de no começo dele.

### 6.4 ⚠️ Nenhuma transação aberta durante chamada HTTP

> **"Nenhuma transação do banco fica aberta durante chamada HTTP."** — Ana

**Este é o ponto principal do desenho dela, e é o que amarra esta seção ao resto
do ADR.** Uma transação aberta prende uma conexão de servidor do pooler pelo
tempo inteiro da chamada externa. Com **13 conexões de 13** e um marketplace que
pode demorar segundos, é a receita exata das duas indisponibilidades de 29/08 —
com o agravante de que a espera seria por um terceiro, fora do nosso controle.

Consequência de desenho, e ela é inegociável:

| Fase | Transação | Duração |
|---|---|---|
| Claim (6.1) | abre e **fecha** | milissegundos |
| Chamada ao marketplace | **nenhuma aberta** | segundos |
| Escrita do resultado | abre e **fecha** | milissegundos |
| Renovação (6.2) | abre e **fecha**, a cada 30s | milissegundos |

É também o motivo pelo qual o cinto da seção 4b usa
`pg_try_advisory_xact_lock` e **não** o lock de sessão: um lock que precisasse
sobreviver à chamada HTTP exigiria exatamente a transação aberta que esta regra
proíbe. As duas decisões dizem a mesma coisa por caminhos diferentes.

### 6.5 A quinta peça: o teste que força a disputa — requisito, não sugestão

> ### ⚠️ Uma defesa que nunca é exercitada não é uma defesa
>
> **Com o grupo de processo em UMA máquina, o lease quase nunca vai disparar.**
> Ele só entra em ação no dia do acidente — e até lá ninguém sabe se funciona.
> Foi exatamente o que aconteceu com a cerca de commit, que o backend se recusou
> a chamar de testada porque **nunca tinha barrado nada**. Defesa que só roda no
> dia do acidente é decoração até lá.

Por isso o desenho tem uma quinta peça, e ela é **requisito de aceitação**: um
teste que force **dois workers a disputarem o mesmo lease** e prove três coisas.

| # | O que o teste prova | Como falha se estiver quebrado |
|---|---|---|
| 1 | **Um perde** — só um claim recebe linha | os dois recebem linha → claim não é atômico |
| 2 | **O perdedor NÃO faz chamada externa** — zero chamadas no cliente de marketplace falso | perdedor chama mesmo assim → é o desvio da seção 5, de novo |
| 3 | **O vencedor renova** — e a renovação do perdedor afeta zero linhas | perdedor consegue renovar → falta o `lease_owner` da 6.2 |

Regras do teste, para ele não virar outra decoração:

- **Roda na CI**, junto com o resto — não é script manual que alguém lembra de
  rodar.
- **Não toca marketplace nenhum**: o cliente externo é falso, e a asserção nº 2 é
  literalmente *"o falso não recebeu chamada"*. A prova mais importante é uma
  **ausência**, e ausência só se prova com o dublê contando.
- **Sinal em produção também**, porque teste verde não é operação verde: contar
  as vezes em que um worker perdeu o lease. Com uma máquina esse contador deve
  ficar em **zero**; se ele subir, ou alguém escalou o grupo errado, ou existe um
  segundo agendador que ninguém sabia que existia. Zero aqui é fato observado,
  não ausência de instrumento — a diferença que custou o alerta da Shopee.

### 6.6 A ordem, e o que continua na frente de tudo

> ⚠️ **O pré-requisito da [seção 5](#5-pré-requisito-da-segunda-máquina-o-desvio-do-lease)
> vem antes de todo este desenho.** Enquanto o passo seguir para as cinco rotinas
> de conciliação **depois de PERDER o lease**, o lease protege a porta da frente e
> a dos fundos fica aberta. Um lease impecável com um desvio aberto ao lado
> continua dobrando chamada ao marketplace — e ainda dá a sensação de estar
> protegido, que é o pior dos dois mundos.

1. **P1/P2 da seção 5** — fechar o desvio da Amazon, auditar ML e TikTok.
2. **6.1 + 6.2 + 6.3** — claim atômico, `lease_owner`, TTL/renovação, aborto por
   zero linhas.
3. **6.5** — o teste de disputa, verde na CI, e o contador de lease perdido no ar.
4. **Grupo de processo** (4a), `scheduler` em 1.
5. **Só então** `fly scale count > 1`, e a medição de cache da seção 2.

---

## Consequências

- ➕ A pergunta "podemos adicionar X?" passa a ter resposta verificável em vez de
  debate: **qual é a medição, e quantas conexões X abre.**
- ➕ Os quatro "nãos" ficam **datados e falseáveis** — quem vier daqui a seis
  meses não precisa ter vivido esta semana para saber o que mudaria a resposta.
- ➖ Enquanto o grupo de processo não existir e o portão da seção 5 não fechar,
  **o produto não pode escalar horizontalmente** — `fly scale count > 1` hoje
  dobra agendador e, no desvio confirmado da Amazon, dobra chamada a marketplace.
- ➕ A auditoria dos quatro canais deixou de ser "consertar onde alguém apontou":
  ML e TikTok estão registrados como **não auditados**, com a medição que fecha
  cada um — ausência de auditoria vira item nomeado, não silêncio.
- ➖ O teto de 15 conexões vira restrição de arquitetura explícita e **entra em
  toda proposta futura**. Levantá-lo (plano pago do Supabase) é uma decisão
  própria, e não está tomada aqui.
- ➕ O lease deixa de ser "proteção que existe" e passa a ser **proteção
  exercitada**: sem o teste de disputa da seção 6.5 verde, o desenho não está
  entregue. Defesa que só roda no dia do acidente é decoração até lá.
- ➖ Custo novo permanente: uma coluna (`lease_owner`), duas variáveis de ambiente
  (intervalo e TTL) e um teste que precisa continuar valendo quando a duração dos
  jobs mudar.
- 🔒 **Obrigatório a partir de agora:** toda proposta de peça nova responde
  "quantas conexões contra as 15" antes de qualquer outra coisa.
- 🔒 **E nenhuma transação fica aberta durante chamada HTTP** — regra da seção
  6.4, e vale para código novo em qualquer canal, não só para o agendador.

## Alternativas consideradas

- **Decidir cada peça quando o problema aparecer, sem registro.** Rejeitada: foi
  o que produziu, esta semana, uma discussão sobre microserviços em cima de um
  problema que era orçamento de conexão. Sem gatilho escrito, a discussão se
  repete com os mesmos argumentos.
- **Adotar as peças agora "para não retrabalhar depois".** Rejeitada pelo
  mecanismo da seção 1: no orçamento de 13/15 conexões, cada peça nova é cobrada
  do recurso mais escasso — o retrabalho evitado é hipotético, o apagão é medido.
- **Subir o plano do Supabase e resolver o teto com dinheiro.** Não rejeitada,
  apenas **fora do escopo deste ADR**: é decisão de custo da dona, e mesmo com
  teto maior os motivos nº 2 da seção 1 (duplicação de lógica) e o da seção 4
  (N agendadores) continuam valendo.
