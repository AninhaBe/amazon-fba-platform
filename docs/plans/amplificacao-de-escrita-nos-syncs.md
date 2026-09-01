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
