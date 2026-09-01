# ADR-036: A separação entre clientes passa a ser do banco, não do `WHERE`

- **Status:** **Proposto** em 01/09/2026. **Reabre a [ADR-012](./ADR-012-contrato-0005-sem-runtime-role.md)** com motivo novo e mais forte. Não implementar antes do portão.
- **Data:** 2026-09-01
- **Origem:** auditoria de isolamento pedida pela Ana em 01/09/2026 — *"Integrações diferentes não podem misturar dados umas com as outras. Nossos futuros clientes não podem ter esse problema."*


## Os três critérios, no topo porque são critério e não detalhe

**1. O portador só pode ser `SET LOCAL`.** Um `SET` de sessão sobreviveria à
devolução da conexão ao pooler em modo `transaction` e **serviria outro
inquilino** — o vazamento que esta ADR existe para impedir, criado pelo próprio
mecanismo de defesa. Detalhe medido na seção 3.

**2. A policy é de graça; as idas ao banco é que custam.** Predicado: **+0,2 ms**,
resolvido como `One-Time Filter`. Transação explícita: **+48 ms**, três idas de
rede. Sem essa medição teríamos otimizado a policy e não o transporte.

**3. `WITH CHECK` é tão importante quanto `USING`.** Sem ele a role pode
**escrever** linha carimbada com o workspace de outro. Barreira que só protege
leitura não é barreira.

## Contexto

A auditoria respondeu a pergunta que a Ana fez: **não há mistura de dados entre
clientes reais.** Medido, tabela por tabela, nas 19 tabelas que têm
`workspace_id` e `connection_id`: zero linhas com conexão de outro workspace. O
único compartilhamento é entre as duas contas de demonstração, por construção.

Mas a mesma auditoria mediu **por que** não há mistura, e a resposta é
desconfortável:

| medida | valor |
|---|---|
| Tabelas com RLS **ativo** | **32** |
| Policies existentes | **0** |
| `relforcerowsecurity` | **false** em todas |
| Role da aplicação | `postgres` |
| `rolbypassrls` dessa role | **true** |

RLS ligado sem policy seria *fail-closed* para uma role comum. Mas a aplicação
conecta com uma role que **ignora RLS por completo** — e que, além disso, é
**dona das 32 tabelas**, o que dispensaria RLS mesmo sem o bypass, já que
`FORCE ROW LEVEL SECURITY` está desligado.

**Portanto: hoje a separação entre clientes é garantida inteiramente pelo
`WHERE workspace_id` que a aplicação escreve.** Não há nada abaixo. Uma rota nova
que esqueça o `WHERE` vaza, e nenhuma camada segura.

### Por que isto não contradiz a ADR-012

A ADR-012 removeu policies em 13/08/2026 ao constatar que eram `USING (true)` —
não protegiam nada e davam falsa sensação de proteção. **Aquela decisão estava
certa e não está sendo revertida.** O que mudou:

| ADR-012 (13/08) | agora (01/09) |
|---|---|
| Motivo: "a policy existente não protege" | Motivo: **"não existe barreira nenhuma"** |
| Contexto: um workspace, sem clientes | Contexto: **clientes reais chegando**, e a dona do produto exigindo isolamento |
| O que ficou de pé: `REVOKE` de `PUBLIC`/`anon`/`authenticated`/`service_role` | **Continua de pé e continua correto** — medido: essas roles não têm `SELECT` nas tabelas canônicas |

O que a ADR-012 protegeu — cliente público do Supabase sem privilégio — segue
protegido. O que ela não cobriu é a role da própria aplicação.

## Decisão

### 1. Uma role de runtime que não pode ignorar RLS

```sql
CREATE ROLE nexo_runtime LOGIN PASSWORD :'senha' NOBYPASSRLS;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexo_runtime;
```

`postgres` tem `rolcreaterole = true` (medido), então isto é executável sem
superusuário. A role **não é dona de nenhuma tabela** — se fosse, pularia a RLS
pelo bypass nativo do dono, e o desenho todo seria decoração.

⚠️ `service_role` também tem `rolbypassrls = true`. Ela não pode ser usada pela
aplicação em nenhuma hipótese, e isso precisa de teste, não de lembrança.

### 2. A policy, e de onde vem o workspace

```sql
ALTER TABLE <cada tabela> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <cada tabela> FORCE ROW LEVEL SECURITY;   -- alcança até o dono
CREATE POLICY inquilino ON <cada tabela>
  USING      (workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true));
```

