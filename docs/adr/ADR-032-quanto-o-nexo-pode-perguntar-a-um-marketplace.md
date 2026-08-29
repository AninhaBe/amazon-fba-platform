# ADR-032: Quanto o NEXO pode perguntar a um marketplace

- **Status:** Aceito
- **Data:** 2026-08-29

## Contexto

Em 29/08/2026 a Shopee abriu um **alerta de comportamento anormal** contra o app.
A pergunta óbvia — *quantas chamadas por endpoint e por hora?* — **não tinha como
ser respondida**. Não existia contador nenhum, em canal nenhum. A primeira
resposta teve que ser derivada de código e configuração, marcada como inferência.

Ao investigar, o passo de conciliação de escrow da Shopee mostrou quatro
defeitos no mesmo laço:

1. **Duas chamadas externas por pedido** (`get_escrow_detail` + `get_order_detail`),
   20 pedidos por passo, vários passos por tique, a cada 3 minutos, 24h por dia.
   O detalhe do pedido **já estava no banco** — era a pergunta cuja resposta a
   gente já tinha.
2. **Cursor circular** (`offset % total`): ao dar a volta, reperguntava os mesmos
   pedidos para sempre, inclusive os que a Shopee ainda não tem como liquidar.
   Medido: 9.571 dos não liquidados eram de agosto e 7.785 de julho — estávamos
   perguntando repetidamente por dinheiro que eles ainda não tinham para dar.
3. **O cursor era uma posição numa lista filtrada que ENCOLHE.** Além de repetir,
   ele **pulava**: o pedido que estava na posição consumida nunca chegava a ser
   perguntado. Buraco no dado financeiro, e silencioso — pedido nunca perguntado
   não aparece em lugar nenhum como faltando.
4. **Nenhuma tentativa deixava marca.** `settlement_attempt_at` existia desde a
   migration 0014 e estava **NULO em 20.162 de 20.162 pedidos**.

E, por baixo dos quatro, a causa que travava tudo: a conciliação só rodava
**enquanto o sync de pedidos tinha trabalho**. No dia em que a ingestão alcançou
o presente e a linha virou `complete`, o passo inteiro passou a retornar em zero
segundo e o escrow deixou de existir — com 17 mil pedidos na fila e **nenhum erro
em lugar nenhum**.

Cobertura financeira medida naquele dia, mesma consulta nos quatro canais:

| Canal | Pedidos elegíveis | Com tarifa | Acima de 30 dias, com tarifa |
|---|---:|---:|---:|
| Mercado Livre | 37.775 | 37.775 (100%) | 100% |
| TikTok Shop | 10.384 | 9.985 (96%) | 100% |
| Amazon | 20.156 | 5.400 (27%) | 20% ¹ |
| Shopee | 20.164 | 3.030 (15%) | 28% |

¹ O número da Amazon é **horizonte, não buraco**: a coleta começa em junho/2026
e está em 100% em julho e 96% em agosto. Os pedidos antigos sem tarifa são
anteriores ao início da coleta. Nos 30 dias que o painel mostra, Amazon está em
96% e Shopee em **0,2%** — não são o mesmo problema.

**O defeito de fundo não é o escrow.** É não existir nenhum lugar no sistema que
responda *"quantas vezes eu já perguntei isso, e quando?"*.

## Decisão

**Três regras gerais sobre perguntar a um marketplace**, válidas para os quatro
canais, e **um contador** que torna possível verificá-las.

### 1. Não pergunte antes de poder haver resposta

Consulta a dado que o canal ainda não teria como fornecer é desperdício
garantido. Onde a janela for conhecida, respeite-a; onde não for, **descubra-a
medindo** em vez de escolher um número — e diga no código que o número é
prudência declarada, não medição.

### 2. Não repita a mesma pergunta sem intervalo

Toda fila de reconciliação ordena por **quem foi perguntado há mais tempo**, com
intervalo mínimo antes de reperguntar o mesmo item. `OFFSET` sobre lista filtrada
é proibido: ele repete e pula ao mesmo tempo.

### 3. Não pergunte o que você já sabe

