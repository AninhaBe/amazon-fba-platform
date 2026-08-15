# ADR-013: Worker de sync separado do serviço web, com agendador que honra o horário

- **Status:** Proposto
- **Data:** 2026-08-14
- **Altera:** [ADR-003](./ADR-003-cron-github-actions.md) (cron via GitHub Actions)

## Contexto

Hoje **um único processo faz dois trabalhos com necessidades opostas**:

| | Atender o site | Sincronizar |
|---|---|---|
| Duração | milissegundos | minutos (`maxDuration = 240`) |
| Memória | baixa e estável | picos altos |
| Falha é | inaceitável | rotineira (rate limit, token, API fora) |
| Quem sente | o usuário na tela | ninguém, se for retomável |

Os dois dividem o mesmo container porque o cron do ADR-003 chama `/api/cron/*-sync`
no próprio serviço web. **Quando o sync engasga, ele derruba o site junto.**

### Isto não é hipótese — aconteceu em 14/08/2026

O Render emitiu *"Web Service sellercore exceeded its memory limit, which triggered an
automatic restart. While restarting, the instance was temporarily unavailable."*
O site respondeu **503** para a usuária. A causa não foi tráfego: foi uma passada de
sync estourando os 512 MB da instância.

No dia anterior, o mesmo padrão em outra forma: o job `sync-tiktok` do cron recebeu
**502 após 37 s**, enquanto Amazon, ML e Shopee responderam em ~10 s **no mesmo
instante** — o serviço estava de pé, e só a rota pesada morreu.

### Duas forças que pioram com clientes

**1. O raio da falha cresce.** Com uma vendedora, um pico de sync é um susto. Com
cinquenta, o sync de um cliente derruba o painel de todos os outros — inclusive de
quem não tem relação nenhuma com aquela loja.

**2. O dimensionamento fica preso.** Para dar memória ao sync é preciso pagar uma
máquina maior que passa a maior parte do tempo ociosa servindo telas. No Render, sair
de 512 MB para 2 GB custa **US$ 7 → US$ 25/mês**, e a maior parte disso é comprada
para um pico que dura minutos por hora.

### E o agendador não cumpre o que promete

O `*/5 * * * *` do ADR-003 **não roda a cada 5 minutos**. Medição de 60 execuções
entre 11/08 22:34 e 14/08 14:07 (UTC):

| | |
|---|---|
| Intervalo mediano | **59 min** |
| Intervalo máximo | **155 min** |
| Execuções reais | **8% do previsto** (60 de 763) |

O GitHub Actions estrangula agendamentos de alta frequência — é comportamento
conhecido dele em runners compartilhados, não defeito nosso. As consequências são três:

- **Dado velho.** Até uma hora de atraso na sincronização.
- **Cobertura mentindo.** `COVERAGE_TOLERANCE_MS = 15 * 60_000` aparece em seis
  módulos (Amazon, ML, Shopee). Com o cron rodando a cada ~59 min, **o canal real
  falha a checagem na maior parte de cada hora** e o painel exibe "sincronização ainda
  não cobre todo o período" em cima de dado verdadeiro.
- **Teto de escala baixo.** Cada passada processa um número fixo de conexões
  (Amazon 2, ML 3, Shopee 3, TikTok 3). A 24 passadas/dia, supondo 4 atualizações
  diárias por vendedor, o sistema atende **~18 vendedores por canal**. A 288
  passadas/dia seriam ~216.

## Decisão

**Separar o sync do serviço web, e trocar o agendador por um que honre o horário.**

```
┌──────────────────────┐        ┌──────────────────────┐
│  Web service         │        │  Background worker   │
│  Next.js, telas      │        │  sync de todos os    │
│  e APIs de leitura   │        │  canais              │
│  pequeno e estável   │        │  dimensionado p/ pico│
└──────────┬───────────┘        └──────────┬───────────┘
           │                               │
           └────────── Postgres ───────────┘
                      (Supabase)
```

1. **O worker roda os schedulers diretamente**, importando
   `runScheduled*Sync()` — sem passar por HTTP. Some a rota, some o `maxDuration`,
   some o `CRON_SECRET` como superfície de ataque.
2. **O agendamento passa para o Render Cron Jobs** (ou um laço no próprio worker),
   que executa no horário declarado.
3. **As rotas `/api/cron/*` continuam existindo** por enquanto, como gatilho manual e
   como caminho de rollback — mas deixam de ser o mecanismo normal.
4. **Web e worker escalam separado.** O web fica na instância pequena; o worker recebe
   a memória que o sync precisa.

### Custo

| Arranjo | Mensal | O que acontece quando o sync estoura |
|---|---|---|
| Hoje: tudo num Free | US$ 0 | **o site cai** |
| Tudo num Standard | US$ 25 | o site cai, com mais folga antes |
| **Web Starter + worker Standard** | **US$ 32** | **o worker reinicia; o site não percebe** |

Os US$ 7 de diferença compram **isolamento de falha** — que é o que se vende para um
cliente pagante, não desempenho.

## Alternativas consideradas

- **Só aumentar a instância (Standard, US$ 25).** Resolve o sintoma de hoje e nada
  mais: o sync continua podendo derrubar o site, só demora mais para chegar lá. É o
  passo imediato recomendado, **não** a arquitetura.
- **Manter o GitHub Actions e aumentar a frequência declarada.** Não funciona — o
  estrangulamento é do lado do GitHub; declarar `*/1` não faz rodar mais.
- **Fila com workers elásticos (SQS/BullMQ + N consumidores).** É o destino natural
  quando houver volume, mas hoje é infra demais para o problema. Este ADR é o passo
  que torna essa evolução possível sem reescrever nada: com o sync já isolado, trocar
  "um worker" por "N workers com fila" fica contido.
- **Serverless (Vercel).** Isolaria naturalmente, mas quebra a allowlist de IP da
  Shopee e do TikTok, que exigem IP de saída estável. Descartado.

## Consequências

- ➕ **O site para de cair por causa do sync.** É a razão principal.
- ➕ **Dado fresco de verdade** — o agendamento passa a valer, e a tolerância de 15
  minutos volta a ser cumprível.
- ➕ **Escala 12× sem tocar em código de sync**, só pelo agendador funcionar.
- ➕ **Dimensionamento independente**: memória vai para onde é usada.
- ➖ **Um serviço a mais para operar e observar** (logs, alertas, deploy).
- ➖ **US$ 7/mês a mais** que a solução de instância única.
- ➖ **Sai do "não custa nada" do ADR-003.** Aquela decisão estava certa para a fase
  sem clientes; deixa de estar quando a indisponibilidade tem dono.

## O que fica pendente e não é decidido aqui

- **Rate limit é por aplicação, não por vendedor.** A cota da Shopee, do TikTok e do
  ML é do nosso app inteiro — já batemos no limite do TikTok com **uma** loja. Passado
  certo volume, o gargalo deixa de ser servidor e vira **orçamento de cota**: priorizar
  quem precisa de dado fresco e espaçar quem não precisa. Este ADR não resolve isso;
  apenas cria o lugar certo (o worker) para resolver depois.
- **Onde o worker roda.** Render, Fly.io ou VPS — decisão separada, ligada ao
  [ADR-006](./ADR-006-migracao-self-hosted-coolify.md). Mudar de servidor troca o IP de
  saída, e Shopee e TikTok precisam da allowlist atualizada antes da virada.