O `WITH CHECK` é tão importante quanto o `USING`: sem ele a role poderia
**escrever** linha carimbada com o workspace de outro.

**Quem seta:** um único ponto em `src/lib/db.ts`, alimentado pelo
`workspaceScope.ts`, que já carrega o workspace autenticado em
`AsyncLocalStorage`. Nenhuma rota precisa lembrar de nada — é a mesma origem que
hoje alimenta o `WHERE`.

**O que acontece se ninguém setar — medido, não suposto:**

```
FAIL-CLOSED: linhas visíveis SEM set_config = 0
```

`current_setting('app.workspace_id', true)` devolve `NULL` quando não definido, a
comparação vira `NULL`, e a linha é filtrada. **Fail-closed por construção.** Não
existe caminho em que esquecer de setar mostre dado de outro.

### 3. O portador só pode ser `SET LOCAL`, e o motivo é o pooler

⚠️ **Esta é a restrição que manda no desenho inteiro.** A aplicação fala com o
Postgres na porta **6543 — modo `transaction`** (ADR-028, e `databaseUrl.ts`
força a porta em código). Nesse modo a conexão volta ao pool **a cada
transação**.

Consequência: um `SET` de sessão sobreviveria à devolução da conexão e serviria
**outro inquilino**. Seria o vazamento que este ADR existe para impedir,
introduzido pelo próprio mecanismo de defesa.

Portanto: **`SET LOCAL` (ou `set_config(..., true)`) dentro de transação
explícita, e nunca `SET` de sessão.** O aviso já está escrito em
`databaseUrl.ts` — *"se um dia entrar código que dependa de sessão, ele falha em
produção e não em teste"* — e esta ADR é o primeiro caso concreto dele.

**O que isso obriga a mudar:** hoje `dbQuery` usa `pool.query`, ou seja cada
consulta é sua própria transação implícita e não há onde pendurar o `SET LOCAL`.
Toda leitura precisa passar a rodar em transação explícita. **A mudança é em uma
função**, não em cada chamador, porque o workspace já vem do `AsyncLocalStorage`.

## Custo de desempenho — medido em produção, 01/09/2026

30 execuções por forma, mesma consulta real (contagem e soma de
`workspace_channel_orders` em 30 dias), pela porta 6543:

| forma | p50 | p95 |
|---|---|---|
| hoje: `pool.query` direto (1 ida) | **16,1 ms** | 19,6 ms |
| `BEGIN` + query + `COMMIT` | 47,8 ms | 51,0 ms |
| `BEGIN` + `set_config` + query + `COMMIT` | **64,2 ms** | 81,7 ms |
| idem, com o predicado da policy na consulta | 64,3 ms | 70,3 ms |

**O achado que muda a conversa: a policy é de graça; as idas ao banco é que
custam.**

- **Predicado da policy: +0,2 ms.** O planejador o resolve como **`One-Time
  Filter`** — avaliado uma vez, não por linha — e o `Index Only Scan` continua
  igual. `Execution Time` foi de 0,100 ms para 0,126 ms.
- **Transação explícita: +48 ms (+299%).** Não é o Postgres: são **três idas de
  rede a mais** (`BEGIN`, `set_config`, `COMMIT`), a ~16 ms cada pelo pooler.

### O que fazer com isso, e o que não fazer

O reflexo seria "uma transação por requisição em vez de por consulta". **Medido,
esse reflexo pode piorar.** As rotas de visão geral disparam várias consultas em
`Promise.all`, hoje paralelas em conexões distintas do pool. Uma transação por
requisição = uma conexão = **serializado**. Para seis consultas:

| forma | idas de rede | ordem de grandeza |
|---|---|---|
| hoje (6 em paralelo) | 6 | ~20 ms |
| 6 transações em paralelo | 24 | ~64 ms |
| 1 transação por requisição (serializada) | 9 | ~144 ms |

**Recomendação: transação por consulta, em paralelo** — 64 ms contra 144 ms. E
uma redução barata em cima disso: emitir `BEGIN` e o `set_config` numa **única
ida**, pelo protocolo simples, o que devolve ~16 ms. O `workspace_id` interpolado
aí precisa ser validado como UUID estrito antes de virar literal — e como o
Achado A do [plano de índice](../plans/indice-maior-que-a-tabela.md) mostrou que
os 99.420 valores **são** UUID, essa validação é honesta e não uma checagem
decorativa.

