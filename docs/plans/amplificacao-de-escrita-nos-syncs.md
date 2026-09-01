# Amplificação de escrita: medido, e a hipótese estava errada

**Medido em 01/09/2026, produção, somente leitura.** Nada implementado.

Encomendado depois que o inventário de índices achou `workspace_marketplace_syncs`
com **1.178.864 updates para 14 linhas vivas** e
`workspace_marketplace_overview_snapshots` com **2.986.272 para 12**.

## Resposta curta

| pergunta | resposta |
|---|---|
| `overview_snapshots` é problema? | **Não. Deu em nada.** Zero escritas hoje |
| `marketplace_syncs` é problema? | **Sim, e é atual**: 9.559 updates/hora em 14 linhas |
| `IS DISTINCT FROM` resolve? | **Não.** A hipótese de "escrita de valor idêntico" está errada aqui |
| Aparece no perfil do pool? | **Sim** — foi ~46% das escritas na janela medida |


## A lição de método, e ela vale além daqui

> **Contador acumulado não é taxa.** `pg_stat_user_tables` conta desde o último
> reset das estatísticas — aqui, **30/06/2026**. Ele diz o que *já aconteceu*, não
> o que *acontece*. A diferença decide se algo é **emergência ou arqueologia**.

Os 2.986.272 updates de `overview_snapshots` levaram o número a ser tratado como
problema atual. Uma amostragem de 120 s mostrou **zero**. O mesmo instrumento, lido
como taxa em vez de acumulado, dá a resposta certa em dois minutos.

⚠️ **E a armadilha pegou duas vezes no mesmo dia.** Ao provar que as tabelas
mortas não tinham leitor, o acumulado mostrava **248.848 `seq_scan`** em
`overview_snapshots` — o que teria matado a proposta de remoção. Amostrado:
**0 leituras em 120 s**. Se eu tivesse lido o acumulado como taxa nas duas
direções, teria concluído o oposto do certo nas duas.

**Na prática:** antes de chamar um número de `pg_stat_*` de problema *ou* de
prova, amostre-o duas vezes com intervalo. Sempre.

## `overview_snapshots`: história morta, não custo

O acumulado de `pg_stat_user_tables` conta desde **30/06/2026** — 63 dias. Ele diz
o que já aconteceu, não o que acontece.

Medido por amostragem de **120 s**: **0 updates, 0 inserts.** E o código confirma:
não há nenhum escritor em `src/` — só a criação da tabela, uma lista de remoção e
o script de conta de teste. A materialização que a escrevia não existe mais.

**Conclusão: não vale trabalho.** O que sobra é a pergunta de higiene — se
ninguém escreve e ninguém lê, a tabela e a
`workspace_marketplace_materialization_leases` (1 linha, 1 update em 63 dias) são
candidatas a remoção. **552 kB e 32 kB.** Não é ganho de espaço; é uma tabela a
menos para alguém interpretar errado daqui a seis meses.

## `marketplace_syncs`: real, atual, e a causa não é a que se supunha

**9.559 updates/hora em 14 linhas** — 683 por linha por hora, uma a cada 5
segundos. Medido na mesma janela de 120 s (319 updates).

### Por que `IS DISTINCT FROM` não ajuda

A hipótese era escrita de valor idêntico. **Ela não se sustenta:** os `UPDATE`
gravam `lease_until = now() + interval '5 minutes'`, `updated_at = now()`,
`cursor_offset` e `processed_orders`. Esses valores **mudam sempre**, por
construção — um guard de igualdade nunca dispararia.

📌 Registro isso porque a hipótese era razoável e testá-la custou dez minutos.
Implementá-la teria custado um dia e não teria mudado nada.

### A causa real: a janela de frescor

O ciclo de cada conexão é `complete → pending → syncing → … → complete`. Ele
recomeça quando o dado passa de "fresco":

| canal | `FRESH_FOR_MS` |
|---|---|
| **Amazon** | **2 minutos** |
| **Mercado Livre** | **2 minutos** |
| Shopee | 10 minutos |
| TikTok | 10 minutos |

Medido: **13 das 14 linhas estão `complete`** e mesmo assim recebem escrita a cada
poucos minutos — 19 s, 188 s e 219 s atrás na amostra. Não são escritas
redundantes: são **ciclos inteiros de sincronização**, disparados a cada 2
minutos, em conexões cujo dado muda muito mais devagar. Cada ciclo custa o flip
para `pending`, o lease, os updates de página e o `complete` final.

**A amplificação não está no `UPDATE`. Está na frequência do ciclo.**

## O efeito no pool — a parte que interessa

Cada `dbQuery` é um checkout do pool, e o projeto tem **13 conexões** para tudo,
com dois esgotamentos registrados em 29/08 (ADR-030).

Na janela de 120 s, as escritas medidas foram:

| tabela | tuplas escritas | fatia |
|---|---|---|
| **`workspace_marketplace_syncs`** | **319 updates** | **~46%** |
| `workspace_channel_orders` | 242 updates | ~35% |
| `workspace_channel_order_fees` | 113 inserts | ~16% |
| `workspace_persistent_cache` | 12 updates | ~2% |

