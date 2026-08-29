# ADR-034: Conciliação é passo próprio, e toda fila deixa marca

- **Status:** Proposto
- **Data:** 2026-08-29

> ## A regra
>
> **Toda fonte externa que a gente consulta EM FILA deixa marca de tentativa com
> desfecho, mesmo quando volta vazia. E a conciliação que consome essa fila roda
> como passo próprio, com claim próprio — nunca de carona no ciclo de ingestão.**
>
> Vale para os quatro canais, e para o quinto que ainda não existe. Se você só
> for ler uma linha deste documento daqui a um ano, é esta.

## Contexto

Isto é o item 5 do [ADR-032](./ADR-032-quanto-o-nexo-pode-perguntar-a-um-marketplace.md)
virando desenho. Lá a decisão foi tomada e implementada como **remendo
consciente** — um claim dentro de `runShopeeSyncStep`. Este ADR é a parte (b) que
ficou.

### O que a Shopee ensinou (e custou meses)

O escrow da Shopee funcionou por meses e **morreu em silêncio**. A conciliação
compartilhava a linha de status da ingestão; quando a ingestão marcou
`complete`, o trabalho que nunca acaba parou junto com o que acaba. Não houve
erro, não houve alerta — houve **ausência**. E ausência não dispara nada.

Quando fomos olhar, `settlement_attempt_at` estava nulo em 20.162 de 20.162
pedidos: **não havia como saber** se a Shopee não tinha postado o escrow ou se a
gente nunca tinha perguntado. A tela, no escuro, escolheu a explicação errada e
culpou o fornecedor dela.

### A Amazon estava no mesmo buraco, e ninguém tinha medido

Medido em produção em **29/08/2026**:

- **22.347 pedidos da Amazon — 22.347 sem carimbo de tentativa, 0 liquidados.**
- `/finances/2024-06-19/transactions` recusando **~20% das chamadas**, de forma
  sustentada (62, 57 e 64 erros em três horas seguidas), **todas 429**.
- O log da SP-API mostrando a mesma chamada indo a `tentativa: 4` — com
  `maxRetries = 3`, a quarta **lança**.
- E o erro caindo num `catch { return; }` **mudo** dentro de `amazonSync.ts`: o
  lote inteiro de tarifas era abandonado sem uma linha em lugar nenhum.

Isso é a explicação medida da **cobertura financeira de 27%** da Amazon. Não era
lentidão nem histórico faltando: era desistência silenciosa, repetida, dentro do
ciclo de ingestão.

> ⚠️ O log já foi consertado sozinho, antes deste ADR, porque **registrar não é
> mudar**: não muda quando chama, nem quantas vezes, nem o que grava. O carimbo
> por pedido — que é mudança de comportamento — é o que este documento propõe.

### Por que a regra tem que ser GERAL

ML e TikTok estão em **100% e 96%** de cobertura hoje, e é exatamente por isso
que ninguém olha para eles. Foi assim que o escrow da Shopee morreu: **depois de
meses funcionando**. Uma regra escrita só para "Amazon e Shopee" seria a regra
escrita para os dois canais onde a gente já se queimou — e o próximo silêncio
nasceria no canal saudável, que é onde ninguém procura.

## Decisão

### 1. Marca de tentativa é obrigatória em toda fila contra fonte externa

Qualquer trabalho que percorra uma fila perguntando a um terceiro grava, **por
item**: quando perguntou, e qual foi o desfecho — inclusive `vazio` e
`recusado`. A marca é gravada **antes** da chamada e o desfecho atualizado
depois: se a chamada morrer no meio, a marca existe assim mesmo.

Sem isso não há diferença entre **"não há"** e **"não perguntei"**, e o sistema
lê ausência de marca como ausência de fato — sempre a interpretação errada.

Canal novo nasce com carimbo, como já nasce contando (ADR-032, item 6).

### 2. A ordem da fila sai da marca, não de um cursor

Ordenar por `marca ASC NULLS FIRST` faz a fila se sustentar sozinha: quem nunca
foi perguntado vem primeiro, depois quem foi perguntado há mais tempo. **Não há
posição para pular nem volta para repetir** — a estrutura que produzia os dois
defeitos (pular e repetir) deixa de existir, em vez de ser corrigida.

É o desenho que já está no ar na Shopee e que se provou: 489 de 490 tentativas
liquidaram, zero erro, zero 429.

### 3. Conciliação tem claim próprio, separado do da ingestão

A ingestão **termina**; a conciliação **não**. Compartilhar linha de status faz
um trabalho que acaba silenciar um que nunca acaba — e isso não produz erro,
produz silêncio.

Claim próprio significa: linha de estado própria, intervalo próprio, e um
`complete` da ingestão que **não tem como** parar a conciliação. Hoje isso é um
remendo dentro de `runShopeeSyncStep`; o desenho tira de lá.

### 4. Desistência é evento, não retorno vazio

Quando a conciliação desiste de um lote — recusa da fonte, indisponibilidade,
orçamento de retentativa estourado — ela **registra**: etapa, motivo, quanto
ficou para trás, e o identificador de requisição da fonte quando existir
(`x-amzn-RequestId` na Amazon é o que o suporte deles pede).

Desistir é legítimo. Desistir em silêncio não.

## Alternativas consideradas

- **Só consertar a Amazon, que é onde dói agora.** É o que a gente fez com a
  Shopee, e o resultado foi descobrir a mesma armadilha na Amazon meses depois,
  por acaso, num dia em que fomos medir outra coisa. Conserto por canal
  reproduz o defeito no canal seguinte.
- **Alerta de cobertura em vez de carimbo.** Um alerta compara números e não
  sabe dizer por quê. Carimbo responde *"perguntamos, e a fonte disse que não
  há"* — que é a pergunta real. Alerta sem carimbo dispara sem diagnóstico.
- **Confiar no `complete` e revisar quando a cobertura cair.** Foi exatamente o
  que estava valendo. A cobertura da Amazon está em 27% há tempo suficiente para
  ninguém estranhar mais, e uma queda lenta não parece incidente — parece o
  normal.
- **Deixar a regra só para os dois canais queimados.** Recusada explicitamente:
  ML e TikTok estarem saudáveis é o motivo de escrever a regra para eles, não o
  motivo de deixá-los de fora.

## Consequências

- **Ganha-se** a distinção entre "não há" e "não perguntei" nos quatro canais, e
  não só onde a gente já apanhou.
- **Ganha-se** um diagnóstico em vez de um número: quando a cobertura cair, a
  marca diz se foi a fonte que não postou ou nós que não perguntamos.
- **Custo**: uma coluna de marca e uma de desfecho por fila, e uma linha de
  estado a mais por canal. Escrita por item, não por chamada — o mesmo padrão da
  Shopee, que não pesou.
- **Migration necessária** para a Amazon (`settlement_attempt_at` /
  `settlement_outcome` já existem no canônico, mas nunca foram escritos por ela)
  e verificação item a item em ML e TikTok.
- **Depende do item 7 do ADR-032.** Carimbar sem respeitar o teto declarado só
  documentaria melhor a mesma recusa: a fila continuaria batendo em 429, e a
  marca registraria fielmente que a gente insistiu errado.
- **Fica em aberto, com nome**: apurar se a Transactions API permite buscar antes
  de junho/2026. Se permitir, é backfill; se não permitir, a resposta honesta é
  *"esse histórico não existe para nós"* e a tela precisa dizer isso em vez de
  mostrar vazio.
