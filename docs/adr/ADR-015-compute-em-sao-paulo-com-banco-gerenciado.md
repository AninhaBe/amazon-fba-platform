# ADR-015: Compute em São Paulo com banco gerenciado

- **Status:** Proposto
- **Data:** 2026-08-19

> 🔄 **Revisado no mesmo dia, algumas horas depois de escrito.** A primeira versão
> escolhia **VPS + Coolify**, e usava como justificativa, entre outras, o desejo declarado
> da dona de *aprender a operar infraestrutura*. Ao ver a lista completa de
> responsabilidades que isso traria, ela reviu a prioridade — textualmente: *"latência,
> óbvio, a menor possível. não faço questão de aprender sobre infra, se o Fly cuida disso,
> melhor ainda"*. A **decisão de fundo não mudou** (compute em São Paulo, banco
> gerenciado); mudou o **mecanismo**, de VPS auto-administrada para **Fly.io**.
> VPS + Coolify segue registrada em "Alternativas consideradas".

## Contexto

O [ADR-006](./ADR-006-migracao-self-hosted-coolify.md) foi escrito em **julho de 2026**
sob uma premissa explícita: *"o momento é ideal porque ainda não há usuários reais"*.
**Essa premissa venceu.** Hoje existe operação viva: vendas na Amazon, verba de anúncio
rodando e leitura de campanha diária. A janela em que uma migração big-bang custava
apenas tempo fechou.

Enquanto isso, três dores estão medidas:

| Dor | Medida | Quando |
|---|---|---|
| Banco acima do limite do plano | **559 MB** e subindo ~7 MB/dia (Supabase Free: 500 MB) | 19/08 |
| Container derrubado por RAM | Render Free, 512 MB, durante cron do TikTok | 15/08 |
| Latência app↔banco | **~180 ms** (Oregon ↔ São Paulo) | — |

### Evidência externa sobre latência (19/08)

Dois operadores independentes, consultados pela dona do produto, convergiram na **mesma
topologia**: compute em São Paulo, banco gerenciado. Um deles descreveu exatamente o
nosso arranjo — app no Railway (Virgínia) com Supabase em SP — e relatou que mover o
compute para SP (**Fly.io `gru`**) tornou a comunicação *"praticamente instantânea"*.

⚠️ **Isso não é prova para o NEXO.** A leitura do painel vem do cache SWR
([ADR-002](./ADR-002-cache-swr.md)), que absorve a latência por design; o app dele pode
ser sensível por request de um jeito que o nosso não é. Mas é **medição no eixo que o
ADR-006 não considerou** — ele escolhe VPS na Hetzner, sem tratar de região.

### O objetivo, declarado sem ambiguidade

**Latência, a menor possível. Operar servidor não é objetivo — é custo a evitar.**

Isso descarta como critério de decisão tanto "aprender ops" quanto economia: a diferença
de preço entre as opções viáveis é de dezenas de reais por mês e **não** decide nada aqui.

## O problema com o ADR-006 como está escrito

**Ele é atômico.** Empacota quatro mudanças independentes:

1. tirar o compute do Render;
2. self-hostar o Postgres;
3. trocar o Auth por Better Auth ([ADR-007](./ADR-007-arquitetura-de-auth.md)) — que o
   próprio ADR-006 admite que **"não é trocar 6 arquivos"**: identidade, sessão,
   workspace, middleware, recuperação de senha e e-mail;
4. mover o cron.

Cada uma tem risco próprio, e juntas fazem **a mais arriscada (auth) segurar a mais
barata (compute)**. Enquanto o Better Auth não estiver pronto, nada se move — e o
container continua caindo por RAM.

## Decisão

**Mover apenas o compute para o Fly.io na região `gru` (São Paulo).**
**Banco e Auth permanecem no Supabase.** O resto do ADR-006 segue valendo como escrito,
para uma fase posterior.

### A reversão que este ADR assume explicitamente

