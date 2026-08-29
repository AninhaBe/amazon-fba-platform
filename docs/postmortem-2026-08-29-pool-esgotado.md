# Postmortem — o banco parou de aceitar conexão (29/08/2026, 02:10–02:17Z)

- **Duração:** ~7 minutos de indisponibilidade real (02:10Z → 02:17Z)
- **Impacto:** toda tela que lê dado. O app não conseguia obter conexão; os
  quatro syncs falhavam a cada ciclo.
- **Causa raiz:** duas escritas longas (9 min e 3 min) em
  `workspace_marketplace_orders` monopolizando os poucos slots de servidor do
  pooler, em modo `transaction`.
- **Resolvido:** sozinho, quando as escritas terminaram.
- **Ação humana durante o incidente:** scheduler interno desligado
  (`INTERNAL_SCHEDULER=0`), o que reiniciou a máquina.

## Linha do tempo (UTC)

| Hora | O quê |
|---|---|
| ~02:10 | Duas `INSERT INTO workspace_marketplace_orders` começam e **não terminam** |
| 02:10–02:14 | Log da máquina: `ECHECKOUTTIMEOUT ... after 15000ms in Transaction mode`, severity `FATAL`. `[scheduler] tiktok-sync: HTTP 500 em 15s`, `mercado-livre-sync falhou: timeout`, a cada ~1min45 |
| 02:12 | Sondas locais falham nas **duas** portas do pooler (6543 `ECHECKOUTTIMEOUT`, 5432 timeout de autenticação) |
| 02:13 | Segundo instrumento independente (outro terminal, outro processo) reproduz a falha — descarta artefato de script |
| 02:14:41 | `fly secrets set INTERNAL_SCHEDULER=0` → máquina reinicia |
| 02:15–02:16 | **Ainda falha.** O reinício não resolveu |
| ~02:16 | Conexão **direta** (fora do pooler, IPv6) revela o estado real |
| ~02:17 | Pool volta a responder. Cinco medições seguidas em ~5 min, zero falha |
| 02:23 | Confirmado: 0 consultas longas, 14 conexões, pool em ~200ms |

## O mecanismo — e ele era desconhecido dos dois lados

Em modo `transaction`, o Supavisor prende um slot de servidor **pela duração da
consulta**. Uma `INSERT` de 9 minutos prende o slot por 9 minutos. Com poucos
slots, todo `checkout` novo estoura em 15s — e foi o que aconteceu com o app e
com as sondas.

⚠️ **A parte que ninguém sabia:** as consultas **sobreviveram ao reinício da
máquina**. O cliente (o app) morreu às 02:14, mas a conexão de **servidor** do
Supavisor continua viva e o Postgres segue executando o comando. As duas
escritas ficaram **órfãs**: ninguém esperava o resultado e elas seguiam ocupando
o pool.

É por isso que reiniciar não resolveu — e reiniciar era a ação "óbvia".

## As três hipóteses que perseguimos, e por que cada uma caiu

| Hipótese | Por que parecia | Por que caiu |
|---|---|---|
| **1. A carga que eu mesmo pus** (28 etapas de sync + sondas contra produção) | Coincidiu no tempo; eu era o candidato mais honesto | As etapas terminaram, e a falha **persistiu depois do reinício**. A medição direta mostrou que quem ocupava o pool eram duas escritas do sync, não as minhas |
| **2. A migração para o modo `transaction`** (v159, mesma noite) | O erro cita literalmente `in Transaction mode` | A porta **5432 (session) também falhava**. Se as duas caem, o problema é o pooler saturado, não o modo. E `idle in transaction` era **0** em todas as amostras — nenhuma transação segurando conexão |
| **3. O incidente público da Supabase** (`Partially Degraded Service`, impacto major) | Janela de instabilidade declarada, na nossa região | O componente é o **PostgREST**, caminho diferente do Supavisor. E a última atualização deles (01:25Z) dizia que já havia recuperado — a nossa falha começa **depois** disso. Além disso: 18 de 60 conexões e **nenhum lock**, ou seja, o banco não estava saturado |

📌 A hipótese 2 merecia morrer com destaque: ela era a mais confortável de
acusar (mudança recente, mesma noite) e a mais fácil de "consertar" revertendo. A
autorização de rollback estava dada e **não foi usada**, porque a evidência não
apontava para lá. Reverter teria gasto um deploy no meio de um incidente e não
teria mudado nada.

## O que nos cegou: um health check que não toca o banco

Durante o incidente, `/api/health` respondeu **200 em ~1s, várias vezes**. Nós
dois lemos isso como "o app está de pé" e escrevemos, em reportes, que "quem já
está dentro continua servindo".

Era falso. O endpoint é, inteiro:

```ts
return NextResponse.json({ ok: true });
```

Nenhuma query. **Um health check que não toca a dependência não é health check —
é um teste de que o processo subiu.** E nós o lemos como disponibilidade porque
ele deu verde na hora em que queríamos verde.

O `401` rápido de `/api/products` e `/api/auth/accounts` também não servia de
prova: a autenticação responde **antes** de consultar o banco.

Quem respondeu a pergunta foram os **logs da máquina** — `ECHECKOUTTIMEOUT` com
severity `FATAL` dentro do processo do app, o que provava que não era a sonda,
era o app.

**Conserto:** o health check passa a executar uma consulta trivial com timeout
curto e devolver não-200 quando o banco não responde.

## Método — o que funcionou

1. **Confirmação por segundo instrumento.** Duas sondas, terminais e processos
   diferentes, concordando. Isso descartou "artefato do script" em segundos.
2. **Medir antes de mexer.** A ação óbvia (cancelar as escritas, reverter o
   pooler, reiniciar de novo) foi segurada até haver medição.
3. **Olhar o outro lado do pooler.** A conexão **direta** (IPv6, fora do
   Supavisor) foi o único instrumento que enxergou `pg_stat_activity` real. Sem
   ela, o diagnóstico teria ficado em hipótese.
4. **Conferir se o sintoma ainda existe antes de agir.** O cancelamento das
   escritas foi preparado e **não executado**: quando a autorização chegaria, o
   pool já respondia em 200ms. Agir ali seria mexer num estado que não existia
   mais.

## Pendências que este incidente abriu

- **`INSERT` de bronze que leva 9 minutos.** Enquanto uma escrita puder prender
  o pool por minutos, este incidente se repete sozinho. Suspeita registrada: o
  **índice de expressão sobre `payload`** (ADR-022) torna a escrita cara.
  Frente própria — medir antes de propor.
- **Scheduler sem freio de emergência no código.** Desligá-lo exigiu
  `fly secrets set`, que reinicia a máquina. Um interruptor que não derrube o
  app seria melhor.
- **Sonda contra produção compete com o app da dona.** Toda medição futura
  precisa considerar isso — e não só o `DB_POOL_MAX`, que limita o cliente e não
  o custo de cada consulta.