⚠️ **Isso é contagem de tuplas, não de checkouts** — um checkout pode escrever
várias tuplas, e leituras não aparecem aqui. Mas a ordem de grandeza responde a
pergunta: **quase metade das escritas do banco, na janela medida, foi
escrituração sobre 14 linhas de controle.**

## O desenho proposto — e ele não é "condicionar o UPDATE"

**Alinhar `FRESH_FOR_MS` da Amazon e do ML aos 10 minutos** que Shopee e TikTok
já usam. Reduz os ciclos por hora de 30 para 6 por conexão — **5× menos**.

E, para o **Mercado Livre**, há um argumento mais forte que economia: **o webhook
já existe e funciona** (2.406 eventos nas 12h seguintes à migração de domínio,
registrado em `docs/estado-atual.md`). Pesquisar a cada 2 minutos um canal que
**empurra** mudança é pagar duas vezes pela mesma informação.

⚠️ **Não é ganho de graça, e é decisão de produto, não minha.** A janela de
frescor é quanto tempo um pedido novo demora a aparecer na tela. Passar de 2 para
10 minutos é uma escolha sobre a experiência dela, e quem decide é a Ana — o meu
papel é dizer o que custa cada lado:

| | hoje (2 min) | proposto (10 min) |
|---|---|---|
| Ciclos por conexão/hora | 30 | 6 |
| Escrita em `syncs` | ~9.559/h | ~1.900/h estimado |
| Atraso máximo de um pedido novo na tela | 2 min | 10 min |
| ML, com webhook | atraso já é do webhook | **inalterado** — o webhook não depende disto |

## Como verificar, se for aprovado

A mesma amostragem de 120 s em `pg_stat_user_tables`, antes e depois. É medição
direta, não estimativa — e se a queda não vier, a hipótese estava errada de novo
e isso aparece no mesmo dia.

## O que NÃO recomendo

- **Condicionar os `UPDATE` com `IS DISTINCT FROM`.** Medido: não dispararia.
- **Mexer em Shopee/TikTok.** Já estão em 10 minutos.
- **Tratar isto como problema de disco.** As duas tabelas somam 648 kB e o
  autovacuum dá conta. O custo é WAL, I/O e **slot de pool** — que é o que
  importa num projeto com 13 conexões e dois esgotamentos no histórico.

## As duas tabelas mortas — prova de que não há LEITOR

Escritor ausente não basta: **tabela sem escritor mas com leitor vira tela vazia
em vez de erro**, e isso demora meses para aparecer. Provado nos quatro lugares
onde um leitor poderia se esconder:

| onde | `overview_snapshots` | `materialization_leases` |
|---|---|---|
| `SELECT` em `src/`, `scripts/`, `tests/` | **nenhum** | **nenhum** |
| Views ou materialized views que as citem | **nenhuma** | **nenhuma** |
| Chaves estrangeiras apontando para elas | **nenhuma** | **nenhuma** |
| Leituras registradas (amostra de 120 s) | **0 `seq_scan`, 0 `idx_scan`** | **0 e 0** |

As três referências que existem no código **não leem**: `shopeeRemoval.ts` e
`trial-account.mjs` apenas as incluem em listas de `DELETE` ao remover uma conta,
e `db.ts` as cria. Remover as tabelas exige tirá-las dessas duas listas junto.

⚠️ **O argumento para remover não é o espaço.** São 584 kB — irrelevante. É que
**tabela morta no schema é armadilha para quem chegar depois**: a próxima pessoa
que precisar de um snapshot de visão geral vai encontrar uma tabela com nome
perfeito, 12 linhas dentro e nenhum escritor, e vai gastar um dia entendendo por
que ela não atualiza.

---

# Correção de 01/09/2026 — a proposta acima estava errada, e a mudança foi revertida

O que segue corrige o documento. O texto anterior fica **intacto de propósito**:
ele mostra um raciocínio que soava certo e não era, e é isso que ensina.

## O que aconteceu

`FRESH_FOR_MS` do ML foi de 2 para 10 minutos (`2f4aca3`, deploy v220) e
**revertido no mesmo dia**. A proposta supunha que os 2 minutos causavam a
escrituração. Não causavam.

**O webhook grava `last_success_at = now()` nesta tabela a cada evento** — 447 por
hora — sem condição nenhuma (`mercadoLivreWebhook.ts`). Duas consequências:

1. **A escrituração do ML vem do webhook, não do ciclo.** A constante era quase
   irrelevante, e mudá-la era um no-op para o volume de escrita.
2. **Pior: o portão da varredura periódica é realimentado pelo webhook.** O
   agendador só elege uma linha `complete` quando
   `COALESCE(last_success_at, updated_at) < now() - FRESH_FOR_MS`.

Medido sobre 7 dias e 32.369 intervalos entre eventos:

