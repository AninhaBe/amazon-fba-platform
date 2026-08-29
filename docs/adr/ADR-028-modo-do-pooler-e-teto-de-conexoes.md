# ADR-028: Modo do pooler e o teto real de conexões

- **Status:** Proposto — proposta medida no portão do cérebro (28/08/2026)
- **Data:** 2026-08-28
- **Relacionado:** [ADR-017](./ADR-017-orcamento-de-1s-e-leitura-agregada.md) ·
  [`estado-atual.md` §15](../estado-atual.md) (o incidente de `timeout exceeded
  when trying to connect`, mesma família)

## Contexto

O NEXO fala com o Postgres **sempre pelo pooler do Supabase**, na porta `5432`
do host `...pooler.supabase.com` — que é o **modo `session`**. Nesse modo, cada
conexão de cliente prende uma conexão de servidor pela vida inteira, e o teto do
projeto é `pool_size: 15`.

O `db.ts` pede `max: 10`.

O problema apareceu sozinho, medindo outra coisa: duas sondas locais em paralelo
derrubaram a segunda com `EMAXCONNSESSION`.

### O que foi medido (28/08/2026, produção)

| Medida | Valor |
|---|---|
| `max_connections` do Postgres | **60** (3 reservadas para superusuário) |
| Conexões de servidor que o Supavisor mantém | **15** — o `pool_size` inteiro |
| Atividade total no banco no momento da medida | 27 de 60 |
| Conexões de **cliente** que consegui abrir na 5432 (session) | **14**, e a 15ª estourou |
| Conexões de **cliente** que consegui abrir na 6543 (transaction) | **40**, sem erro |

📌 O banco **não** é o gargalo (27 de 60). O gargalo é o `pool_size: 15` do
pooler, e ele é compartilhado entre o app, os crons e qualquer script local.

### ⚠️ Correção de uma premissa que circulou

A hipótese inicial era "no deploy, máquina velha e nova coexistem e somam
10+10 = 20". **Isso não acontece nesta configuração.** O app tem um volume
montado (`nexo_data`), roda com uma máquina só, e a máquina `2874de1b9e0d78` é a
mesma desde 19/08/2026 atravessando todos os deploys até a v153 — ou seja, o Fly
**atualiza no lugar**, não cria uma segunda.

O risco é real, mas por outros caminhos:

1. **Script local contra produção enquanto o app roda.** Foi o que aconteceu.
   Qualquer `.mjs` que abra um pool de 10 já briga com o app pelo mesmo teto.
2. **Escalar para 2 máquinas** (ou trocar a estratégia para `bluegreen`)
   passaria a valer a hipótese original — hoje não vale, amanhã pode valer sem
   ninguém lembrar deste ADR.
3. **Rajada do cron.** O cron dispara os quatro canais em paralelo; é o momento
   em que o app chega perto do seu próprio `max`.

## O que o modo `transaction` quebraria — verificado, não suposto

O modo `transaction` devolve a conexão ao pool **a cada transação**, então tudo
que depende de estado de sessão quebra. A lista do que quebraria, conferida
contra o código (`scripts/pooler-mode-probe.mjs` exercita os quatro primeiros):

| Recurso que exige sessão | Usamos? |
|---|---|
| `pg_advisory_lock` (lock de **sessão**) | **Não.** Os dois locks do repo são `pg_advisory_xact_lock` — escopo de transação: `db.ts:433` e `tiktokOwnership.ts:23`. Testado no modo transaction: passa. |
| Prepared statements **nomeados** | **Não.** Nenhuma chamada passa `name:` ao `pg`; o driver usa portal sem nome. Testado: consulta parametrizada passa. |
| `LISTEN` / `NOTIFY` | **Não.** Zero ocorrências. |
| Tabelas temporárias | **Não.** Zero ocorrências. |
| Cursores mantidos entre transações | **Não.** Zero ocorrências. |
| `SET` de sessão (`search_path`, `statement_timeout`, `TIME ZONE`) | **Não.** Zero ocorrências. |
| Transação explícita `BEGIN`/`COMMIT` (`dbTransaction`) | **Sim — e funciona.** No modo transaction a conexão fica presa à transação, que é exatamente o comportamento desejado. Testado: passa. |

Resultado da sonda, lado a lado:

```
=== session (5432, o de hoje) ===
  ok    conecta e responde                              248ms
  ok    consulta parametrizada (protocolo estendido)     70ms
  ok    BEGIN + pg_advisory_xact_lock + COMMIT          102ms
  ok    consulta agregada real (pedidos por canal)      103ms
  FALHA 10 conexoes simultaneas (o max do db.ts)   EMAXCONNSESSION

=== transaction (6543) ===
  ok    conecta e responde                              344ms
  ok    consulta parametrizada (protocolo estendido)     38ms
  ok    BEGIN + pg_advisory_xact_lock + COMMIT           65ms
  ok    consulta agregada real (pedidos por canal)       84ms
  ok    10 conexoes simultaneas (o max do db.ts)        413ms
```

⚠️ **Leia a linha `FALHA` com a ressalva certa — e ela é uma correção a uma
versão anterior deste ADR.** Numa segunda rodada, horas depois, o modo `session`
**passou** nas 10 simultâneas (505ms). O teto não morde sempre: ele morde quando
o app, os crons e algum script somam mais de 15 **ao mesmo tempo**. A primeira
redação dizia "já falha hoje", sem o "quando", e isso era gravidade inflada — do
mesmo tipo catalogado no ADR-017.

