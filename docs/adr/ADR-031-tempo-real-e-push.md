# ADR-031: Tempo real é push — e é do dado até os olhos dela

- **Status:** Proposto — plano no portão, sem implementação
- **Data:** 2026-08-29

## Contexto

A dona disse: *"mas o objetivo é ser real time"*. Ela está certa, e o plano
existe porque ela está certa.

⚠️ **Isto não revoga o [ADR-030](./ADR-030-fundo-nao-compete-com-a-tela.md).**
Pesquisa a cada 2 minutos **nunca foi tempo real** — era atraso de até 2 minutos
com nome bonito —, e na noite de 29/08 foi a causa de a tela não carregar.
Trocar 2 por 10 minutos na Amazon não afasta o produto do tempo real: afasta o
produto de um custo que **não comprava tempo real nenhum**.

Tempo real de verdade é **push**. E há um segundo eixo, sem o qual a palavra não
significa nada.

## As duas metades da mesma frente

> De que adianta o pedido chegar no banco em 1 segundo se a tela leva **28
> transações** e 2,8s para compor — e na noite do incidente levou **54s**?

**Tempo real é do dado até os OLHOS dela, não até a nossa tabela.** As duas
frentes são uma só, e um plano que entregue só a primeira metade produz um
sistema que ingere rápido e mostra devagar.

| Eixo | Onde está hoje | Alvo |
|---|---|---|
| **A. Ingestão** — do fato no marketplace até o nosso banco | 3 a 10 min (polling) | segundos (push) |
| **B. Leitura** — do nosso banco até a tela | 28 transações, ~280ms (bom) a 54s (sob contenção) | 1 chamada, orçamento do ADR-017 |

O eixo B **já tem dono**: é a frente das 28 transações, aberta no ADR-030. Este
ADR trata do eixo A e declara que ele **não fecha sozinho**.

## O que já existe (verificado no repo, não suposto)

| Canal | Push | Situação |
|---|---|---|
| **Mercado Livre** | webhook | **IMPLEMENTADO E RECEBENDO** — `src/app/api/webhooks/mercado-livre`, 35.791 eventos processados, **4.032 nas últimas 24h** |
| **Shopee** | Push Mechanism (Push URL + assinatura) | documentado em `api-shopee.md`, não implementado |
| **TikTok** | webhook no Partner Center (`ORDER_STATUS_CHANGE`) | Partner Center já é nosso, não implementado |
| **Amazon** | SP-API Notifications (SQS/EventBridge) | desenho **já decidido** no [ADR-023](./ADR-023-notificacoes-da-amazon.md) |

## ⚠️ Crítica à ordem proposta — e uma medição que a muda

A ordem sugerida foi **Shopee → TikTok → Amazon**, pelo volume e pela
simplicidade de HTTP direto. Concordo com o raciocínio, **e proponho um passo
zero antes dela**, por causa de um número que só apareceu ao verificar o repo:

```
mercado_livre  complete   35.791
mercado_livre  pending       207   ← parados desde 28/08 14:52 (~13 horas)
mercado_livre  error           3
```

**Já temos push em produção, com 207 eventos parados.** Isso é a prova viva do
que este ADR precisa assumir: *push se perde, chega fora de ordem e chega
duplicado*. Não é teoria emprestada de outro sistema — é o nosso, medido.

### Passo 0: aprender com o push que já existe

Antes de integrar o segundo canal, extrair do ML o que só um push em produção
ensina, com **zero integração nova**:

1. **Por que 207 estão `pending`?** Fila que não drena é o modo de falha nº 1 de
   push — e ela é silenciosa, porque o polling encobre.
2. **Qual a taxa real de perda?** Comparar pedidos que chegaram por webhook
   contra os que só o ciclo encontrou, na mesma janela. Esse número é o que
   dimensiona a rede de segurança dos outros três.
3. **Qual a latência real do push?** Do `occurred_at` no marketplace até o
   `received_at` no nosso banco. É o número que responde "quão tempo real?" com
   fato em vez de promessa.

Sem isso, os três canais seguintes repetem o mesmo desenho sem saber se ele
funciona — e descobrimos os defeitos três vezes em vez de uma.

📌 Custo do passo 0: horas, não dias. E ele **destrava** a hardening do webhook
do ML que já está registrada como pendência (validar origem por token secreto).

### Ordem, depois do passo 0

| # | Canal | Por quê aqui | Custo/risco |
|---|---|---|---|
| 1 | **Shopee** | canal mais movimentado dela (14,1 pedidos/h, mediana 2,3 min) e push é **HTTP direto**, sem infra de terceiro | assinatura a validar; Push URL no app |
| 2 | **TikTok** | também HTTP, Partner Center já é nosso | configuração no painel |
| 3 | **Amazon** | exige **fila na AWS** (SQS/EventBridge, política de recurso, DLQ): infraestrutura nova, com custo e conta — decisão que passa pela dona | maior, e não é só código |

Concordo com a Amazon por último **e por um motivo a mais que o custo**: ela é o
canal de menor ritmo (1,8 pedidos/h, mediana de 18,3 min). É onde o push muda
menos a vida dela — e onde o polling de 10 minutos já é quase indistinguível de
tempo real na prática.

## Decisão de desenho (a que vale para os quatro)

### Push não substitui o ciclo — ele muda o papel dele

O ciclo deixa de ser **o mecanismo** e vira a **rede de segurança**:
reconciliação para o que o push perdeu.

Isso não é conservadorismo: é consequência do que push é. Push **se perde**
(rede, deploy, indisponibilidade nossa), **chega fora de ordem** e **chega
duplicado**. Um sistema que confia só no push fica com buracos que ninguém vê —
e os 207 `pending` do ML mostram que o buraco já existe.

**Consequência prática, e ela é boa nos dois eixos ao mesmo tempo:**

> Intervalo de 10 minutos **com** push é melhor que 2 minutos **sem** push —
> mais rápido para o que importa e mais leve para o banco.

### Requisitos que valem para todo push que entrar

1. **Idempotência por chave externa.** Evento duplicado não pode duplicar dado —
   o webhook do ML já faz isso por upsert, e é o padrão a copiar.
2. **Ordem não pode ser assumida.** O estado final vale, não a sequência de
   chegada.
3. **Origem verificada.** Assinatura (Shopee, TikTok) ou token secreto (ML —
   pendência já registrada). Endpoint público sem verificação é superfície.
4. **Fila com dreno observável.** Se `pending` crescer, alguém tem que saber —
   os 207 parados por 13 horas passaram despercebidos.
5. **Trabalho de push é trabalho de FUNDO** (ADR-030): usa o pool do fundo, não
   o da tela. Um pico de webhook não pode competir com a dona olhando o painel.
6. **Métrica de latência de ponta a ponta**, do `occurred_at` ao visível — e
   medida com o custo do próprio instrumento em mente (lição de 29/08: o coletor
   de métricas derrubou produção).

## O que este ADR NÃO decide

- Não escolhe SQS vs EventBridge para a Amazon: isso é do ADR-023, e depende de
  conta e custo que passam pela dona.
- Não fixa os intervalos de polling pós-push. Eles devem **subir** quando o push
  provar taxa de perda baixa — mas subir com número na mão, não por otimismo.
- Não trata do eixo B (as 28 transações). Frente própria, ADR-030.

## Pendente

1. Portão do cérebro sobre a ordem (com o passo 0 acrescentado).
2. Estabilidade confirmada e a dona usando o app — nada disto começa no rastro
   de um incidente.
3. Decisão da dona sobre a conta AWS, antes de a Amazon entrar na fila.
