# ADR-017: Orçamento de 1 segundo — uma tela, uma chamada, banco só

- **Status:** Aceito
- **Data:** 2026-08-20

## Contexto

Em 19/08/2026, o dashboard da Amazon aberto na conta de maior volume (37 mil pedidos no
ML + 21,6 mil na Amazon) ficou **preso em esqueleto** — primeiro para sempre (fetch sem
timeout, corrigido em `ed65a92`), depois por segundos a cada troca de filtro de período.

A dona do produto estabeleceu o requisito sem ambiguidade: **"essa tela não pode ficar
mais de 1s"** — e tempo de tela **não pode escalar com o volume da conta**.

### A causa, medida (não suposta)

Duas hipóteses foram descartadas com medição antes desta decisão:

| Hipótese | Medição | Veredito |
|---|---|---|
| "O banco é lento com volume" | agregação de 30 dias: 208 pedidos → 17ms · **9.262 pedidos → 21ms** (cache quente, 3 rodadas) | ❌ não é o banco |
| "É o esqueleto/frontend" | o esqueleto só aparece na 1ª visita de cada período (há cache por período) | ❌ sintoma, não causa |

A causa real, encontrada lendo as bibliotecas que servem as rotas:

```
orders.ts                → spapiFetch + paginação de TODAS as páginas de pedidos
sales.ts                 → spapiFetch
radar.ts                 → inventory + listings + orders (tudo SP-API)
topProducts.ts           → orders + products (SP-API)
amazonProfitability.ts   → orders + transactions (SP-API)
profit.ts                → 2 dbQuery (único parcialmente migrado)
```

**O dashboard da Amazon consulta a SP-API ao vivo a cada troca de período**, paginando
pedidos — ignorando o `workspace_channel_orders`, que tem os mesmos dados indexados e
responde em 21ms. Conta maior = mais páginas = mais lento. É por construção que o tempo
escala com o volume.

Além disso, a tela dispara **6 requisições paralelas por período** — cada uma com seu
overhead de rede e autenticação — e o navegador monta o quebra-cabeça.

### Por que os remendos foram rejeitados (dois foram tentados e revertidos)

- **Pré-carregar todos os períodos** (implementado e revertido em 20/08): 18 requisições
  especulativas por sessão contra uma API **com throttling** — gastaria a cota que faz a
  tela funcionar, para dados que talvez ninguém olhe.
- **Pré-carga por intenção (hover)** (implementado e revertido em 20/08): melhor, mas
  segue maquiagem — ganha 200–400ms sobre uma fonte que leva segundos e continua
  escalando com o volume.
- Esqueleto mais bonito, cache de navegador, etc.: idem — nenhum muda a fonte.

📌 **Lição que motivou a inversão:** otimização de frontend não conserta fonte lenta.
Primeiro muda-se a fonte; o frontend depois raramente precisa de truque.

## Decisão

Três regras, em ordem de precedência:

### 1. Orçamento de 1 segundo é contrato

**Qualquer interação de dashboard responde em < 1s**, independentemente do volume da
conta. Não é aspiração: mudança que estoure o orçamento em conta grande está errada
mesmo que passe em conta pequena. A conta de teste para isso é a de maior volume
disponível (~37 mil pedidos), não a menor.

### 2. Uma tela = uma chamada

Cada dashboard tem **uma rota agregadora** que devolve o payload completo da tela:

```
GET /api/amazon/dashboard?days=15
→ { orders, profit, sales, radar, top, profitability, updatedAt }
```

O servidor compõe as consultas (em paralelo, perto do banco); o navegador faz **uma**
viagem. As 6 rotas atuais continuam existindo para usos pontuais, mas o dashboard não
as chama mais uma a uma.

### 3. O caminho interativo lê SÓ do Postgres

Nenhuma chamada à SP-API (ou a qualquer API de marketplace) no caminho de uma tela.
A API externa é trabalho de dois lugares, apenas:

- **do sync** (cron, a cada 15 min hoje), que alimenta o canônico;
- - de **ação explícita do usuário** ("Atualizar agora"), com indicador próprio de
  progresso — frescor sob demanda é legítimo; frescor silencioso a cada clique, não.

Orçamento por camada, para caber no 1s de ponta a ponta:

| Camada | Alvo |
|---|---|
| Consultas SQL (somadas, em paralelo) | < 200ms |
| Composição + serialização | < 100ms |
| Rede (gru → usuário no Brasil) | < 300ms |
| Renderização | < 200ms |
| **Total** | **< 800ms** (folga de 200ms) |

### Pré-requisito duro: sync saudável

Ler do banco só vale se o banco estiver certo. Em 19/08, **16 dos 17 pedidos** da conta
da dona estavam `pending` sem itens no canônico. **Consertar a ingestão faz parte desta
migração** — rápido e furado não atende (`AGENTS.md`: tela mostra o estado real).

### Plano B já decidido (com gatilho, sem obra agora)

Se um dia a agregação ao vivo estourar o orçamento (centenas de contas, milhões de
linhas): o sync passa a manter **tabelas de resumo por dia** (pré-agregação), e o
dashboard vira leitura de ~30 linhas prontas. Gatilho: p95 da rota agregadora > 500ms
na conta de maior volume. Não implementar antes do gatilho.

## Alternativas consideradas

- **Continuar na SP-API e otimizar o frontend** (pré-carga, cache, esqueleto): rejeitado
  — ver "remendos" acima. Dois foram implementados e revertidos no mesmo dia.
- **Pré-agregação já** (tabelas de resumo desde o início): rejeitado por ora — a
  agregação ao vivo custa 21ms; materializar agora é complexidade sem dor. Fica como
  plano B com gatilho.
- **Cache mais agressivo em cima da SP-API**: rejeitado — cache sobre fonte lenta e
  limitada por cota continua pagando o preço na primeira visita e a cada expiração, e o
  throttling continua sendo de quem olha a tela.
- **Motor analítico separado (DuckDB/lakehouse)**: rejeitado — ver ADR-016; o Postgres
  responde em 21ms, o problema nunca foi ele.

## Consequências

- ➕ Troca de período instantânea, e **tempo constante** com o volume — o requisito.
- ➕ Zero consumo de cota SP-API por visita ao dashboard; throttling deixa de ser risco
  de tela.
- ➕ Menos requisições, menos estados de carregamento parciais, menos race conditions.
- ➖ O dado da tela tem a idade do último sync (≤ 15 min hoje). Mitigado pelo carimbo
  "atualizado às HH:MM" (já existe) e pelo botão de atualização explícita.
- ➖ Migração real: 5 bibliotecas (`orders`, `sales`, `radar`, `topProducts`,
  `amazonProfitability`) passam a ler do canônico — `profit.ts` serve de modelo.
- ➖ Métricas que hoje só existem na resposta da SP-API precisam estar no canônico antes
  da tela migrar — se faltar coluna, o gap aparece nesta migração (e é bom que apareça).

## Ordem de execução

1. **Rota agregadora** `/api/amazon/dashboard` lendo do canônico (o que der do canônico
   hoje; o resto explicita o gap).
2. **Conserto da ingestão** da conta da dona (pedidos `pending` sem itens).
3. Dashboard da Amazon consome a rota nova; medir de ponta a ponta na conta grande.
4. Replicar o padrão para ML, Shopee e TikTok (que já leem do banco, mas em N chamadas).
5. Botão "Atualizar agora" (ao-vivo explícito) onde fizer falta.

Relacionado: [ADR-001](./ADR-001-modelo-canonico.md) ·
[ADR-002](./ADR-002-cache-swr.md) ·
[ADR-016](./ADR-016-ciclo-de-vida-do-dado.md) ·
[`../architecture/read-and-cache.md`](../architecture/read-and-cache.md)