O que é constante, medido nas duas rodadas:

| | session (5432) | transaction (6543) |
|---|---:|---:|
| Conexões de **cliente** que se consegue abrir | **14** | **30+** (parei de contar) |

Ou seja: o `pool_size: 15` é teto de clientes no modo `session` e deixa de ser
no `transaction`. A falha das 10 simultâneas é **intermitente por natureza** —
depende de quem mais está usando o pooler no instante — e é exatamente por isso
que ela é perigosa: some quando se vai investigar.

## Opções

### A — Baixar o `max` do `db.ts`

Ex.: `max: 5`, deixando folga para cron e scripts dentro dos 15.

- **A favor:** uma linha, reversível, sem mexer em infraestrutura.
- **Contra:** foi justamente **subir** de 5 para 10 que resolveu o incidente da
  §15 (`timeout exceeded when trying to connect` era a fila do pool da aplicação,
  não o marketplace). Voltar atrás reabre aquele problema.
- **Veredito:** trata o sintoma criando o sintoma anterior. Não recomendo
  sozinha.

### B — Trocar o pooler para modo `transaction` (porta 6543) — **recomendada**

- **A favor:** é a diferença entre 14 e 40+ conexões de cliente medida acima; o
  `pool_size: 15` deixa de ser teto de clientes e vira teto de conexões de
  servidor multiplexadas. Nada do que quebraria é usado por nós — verificado
  item a item. Nas medidas, o modo transaction ficou **igual ou mais rápido**
  por consulta.
- **Contra / o que precisa de cuidado:**
  - **Migrations não devem ir por aqui.** `migrate-cli.mjs` usa `DATABASE_URL`
    com `max: 1`. DDL longa merece a **conexão direta** do projeto, não o
    pooler — mudança pequena e que vale independentemente desta decisão.
  - É mudança de string de conexão em produção: exige variável de ambiente nova
    e um deploy, com rollback trivial (voltar a porta).
  - Se algum dia entrar código que dependa de sessão, ele falha em produção e
    não em teste. Mitigação: este ADR e um comentário no `db.ts`.
- **Veredito:** resolve a causa, não o sintoma, e o risco está enumerado e
  testado.

### C — Subir o `pool_size` no Supabase

- **A favor:** também resolve, sem tocar no código.
- **Contra:** é console do Supabase (fora do repo, sem revisão nem histórico
  aqui), consome do `max_connections: 60` que também serve PostgREST, `pg_cron`,
  auth e exporter, e **não muda a natureza do problema** — só empurra o teto. Em
  modo session, N clientes continuam prendendo N conexões de servidor.
- **Veredito:** boa como folga temporária, ruim como solução.

## Proposta

**B, com duas coisas junto:**

1. Migrar a aplicação para a porta `6543` (modo transaction).
2. Apontar `migrate-cli.mjs` para a **conexão direta**, não para o pooler.

E uma regra de higiene que independe da escolha: **script local contra produção
não abre pool de 10.** As sondas deste repo já usam `Client` único ou pool
pequeno; a que estourou foi minha, com `max: 10`.

## Executado em 28/08/2026 (v159) — e o que NÃO ficou provado

A aplicação passou a usar o modo `transaction`. Verificação pós-deploy:

- versão **159 confirmada na máquina** (não só o release), health 200;
- **os 4 canais completaram ciclo de sync depois do deploy** (Amazon 0,0 min,
  ML 1,5 e 1,8 min, Shopee 0,6 min, TikTok 7,9 min — este às 00:45, após o
  deploy às 00:42:16Z), sem nenhum erro de conexão;
- o Supavisor passou a manter **12** conexões de servidor, em vez das 15 fixas.

⚠️ **O que a prova das "10 simultâneas" NÃO mostra.** Ela passou na porta nova
(371ms) — **e também na antiga** (535ms), porque naquele momento o teto de 15
não estava sendo disputado. Ela **não discrimina** e não deve ser citada como
confirmação do ganho. O número que discrimina é o constante: **14 conexões de
cliente na 5432 contra 30+ na 6543**.

⚠️ **Limite explícito do que ficou provado.** Não é possível verificar, do lado
do banco, **em qual porta a aplicação abriu o pool** — `pg_stat_activity` só
enxerga o Supavisor. O que sustenta a decisão é o conjunto: mudança
determinística, 9 testes, versão confirmada na máquina, 4 syncs completos e o
Supavisor em 12 conexões em vez de 15 fixas (compatível com multiplexação, mas
**sozinho não prova**). Quem ler isto no futuro não deve concluir que a porta em
uso foi observada diretamente — não foi.

📌 Um erro que aparece no monitoramento e **não** é deste deploy: a conexão
`mercado_livre:demo` do workspace de demonstração está em `error` com *"sem
refresh token"* há 33h. É conexão **demo, sem token por construção** — ruído, não
dado real parado. As duas conexões reais de ML (NEXAHUBBRASIL e CRYSTALFANCY)
estavam `complete` com sucesso de minutos atrás. Erro de pool teria outro texto
(*"timeout exceeded when trying to connect"*).

## Pendente

- Decisão do cérebro sobre A / B / C.
- Se for B: confirmar o `pool_size` do projeto no console e se a conexão direta
  está habilitada (projetos IPv6-only precisam do add-on IPv4 para conexão
  direta — verificar antes de mover as migrations).
- Nada disto foi executado. Este ADR é proposta; o código segue na 5432.
