# ADR-014 — Cache fora do processo e ingestão em fluxo

- **Status:** Proposto
- **Data:** 2026-08-15
- **Depende de:** [ADR-013](./ADR-013-worker-de-sync-separado-do-web.md) (worker separado do web)
- **Revisa parcialmente:** [ADR-002](./ADR-002-cache-swr.md) (cache SWR em três camadas)

## Contexto

A pergunta que originou este ADR: *"quando escalarmos e fizermos upgrade do
Render, estouraria memória com 200 usuários?"*

A resposta medida é **não** — e é justamente por isso que este ADR existe. O que
quebra antes da memória é mais silencioso e mais difícil de diagnosticar depois.

### O que NÃO cresce com o número de usuários

Verificado no código em 15/08/2026:

| Limite | Valor | Efeito |
|---|---|---|
| `connectionLimit` dos schedulers | 2 (Amazon) / 3 (ML, TikTok) | sync processa o mesmo tanto com 5 ou 500 contas |
| `runScheduledAmazonWarm(limit)` | 2 contas por rodada | aquecimento não explode |
| `MAX_ENTRIES` do `memoryCache` | 300 entradas no processo | cache não cresce sem teto |
| `DETAILED_ORDER_LIMIT` | 1.000 pedidos por leitura | overview tem teto |

Ou seja: **memória é função da maior conta, não da quantidade de contas.**
Upgrade de plano resolve o pico. Este ADR não é sobre isso.

### O que quebra de verdade

**1. O cache é local ao processo e pequeno demais para ser compartilhado.**
`cached()` guarda em RAM, com chave `workspace | conta | recurso | período`.
São 300 vagas para o processo inteiro. Com 200 contas × 3 canais × 4 períodos do
filtro, a demanda é da ordem de 2.400 chaves distintas. O cache não estoura —
ele **despeja**. Cada tela recalcula o que outra acabou de calcular, e o banco e
as APIs recebem a carga que o cache existia para evitar.

Pior: subir uma segunda instância **piora**. Cada uma tem seu próprio cache
vazio, e as duas reaquecem tudo em paralelo. O cache local é o que impede
escalar horizontalmente.

**2. A frescura degrada linearmente com o número de contas.**
Aquecimento pega 2 contas por rodada; sync, 2 ou 3. A cada 5 minutos são ~24
contas por hora. Com 200 contas, uma volta completa leva **~8 horas** — o
dashboard passa a mostrar dado velho sem dizer que é velho. O ADR-002 descreve o
aquecimento como cobrindo "todas as contas ativas"; o código tem teto de 2. A
descrição e a implementação divergiram, e a divergência só aparece com volume.

**3. O pico de memória do sync é proporcional à maior conta.**
`collectMercadoLivreOrders` acumula até `maxResultsPerRange = 10_000` pedidos num
array antes de gravar — com itens e pagamentos aninhados, algo como **30 MB por
sincronização**. Três em paralelo dão ~90 MB de pico. Em 512 MB isso já derrubou
o container (14/08 e 15/08/2026). Em 2 GB cabe, mas o número continua ditado pelo
maior vendedor da base — e vendedores grandes são exatamente os que queremos.

## Decisão

### 1. Payload pesado sai da memória do processo

Overview, rentabilidade e ABC passam a viver **apenas** na camada persistente
(Postgres), pelo padrão que o Mercado Livre já usa em
`mercadoLivreOverviewCache.ts`. O `cached()` em memória fica para o que é barato
de recalcular e caro de repetir dentro de uma mesma requisição — dedupe de
chamadas concorrentes, não armazenamento.

Consequência: a memória do web deixa de depender de quantas contas existem, e
instâncias passam a compartilhar cache em vez de competir.

### 2. Aquecimento por demanda, com orçamento

O critério deixa de ser "as N contas mais recentes por `updated_at`" e passa a
ser **quem acessou o painel recentemente**, aquecendo primeiro o período padrão.
O limite por rodada deixa de ser contagem fixa e passa a ser **orçamento de
tempo**, como o sync já faz com `budgetMs`.

Motivo: aquecer conta que ninguém abriu gasta cota de API e desloca da fila quem
está com a tela aberta. Contagem fixa trata conta grande e pequena como iguais;
orçamento não.

### 3. Ingestão grava por página, nunca acumula o conjunto

`collectMercadoLivreOrders` e equivalentes deixam de devolver `T[]` completo e
passam a entregar página a página, com a gravação acontecendo a cada uma. O
`maxResultsPerRange` deixa de ser teto de array e vira teto de janela.

Consequência: memória do worker fica constante e independente do tamanho da
conta. É o que permite subir `connectionLimit` quando o volume exigir — hoje,
subir concorrência multiplica o pico.

## Alternativas consideradas

**Só aumentar o plano do Render.** Resolve o pico de hoje e nada mais. O cache
continua local, então a segunda instância continua sendo contraproducente, e a
frescura continua degradando com o número de contas. Compra tempo, não capacidade.

**Redis para o cache.** Resolveria o item 1 com menos mudança de código. Recusado
por ora: acrescenta um serviço para operar e pagar, e o Postgres já está no
caminho de toda requisição e já hospeda os snapshots do ML. Se o volume provar
que o banco vira gargalo, este ADR é revisitado.

**Manter tudo e só subir os limites.** `connectionLimit` maior sem o item 3
multiplica o pico de memória linearmente. Trata o sintoma na direção errada.

## Consequências

**Ganhos**
- Memória do web constante; escala horizontal passa a fazer sentido
- Memória do worker independente do tamanho da conta
- Cota de API deixa de ser gasta aquecendo quem não abriu a tela

**Custos**
- Leitura do cache passa a ter latência de banco onde hoje é acesso a memória.
  Mitigado pelo `swr()`, que devolve o valor vencido na hora e revalida atrás.
- A mudança do item 3 altera a assinatura de `collectMercadoLivreOrders` e de
  quem consome — é a parte mais invasiva das três.
- Divergência entre ADR-002 e o comportamento novo: este documento revisa
  parcialmente a camada 1 daquele (memória como armazenamento), preservando as
  camadas 2 e 3.

## Ordem de execução

1. **Item 2** (aquecimento por demanda) — contido, mede-se sozinho, sem mudança
   de contrato.
2. **Item 3** (ingestão em fluxo) — remove o pico que já derrubou o container.
3. **Item 1** (cache no banco) — o mais invasivo e o que de fato destrava escala.

O ADR-013 é pré-requisito: sem worker separado, web e sync disputam a mesma
memória e nenhuma das três mudanças entrega o ganho completo.

## O que fica pendente e não é decidido aqui

- **Invalidação entre instâncias.** Com cache no banco, `invalidateByKeyPart()`
  (hoje um `Map` local) precisa alcançar todas as instâncias. Provavelmente uma
  coluna de versão por chave, mas não é decidido aqui.
- **Cota de API por aplicação.** Continua como o ADR-013 deixou: o limite é do
  app inteiro, e priorizar entre vendedores é problema separado.