O ADR-006 listou *"Manter Supabase Cloud só para Auth"* em **Alternativas consideradas** e
a **rejeitou** — "deixa uma dependência SaaS, contra o objetivo de self-hosted/OSS". Ele
também rejeitou *"outro PaaS gerenciado (Railway/Fly)"* por "custo/OSS/controle" —
**antes de a região São Paulo entrar na conta**, que é o critério que decide aqui.

Este ADR **adota as duas alternativas como estado intermediário, não como destino.** O
objetivo de self-hosted/OSS do ADR-006 continua de pé; o que muda é a ordem.

### Topologia

```
Fly.io — região gru (São Paulo)
├── máquina rodando a imagem Docker do NEXO
├── TLS e roteamento (gerenciados pelo Fly)
└── volume persistente montado em DATA_DIR

Gerenciado (inalterado)
├── Supabase — Postgres + Auth, São Paulo
└── GitHub Actions — cron de sync (ADR-003, intocado)
```

### Por que o Fly e não uma VPS

A tabela de "ops que passam a ser nossos" da versão anterior deste ADR — patch de SO,
atualizar o Coolify, firewall, monitoramento, limpeza de disco e **plantão** — **deixa de
existir**. É gerenciado. Dado o objetivo declarado, isso não é um detalhe: é a decisão.

O trabalho de containerização feito em 19/08 **não é perdido**: o Fly consome
`Dockerfile` nativamente, e a mesma imagem roda em Fly, Coolify ou qualquer VPS. É o que
mantém esta decisão reversível.

### 🔴 Pré-requisito duro: domínio próprio

**Antes de qualquer outra coisa**: registrar domínio e cadastrá-lo nas allowlists de
**Shopee e TikTok**, ao lado de `sellercore.onrender.com` — não no lugar dela.

`sellercore.onrender.com` é **Redirect URI** de OAuth nos dois canais (ver
[`AGENTS.md`](../../AGENTS.md)). Trocar de host sem domínio próprio **quebra o OAuth dos
dois**. Isso é necessário em **todos** os cenários, inclusive no de ficar no Render — não
é custo desta migração.

### ⚠️ Configuração que NÃO pode ser esquecida

**`auto_stop_machines` deve ficar desligado, com no mínimo 1 máquina sempre de pé.**

O cache do NEXO vive **na memória do processo** ([ADR-002](./ADR-002-cache-swr.md)), e a
conciliação de tarifas roda em background dentro do web. Máquina que hiberna e reinicia
perde o cache e mata trabalho em andamento — seria reintroduzir, por configuração, o
mesmo problema que fez a Vercel ser rejeitada.

Da mesma forma, **`DATA_DIR` precisa de volume montado**: o app grava custos e contas
OAuth em disco. Sem volume, cada deploy apaga.

### Sequência (cada passo reversível)

1. **Domínio** no Registro.br + cadastro nas allowlists de Shopee e TikTok.
2. **Destravar o banco**: Supabase Pro **ou** reduzir o banco abaixo de 500 MB. Independe
   de hospedagem e é o que está pegando fogo hoje.
3. **Deploy no Fly** em `gru`, num subdomínio, com o **Render servindo produção o tempo
   todo**.
4. **Medir a latência de verdade**, comparando com o Render. É a justificativa inteira
   desta decisão — se não melhorar, ela cai.
5. **Cutover de DNS**; Render de pé por um período de observação.
6. Só então avaliar a **Fase B** (Postgres self-hosted + Better Auth), pelo ADR-006.

### Custo (levantado em 19/08/2026, da pagina oficial de precos)

**Nao ha plano fixo — e pay-as-you-go por segundo de maquina, GB provisionado e GB de
egress.**