| silêncio | ocorrências em 7 dias | por dia |
|---|---|---|
| **> 2 minutos** | **979** | ~140 |
| **> 10 minutos** | **10** | ~1,4 |

**Subir para 10 minutos cortou em 98% as oportunidades da varredura que existe
para pegar o que o webhook perdeu.** Por isso a reversão.

## 🔴 O defeito de fundo, que a reversão NÃO conserta

**A rede de segurança está condicionada à saúde daquilo que ela deveria vigiar.**

Quanto mais o webhook funciona, menos a varredura roda. E se ele passar a
**descartar eventos em silêncio** — em vez de parar —, `last_success_at` continua
fresco e a varredura **nunca** roda. É precisamente o modo de falha que ela existe
para cobrir.

**Conserto proposto (não implementado):** desacoplar. A varredura periódica ganha
carimbo próprio — `last_sweep_at`, escrito **só** por ela — e cadência própria,
independente de o webhook estar entregando. O `last_success_at` continua servindo
ao que serve hoje; ele só deixa de mandar em quem o vigia.

## As três lições de método do dia

> **1. Contador acumulado não é taxa.** `pg_stat_*` conta desde o último reset.
> Amostre duas vezes com intervalo antes de chamar um número de problema **ou** de
> prova. Pegou duas vezes no mesmo dia, em direções opostas.

> **2. "Medi e não vale a pena" só vale se a medição cobriu TODOS os caminhos de
> escrita.** A hipótese do `IS DISTINCT FROM` foi descartada com medição — mas a
> medição olhou os `UPDATE` do ciclo de sync e não os do webhook, onde ela se
> aplica. Uma hipótese certa foi morta por amostra parcial do código.

> **3. A técnica certa já estava no MESMO ARQUIVO, aplicada a uma tabela e não a
> outra.** `mercadoLivreWebhook.ts` usa
> `WHERE (status, payload) IS DISTINCT FROM (EXCLUDED.status, EXCLUDED.payload)`
> em `workspace_marketplace_products`, e **não** usa nada disso nos `UPDATE` de
> `workspace_marketplace_syncs`, poucas linhas adiante. Padrão correto convivendo
> com o errado, a poucas linhas de distância, é o defeito mais difícil de ver —
> porque quem lê acha que o arquivo já segue o padrão.

📌 E uma quarta, sobre processo: este achado só apareceu porque uma pergunta
—"a v220 contém o commit X?"— foi respondida **por verificação de comportamento e
não por inferência**. A inferência ("a worktree era daquele commit, logo contém")
estava correta e não teria produzido nada.

---

# Correção II de 01/09/2026 — o "dano" não existia

⚠️ Este documento afirmou, em versão anterior, que **7 pedidos** (e depois **125**,
somando **R$ 4.278,16**) tinham se perdido. **Os dois números eram falsos.** O
texto anterior fica porque o erro é o que ensina.

## O que era falso, e por quê

O método comparava **o que o ML lista numa janela** com **o que o banco tem na
mesma janela**. A API do ML devolve pedidos ligeiramente **fora** da borda pedida
em `order.date_created.from/to`, e a consulta ao banco aplicava a janela ao pé da
letra.

Procurados **por id, sem filtro de janela**: os 7 estavam no banco. Os 125
também. **Zero ausentes.**

> **Diferença de conjunto entre duas consultas com filtros de data diferentes
> mede a discordância dos FILTROS, não a ausência do DADO.**

## As duas armadilhas que fizeram o número passar

> **IDADE NÃO É AUSÊNCIA.** Os 7 foram "confirmados" checando que eram antigos —
> criados 7 dias antes, não recentes — e daí se concluiu que eram perda real. A
> checagem que valia, procurar o id sem filtro, custava um comando e só foi feita
> depois.

> **DETALHE NÃO É EVIDÊNCIA.** O relato trazia os 7 ids, a data, o status e o
> intervalo de 32 minutos. Precisão de descrição fez o número *parecer* sólido, e
> ele foi repassado com ênfase. Descrever bem não é provar que existe.

E a terceira, que é de quem recebeu: **explicação que encaixa é o momento de mais
desconfiar, não de menos.** O mecanismo descrito de manhã — a retomada do webhook
fechando o portão da varredura — explicava perfeitamente 7 pedidos na borda da
retomada. Quando o dado confirma a teoria que se acabou de escrever, a chance de
o instrumento ter sido moldado pela teoria é máxima.

## O que continua verdadeiro

- **Os cinco apagões são reais** — 236h, 143h, 89h, 66h, 63h — medidos por gaps
  na própria tabela de eventos, sem API no meio.
- **A varredura periódica funcionou durante eles**, e é por isso que nada se
  perdeu. Isso é evidência **a favor** do desenho atual, não contra.
- **O alarme de silêncio continua justificado**, por um motivo melhor: a ingestão
  passou dez dias dependendo só do polling e ninguém soube.
- **O desacoplamento continua valendo como PREVENÇÃO**, não como conserto de dano
  com vítima conhecida.