⚠️ **Isto precisa ser medido rota a rota antes de ligar**, contra o orçamento de
1s da ADR-017. O número acima é ordem de grandeza derivada de uma consulta, não
medição das rotas.

## O que quebra, e o caminho de cada um

Nada aqui é "provavelmente funciona": cada caminho precisa de decisão explícita
antes do apply.

| o que | por que quebra | caminho declarado |
|---|---|---|
| **Migrations / runner assinado** | DDL e leitura de catálogo em tabela sob RLS; e o runner não tem workspace | Continua em `postgres` (dono, `bypassrls`). **Não muda.** O runner é operacional, não runtime — é a separação que a ADR-012 já assume |
| **Scheduler / cron / sync de fundo** | Roda **sem usuário**: não há workspace para setar, e fail-closed faz ele ver **zero linhas** | ✅ **Decidido em 01/09/2026: opção (a)** — o fundo itera workspace a workspace e seta `app.workspace_id` em cada um, sujeito à mesma barreira que todo o resto. A opção (b), uma role `nexo_worker` com `bypassrls`, foi **recusada**: seria construir a barreira e já abrir uma porta de serviço nela — o buraco de hoje com outro nome. Ver o modo de falha logo abaixo |
| **Webhook do ML** | Chega sem sessão; o workspace vem do payload | Resolver o workspace **antes** de tocar o banco e entrar pelo mesmo caminho (a) |
| **Scripts de manutenção** (`db-size`, probes, curadoria) | Leem o banco inteiro, sem workspace | Seguem em `postgres`, fora do runtime. Já é assim |
| **`ensureSchema` / contrato 0005** | `db.ts` inspeciona catálogo na primeira consulta | Catálogo não é tabela sob RLS; segue funcionando. **Verificar no piloto** |
| **Pool de fundo (ADR-030)** | Mesmo problema do scheduler | Mesmo caminho |
| **`marketplace_api_calls`** | `workspace_id` é **`NULL` em 100% das 6.911 linhas** — nunca foi preenchido | ✅ **Classificada em 01/09/2026: é tabela de inquilino, entra na barreira.** Ver a seção abaixo |



### `marketplace_api_calls` — classificada pelo conteúdo, não pela conveniência

A pergunta certa não é "dá trabalho?", é **"tem dado de cliente ali?"**. Medido:

| coluna | conteúdo |
|---|---|
| `provider`, `endpoint`, `hora`, `chamadas`, `erros`, `ultimo_status`, `ultimo_limite` | telemetria de chamada |
| `connection_id` | **identifica a conta do vendedor** — `mercado_livre:1191100170`, `shopee:275804987` |
| `workspace_id` | **`NULL` em 6.911 de 6.911 linhas** |

E o `endpoint` **não é sempre template**. A maioria é (`/orders/v0/orders/:id`),
mas há 733 endpoints distintos com identificador de negócio literal:

```
/items/MLB6955574150
/items/MLB6444348218
```

São **anúncios reais**, com id do Mercado Livre, ligados a uma conta pela
`connection_id` da mesma linha.

**Veredito: não é telemetria pura. Entra na barreira.** E antes disso o
`workspace_id` precisa ser consertado — hoje ele é `NULL` em toda linha, então a
policy filtraria 100% da tabela. O conserto é derivável: `connection_id` diz a
conta, e `workspace_integrations` diz o workspace dela. Para as linhas com
`connection_id` nulo (TikTok 4.802 e Amazon 881), a origem precisa ser
investigada antes — não dá para adivinhar o dono.

📌 Enquanto o `workspace_id` não for preenchido, **esta tabela fica de fora da
Etapa 3** e entra numa etapa própria. Aplicar policy nela hoje apagaria a
telemetria inteira da tela.

### ⚠️ O modo de falha do trabalho de fundo precisa ser ALTO

Fail-closed é a propriedade certa para a tela e a **pior possível** para o
sincronizador, se ele for silencioso. Um passo do scheduler que rode sem setar
`app.workspace_id` enxerga **zero linhas** — e zero linhas é indistinguível de
"não havia nada para sincronizar".

**Sincronização vazia que parece sucesso é o pior desfecho possível**: ninguém
olha, o dado para de chegar, e o defeito só aparece quando a vendedora estranha o
painel dias depois.

Portanto, e isto é requisito de implementação, não recomendação:

- todo passo de fundo **verifica que `app.workspace_id` está definido antes de
  consultar** e **falha com erro** se não estiver — nunca segue com zero;