| Item | Preco | Nosso caso |
|---|---|---|
| `shared-cpu-1x` 1 GB | $0,00000228/s (~$5,92/mes) | 1 maquina 24/7 |
| Volume | $0,15/GB/mes | 1 GB = $0,15 |
| Egress America do Sul | $0,04/GB | trafego de painel, centavos |
| TLS (ate 10 hostnames) | gratis | $0 |
| IPv4 dedicado | $2/mes | so se necessario |

**~$6–8/mes**, contra ~$25 do Render Standard e ~$14 de uma VPS equivalente. O Fly e o
mais barato dos tres, o unico gerenciado e o unico em Sao Paulo — mas **isso continua nao
sendo o criterio**: a decisao e por latencia.

⚠️ **Duas ressalvas do modelo de consumo:**

1. **Nao existe teto.** Plano fixo protege de erro proprio; consumo nao. **Configurar
   limite de gasto e alerta antes do primeiro deploy** e requisito, nao sugestao.
2. **A economia principal da plataforma foi desligada de proposito.** O modelo do Fly
   brilha com maquina hibernando; `auto_stop_machines = false` mantem tudo de pe 24/7 por
   causa do cache em memoria (ADR-002). Pagamos o mes cheio conscientemente — os ~$6 ja
   refletem isso.

Free tier nao existe mais (so trial). Suporte pago comeca em $29/mes — mais caro que a
infra; o da comunidade atende neste porte.

### O que o Fly entrega de maquina (levantado 19/08/2026)

| Tipo | vCPU | RAM possivel |
|---|---|---|
| `shared-cpu-1x` a `8x` | 1 a 8 | 256 MB x N ate **2 GB x N** |
| `performance-1x` a `8x` | 1 a 8 | 2 GB x N ate 8 GB x N |

#### ⚠️ "shared" = 6,25% de um nucleo, com burst

Shared e performance rodam no **mesmo hardware, mesmo clock**. A diferenca e tempo de
execucao por periodo de 80 ms:

```
shared      ->  5 ms / 80 ms  =  6,25% de um nucleo (sustentado)
performance -> 80 ms / 80 ms  =  100%
```

Tempo ocioso vira **saldo de burst, ate 500 segundos** de CPU cheia. Estourou o saldo, a
maquina e estrangulada nos 6,25% ate recarregar.

**Por que importa aqui:** o cron bate a cada 5 min, syncs tem orcamento de 20-60s e a
conciliacao de tarifas roda em background — isso queima saldo. Referencia util: o **Render
Free da 0,1 CPU sustentado e zero burst**, e o app sobrevive nele hoje. O Fly da menos
base e 500s de rajada. Tende a ser melhor para este perfil, mas e **metrica para medir
depois do deploy**, nao premissa.

Se os syncs estourarem o saldo com frequencia, o caminho e `performance-1x` — e ai o custo
sobe muito e a comparacao com Render Standard volta a ficar parelha. **Conferir o saldo de
burst antes de declarar que `shared-cpu-1x` serve.**

#### ⚠️ Volume e disco local sem replica

Documentacao do Fly: um volume e *"uma fatia de um NVMe no mesmo servidor fisico da
Machine"* — comparam com o disco interno de um notebook. **Sem replicacao**: se o NVMe
falha, a aplicacao cai. Eles recomendam **provisionar pelo menos dois volumes por app**.
Snapshot diario automatico existe (5 dias de retencao, configuravel), mas a propria
documentacao diz que **nao deve ser o backup principal**. Volume nao encolhe depois de
criado; maximo de 500 GB.

Nossa topologia (1 maquina, 1 volume) e exatamente o arranjo que eles desaconselham.
Aceito nesta fase porque o `DATA_DIR` guarda contas OAuth (reconectaveis) e custos — mas
**reforca que esse dado deveria migrar para o Postgres**, o que vale igualmente em Fly,
Render ou VPS.

### Dimensionamento inicial

**1 vCPU compartilhada / 1 GB**, ajustando pela medição. Referência: o Render Free
morreu com 512 MB durante o cron do TikTok, então 512 MB está descartado. Subir só com
número medido, não por precaução.

