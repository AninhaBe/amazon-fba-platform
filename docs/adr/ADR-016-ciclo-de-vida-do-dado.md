# ADR-016: Ciclo de vida do dado — toda tabela responde "quando isso morre"

- **Status:** Aceito
- **Data:** 2026-08-19

## Contexto

Em 19/08/2026 o banco de produção foi medido **por acidente**, durante uma conversa sobre
hospedagem. Resultado: **559 MB**, acima do limite de 500 MB do plano Supabase Free —
e ninguém estava olhando.

A medição revelou que o problema **não é escala, é falta de política de expurgo**:

| Tabela | Total | Achado |
|---|---|---|
| `workspace_marketplace_events` | **172 MB** | 198.958 linhas, **todas de 21/07 em diante** — 29 dias |
| `workspace_channel_orders` | 122 MB | dado de negócio, cresce com a operação |
| `workspace_marketplace_orders` | 121 MB | **70 MB só na coluna `payload`** |
| `workspace_channel_order_items` | 40 MB | |
| `workspace_marketplace_shipments` | 39 MB | |
| `workspace_channel_order_fees` | 39 MB | **índices (21 MB) pesam mais que os dados (18 MB)** |

### A tabela que explica tudo

`workspace_marketplace_events` é a **caixa de entrada de webhooks do Mercado Livre** —
tem `status`, `attempts`, `processing_at`, `processed_at`, `last_error`. É uma fila.

```
complete    198.917   (99,98%)
processing       34
error             7
```

Entrada medida: **~8.000 eventos/dia**, firme (08/13: 9.601 · 08/16: 6.909 · 08/18: 8.259).
Isso é **~7 MB/dia, ~210 MB/mês** — só desta tabela. Foi o que levou o banco de 526 para
559 MB no intervalo de uma conversa.

**Fila sem limpeza cresce para sempre, por construção.** Não é bug de volume: é ausência
de regra.

### O peso está em JSON cru

| Tabela | Coluna | Peso |
|---|---|---|
| `workspace_marketplace_orders` | `payload` | **70 MB** |
| `workspace_marketplace_events` | `payload` | 53 MB |
| `workspace_channel_orders` | `raw` | 19 MB |

São ~142 MB de dado **escrito uma vez e lido quase nunca**, ocupando o armazenamento mais
caro que temos.

### O que o repo já tinha — e o que faltava

O [`AGENTS.md`](../../AGENTS.md) tem regra forte sobre **veracidade** do dado: `null` ≠ `0`,
não extrapolar, tela sem dado mostra estado real. Não existia nenhuma regra sobre **ciclo
de vida**: quando o dado morre, quem apaga, onde ele mora quando esfria.

### Por que NÃO um data lakehouse

Foi levantada a hipótese de Databricks sobre Azure. **Rejeitada por desproporção:** o banco
tem 559 MB e o Postgres opera confortavelmente em centenas de GB. Mesmo **sem controle
nenhum**, no ritmo atual levaríamos décadas para chegar lá.

E o mais importante: **não resolveria o problema.** O nosso caso é fila sem expurgo —
mudar de armazenamento só mudaria o endereço do crescimento descontrolado, com fatura
maior e uma ferramenta que ninguém aqui opera, logo depois de escolher o Fly justamente
para não cuidar de infraestrutura ([ADR-015](./ADR-015-compute-em-sao-paulo-com-banco-gerenciado.md)).

Reavaliar quando houver centenas de sellers gerando bilhões de eventos, ou ML sobre o
histórico.

## Decisão

**Toda tabela responde "quando esse dado morre e quem apaga" antes de ser criada.**
Quatro categorias, e cada tabela nova declara a sua no doc de schema:

| Categoria | Retenção | Exemplos |
|---|---|---|
| **Efêmero** — fila, inbox, lease | **dias** | `workspace_marketplace_events`, leases de OAuth |
| **Operacional** — o negócio | **para sempre** | pedidos, itens, taxas, produtos |
| **Derivado** — reconstruível | janela definida | cache, snapshots, histórico de ranking |
| **Bruto** — payload de API | **quente por N dias, depois sai do Postgres** | `payload`, `raw` |

### Regras que derivam disso

1. **Fila é particionada por tempo, não limpa por `DELETE`.** Para tabela que só cresce por
   data, `DELETE` + `VACUUM FULL` é a ferramenta errada no longo prazo: trava a tabela e
   gera inchaço. Particionada, aposentar dado velho é `DROP PARTITION` — instantâneo, sem
   vacuum, sem lock.
2. **Cortar na origem antes de expurgar no destino.** Antes de otimizar armazenamento,
   verificar se o dado precisava ter chegado. **Não recebido é melhor que apagado.**
3. **`DELETE` não devolve disco.** O espaço é reaproveitado internamente, mas o tamanho
   medido não cai sem `VACUUM FULL` (que trava) ou `pg_repack`. Quem apaga esperando o
   número cair precisa saber disso.
4. **Nada de expurgo silencioso.** Toda rotina de retenção registra quantas linhas
   removeu.
5. **Erro e pendência não expiram.** Só se apaga o que foi processado com sucesso.
6. **Medir sempre, não quando dói.** Tamanho do banco, maiores tabelas, crescimento diário
   e tuplas mortas entram na rotina — a descoberta acidental de 19/08 não pode se repetir.