Antes de uma chamada externa, verifique se o dado já está no canônico. Se
estiver, use-o — e valide que é mesmo o dado esperado, porque trocar uma chamada
a menos por um dado a menos é o pior dos dois.

### 4. Toda tentativa deixa marca, mesmo quando volta vazia

Sem a marca não existe diferença entre **"não há"** e **"não perguntei"** — e o
sistema lê ausência de marca como ausência de fato, escolhendo sempre a
interpretação errada. A marca é gravada **antes** da chamada, com o desfecho
atualizado depois: se a chamada morrer no meio, a marca tem que existir mesmo
assim.

> ⚠️ Este mesmo defeito apareceu **três vezes no mesmo dia**, em lugares que não
> se conhecem: `available_qty NOT NULL` transformando "não sei" em zero; evento
> de webhook com zero tentativas lido como evento novo; escrow sem carimbo lido
> como "a Shopee não postou". Coluna que existe e ninguém escreve é **pior** que
> coluna que falta, porque parece que está coberto.

### 5. Conciliação financeira é trabalho contínuo e não pode depender do ciclo de ingestão

A ingestão **termina**; a conciliação **não**. Compartilhar a mesma linha de
status faz um trabalho que acaba silenciar um que nunca acaba — e isso **não
produz erro, produz silêncio**. Conciliação roda como passo próprio, com claim
próprio.

### 6. Toda chamada externa é contada

`marketplace_api_calls` (migration 0019) guarda, **por endpoint e por hora**,
quantas chamadas foram feitas, quantas falharam, o último status e o último
cabeçalho de limite. Contagem **agregada**, nunca uma linha por chamada. O
contador fica no **funil de HTTP**, não na camada de negócio: o laço de
retentativa tenta até três vezes e a plataforma conta cada tentativa — contar
uma camada acima esconderia justamente as repetições, que é o que um alerta
enxerga. O endpoint entra pelo **formato** (`/orders/:id`), nunca pelo valor.

## Alternativas consideradas

- **Só baixar a frequência do agendador.** Não resolve: o problema não era
  frequência, era uma fila que nunca terminava e repetia. Menos frequência
  esconderia o defeito e atrasaria o dado dela junto.
- **Contar em memória e expor por métrica.** Contador que morre no deploy não
  responde *"e ontem às 3h?"*, que é exatamente a pergunta de um incidente.
- **Uma linha por chamada.** É a receita do coletor de métricas que derrubou a
  produção às 3h de 29/08: instrumento que custa mais do que aquilo que mede.
- **Adiar o contador e consertar só o escrow.** Sem o contador, o conserto não
  teria prova — e a diferença entre "consertamos" e "consertamos, e aqui está a
  prova" é o que se apresenta a uma plataforma que pediu explicação.

## Consequências

- **Ganha-se** a capacidade de responder a um alerta de plataforma com número em
  vez de inferência, nos quatro canais, com histórico de 90 dias (ADR-016).
- **Ganha-se** a distinção entre "não há" e "não perguntei" — que é o que permite
  a tela dizer a verdade em vez de escolher um culpado.
- **Custo medido** do contador (29/08/2026, contra produção): 1.700 chamadas
  viram **34 linhas**; descarga de **921ms** no pior caso (560ms quando é
  update); 48 kB de tabela. Acumula em memória e descarrega a cada 30s, **como
  fundo**.
- **Passa a ser obrigatório**: canal novo nasce contando. Um canal de fora é o
  buraco onde o próximo alerta cai — por isso o teste exige os quatro.
- **Fica em aberto**, com nome: a Amazon **também** não tem carimbo de tentativa;
  a armadilha está lá esperando. E falta apurar se a Transactions API permite
  buscar antes de junho/2026 — se permitir é backfill de histórico; se não
  permitir, a resposta honesta é *"esse histórico não existe para nós"* e a tela
  precisa dizer isso em vez de mostrar vazio.
- **O remendo e o desenho**: o claim próprio de conciliação (item 5) foi
  implementado primeiro como remendo dentro de `runShopeeSyncStep`. O desenho
  certo — conciliação como passo independente, para os quatro canais — continua
  pendente e é o que este ADR propõe.