## Alternativas consideradas

- **VPS + Coolify (Hostinger KVM 2 ou similar), em São Paulo** — era a escolha da primeira
  versão deste ADR. Entrega a mesma latência pelo mesmo custo aproximado, mas transfere
  patch de SO, firewall, monitoramento, backup de configuração e plantão para a operação.
  **Rejeitada quando o objetivo foi declarado como latência, não aprendizado.** Continua
  sendo o caminho natural se algum dia o objetivo voltar a incluir controle total — e o
  `Dockerfile` mantém essa porta aberta.
- **Ficar no Render Standard** (recomendação de
  [`../infra-decisao-hospedagem.md`](../infra-decisao-hospedagem.md), 19/08): menor
  esforço, custo previsível, zero migração. **Mas mantém os 180 ms**, que é justamente o
  que se quer eliminar. Continua sendo o fallback se o passo 4 não mostrar ganho.
- **ADR-006 integral agora:** rejeitado por ora — bundle atômico, com o rework de auth
  segurando o resto, na pior janela para isso.
- **Vercel `gru1`:** rejeitado — serverless mata o cache em processo
  ([ADR-002](./ADR-002-cache-swr.md)) e exigiria o
  [ADR-014](./ADR-014-cache-fora-do-processo-e-ingestao-em-fluxo.md) como pré-requisito,
  além de rework dos syncs longos.

## Consequências

- ➕ Compute e banco na mesma região — remove os 180 ms do caminho frio.
- ➕ **Nenhuma responsabilidade de operação de servidor** é assumida.
- ➕ **Rollback é troca de DNS.** Render e Supabase seguem de pé.
- ➕ O `Dockerfile` mantém a portabilidade: sair do Fly depois custa reconfiguração, não
  reescrita.
- ➕ Destrava o caminho do ADR-006 sem big bang.
- ➖ **Mantém duas dependências SaaS** (Fly + Supabase), contra o objetivo declarado do
  produto — consciente e temporário.
- ➖ Menos controle que VPS: capacidade, manutenção e incidentes do Fly são dele, e a
  região `gru` historicamente opera cheia. **Verificar disponibilidade antes de planejar.**
- ➖ **Risco de o intermediário virar permanente por inércia** — daí os gatilhos abaixo.
- ➖ `DATA_DIR` continua em volume de cópia única. Não é regressão (é assim no Render
  hoje), mas contas OAuth em disco local é fragilidade que deveria migrar para o Postgres.

## Gatilhos que revisam esta decisão

| Gatilho | Ação |
|---|---|
| **Latência medida no passo 4 não melhorar** | **A justificativa inteira cai** — fica no Render |
| Sem capacidade em `gru` | Reavalia VPS em SP (o Dockerfile serve aos dois) |
| Better Auth (ADR-007) pronto | Abre a Fase B (ADR-006) |
| Custo ou limite do Supabase apertando | Antecipa Postgres self-hosted |
| Objetivo voltar a incluir controle/OSS | VPS + Coolify volta à mesa |

## O que este ADR NÃO decide

- **Não revoga o ADR-006** — divide a execução dele em fases. O destino segue o mesmo.
- Data da Fase B.
- Se o banco vai para Supabase Pro ou se dá para reduzi-lo abaixo de 500 MB — decisão do
  passo 2, pendente de tratar a retenção de `workspace_marketplace_events` (172 MB, ~8.000
  linhas/dia, sem política de expurgo).

Relacionado: [ADR-006](./ADR-006-migracao-self-hosted-coolify.md) ·
[ADR-007](./ADR-007-arquitetura-de-auth.md) ·
[ADR-002](./ADR-002-cache-swr.md) ·
[ADR-014](./ADR-014-cache-fora-do-processo-e-ingestao-em-fluxo.md) ·
[`../docker.md`](../docker.md) ·
[`../infra-decisao-hospedagem.md`](../infra-decisao-hospedagem.md)