## Implementação (o que foi feito junto com este ADR)

### Agora

- **Retenção em `workspace_marketplace_events`**: remove o que está `complete` **e**
  processado há mais de **7 dias**. `error` e `processing` **nunca** são removidos.
  Cron diário próprio (`.github/workflows/retencao.yml`), com contagem registrada.

  ⚠️ **A primeira versão deste ADR dizia 30 dias — número errado, corrigido antes de
  aplicar.** O ensaio mostrou que 30 dias **não removeria nenhuma linha** (a tabela tinha
  29 dias de história) e faria a tabela estabilizar em ~240 mil linhas, **mais do que as
  199 mil que já existiam**. A política teria ficado bonita no papel sem resolver nada.

  | Janela | Remove agora | Estabiliza em |
  |---|---|---|
  | **7 dias** | **144.431 linhas** | **~56 mil (~48 MB)** |
  | 14 dias | ~85 mil | ~104 mil (~90 MB) |
  | 30 dias | 0 | ~240 mil (~210 MB) |

  **7 dias** porque o evento já cumpriu a função ao virar pedido canônico; o que resta
  serve para deduplicar reentrega do ML (que ocorre em horas) e forense recente. O
  payload original continua disponível na API do ML para reconsulta.

- **Script de medição** (`scripts/db-size.mjs`): tamanho do banco, 15 maiores relações,
  índices nunca usados, tuplas mortas e o estado da fila — o levantamento de 19/08 vira
  comando repetível.

📌 **Lição de método:** número de retenção se escolhe **depois** de medir a distribuição
etária da tabela, não antes. Um valor conservador escolhido no escuro pode ser
simultaneamente inútil e pior que o status quo.

### Resultado da primeira aplicação (19/08/2026, ~19h)

| | Antes | Depois |
|---|---|---|
| **Banco** | **559 MB** (acima do limite de 500) | **424 MB** |
| `workspace_marketplace_events` | 172 MB · 198.958 linhas | **38 MB · 54.289 linhas** |

144.669 linhas removidas em 8 lotes de 20 mil. Os **34 `processing` e 7 `error`
permaneceram** — a regra 5 funcionou na prática.

O `DELETE` sozinho **não moveu o número** (559 MB antes e depois), exatamente como a regra
3 previa. O espaço só voltou com `VACUUM FULL ANALYZE`, que levou **3 segundos** de lock
na tabela.

**O banco voltou a caber no plano gratuito.** Isso não torna o Supabase Pro desnecessário
— ele continua valendo pelo backup e PITR — mas tira a urgência de assinar hoje.

### Próximo (não feito neste ADR)

- **Particionar `workspace_marketplace_events` por mês** — troca o `DELETE` recorrente por
  `DROP PARTITION`. É migração de verdade, merece janela própria.
- **Investigar os 8.000 webhooks/dia** — volume desproporcional à operação. Pode haver
  tópico do ML assinado e não consumido, ou entrega duplicada (a coluna `event_key`
  existe). Cortar na origem vale mais que qualquer expurgo.
- **Tirar `payload`/`raw` do Postgres** para object storage após N dias quentes.
- **Podar índices não usados** — medir por `pg_stat_user_indexes.idx_scan = 0`.
- **Afinar autovacuum** nas maiores: `workspace_channel_order_fees` estava com 17% de
  linhas mortas e último autovacuum 11 dias antes; `workspace_marketplace_shipments`, 19
  dias.
- **Migrar `DATA_DIR`** (contas OAuth e custos em disco local) para o Postgres — ver
  ADR-015.

## Alternativas consideradas

- **Só assinar o Supabase Pro** (8 GB): resolve o sintoma e é recomendável de qualquer
  forma — mas **pelo backup e pelo PITR**, não pelo disco. Sozinho, deixa a fila crescendo
  sem regra e apenas adia a conversa.
- **Databricks/lakehouse:** rejeitado por desproporção — ver Contexto.
- **Trocar de banco:** não resolve. 8.000 linhas/dia enchem qualquer armazenamento; o
  crescimento acompanha o fornecedor.
- **Apagar por `DELETE` sem partição, como solução final:** aceito **agora** por ser
  imediato e reversível em desenho, mas registrado como intermediário — a partição é o
  destino.

## Consequências

- ➕ A fila para de crescer e estabiliza; o banco volta a caber no plano.
- ➕ Toda tabela nova passa a nascer com resposta sobre expurgo.
- ➕ A medição vira comando, não acidente.
- ➖ `DELETE` recorrente gera tuplas mortas e depende de autovacuum — mitigado, não
  eliminado, até a partição.
- ➖ Retenção de 30 dias significa que **replay de webhook antigo deixa de ser possível**.
  Aceito: o evento processado já virou pedido canônico, e a origem (API do ML) continua
  disponível para reconsulta.
- ➖ Uma rotina a mais no cron, que pode falhar silenciosamente se ninguém olhar — daí a
  regra 4 (registrar contagem).

Relacionado: [ADR-001](./ADR-001-modelo-canonico.md) ·
[ADR-003](./ADR-003-cron-github-actions.md) ·
[ADR-015](./ADR-015-compute-em-sao-paulo-com-banco-gerenciado.md) ·
[`../canonical-schema.md`](../canonical-schema.md)