- "zero linhas" num passo de sincronização é **alarme**, não resultado. O
  agendador já alarma `ok:false` desde 27/08 (ver `docs/estado-atual.md`); este
  caso entra nesse mesmo caminho;
- o teste da Etapa 0 cobre isto explicitamente: rodar um passo de fundo sem
  workspace tem de **estourar**, não devolver lista vazia.

## Espaço em disco — e a boa notícia

O cérebro pediu para declarar isto em vez de descobrir no apply. **Declarado:
este desenho não precisa de espaço.**

Criar role, policy e `FORCE ROW LEVEL SECURITY` são entradas de catálogo — bytes,
não megabytes. **Não há reescrita de tabela, não há índice novo, não há
`VACUUM FULL`.** Portanto **esta ADR não espera o expurgo do bronze** e pode ser
executada com os 29 MB de folga de hoje.

⚠️ O que **não** muda: o banco continua batendo no teto entre 15/09 e 10/10 (ver
[`espaco-no-teto.md`](../plans/espaco-no-teto.md)). Se ele encher, esta ADR não
salva nada — só que ela também não atrapalha.

## Migração sem downtime — por etapas

Liga em produção com cliente dentro, então nenhuma etapa pode ser irreversível
sozinha.

**Etapa 0 — provar em banco descartável.** `ci-preparar-banco.mjs` monta o schema
do zero; o piloto roda ali. Teste que precisa ficar vermelho antes de contar:
consultar sem `app.workspace_id` **e obter zero linhas**, e consultar com o
workspace do vizinho e obter zero. Desfazer a policy tem que deixar o teste
vermelho — senão ele não cobre nada.

**Etapa 1 — criar a role e o transporte, sem ligar nada.** `nexo_runtime`
existe, `db.ts` passa a abrir transação e emitir o `set_config`, mas as policies
**ainda não existem** e a aplicação **ainda conecta como `postgres`**. Nada muda
de comportamento; o que se ganha é medir o custo real das rotas em produção. É
aqui que os +48 ms viram número por rota. Reversível: voltar `db.ts`.

**Etapa 2 — policy em UMA tabela, com a aplicação ainda em `postgres`.**
`postgres` tem bypass, então a policy fica inerte e **não pode quebrar nada**.
Serve para validar que o DDL aplica e que o catálogo aceita. Reversível:
`DROP POLICY`.

**Etapa 3 — trocar a role em ambiente de teste** (`workspace` de demonstração,
`6c877b36`), com policies em todas as tabelas de inquilino. Aqui aparecem os
caminhos do scheduler e do webhook. Reversível: variável de ambiente.

**Etapa 4 — produção, com interruptor.** A string de conexão decide a role;
voltar é trocar variável e reiniciar, sem DDL. As policies ficam no lugar e
inertes sob `postgres`.

**Etapa 5 — `FORCE ROW LEVEL SECURITY`.** Só depois de a etapa 4 estar estável.
É ela que fecha o último buraco (o dono das tabelas), e é a única irreversível na
prática, porque a partir dela um script de manutenção que rodava como dono passa
a ser filtrado.

## Consequências

**A favor:**

- A separação entre clientes deixa de depender de disciplina e passa a ser
  verificável por `pg_policies` — auditável em um comando, não em revisão de
  código.
- O modo de falha inverte: hoje esquecer o `WHERE` **mostra dado de outro**;
  depois, esquecer o workspace **não mostra nada**. Fail-closed medido.
- Responde à exigência da Ana com um fato do banco, não com uma promessa.

**Contra, e assumido:**

- **+48 ms por consulta** no desenho ingênuo, redutíveis mas não elimináveis. O
  orçamento de 1s da ADR-017 fica mais apertado, e rota lenta hoje pode passar do
  teto. É o motivo de a Etapa 1 existir antes de qualquer policy.
- **O trabalho de fundo é o ponto frágil.** Fail-closed nele significa
  sincronização vazia e silenciosa — precisa de alarme próprio, não de confiança.
- Uma segunda role com `bypassrls` (a opção (b) do scheduler) reintroduziria
  exatamente o buraco de hoje. Se o portão escolher (b), que seja com essa frase
  registrada.

## Pendente antes de implementar

1. Portão do cérebro sobre este ADR.
2. **Decisão do caminho do scheduler** — (a) iterar por workspace ou (b) role com
   bypass. É a única escolha de desenho que ficou aberta de propósito.
3. Decidir se `marketplace_api_calls` é tabela de inquilino ou de sistema.
4. Medição por rota do custo da Etapa 1, contra o orçamento da ADR-017.
