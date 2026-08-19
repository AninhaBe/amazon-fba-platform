# ADR-015: Compute em São Paulo com banco gerenciado — fase intermediária do ADR-006

- **Status:** Proposto
- **Data:** 2026-08-19

## Contexto

O [ADR-006](./ADR-006-migracao-self-hosted-coolify.md) foi escrito em **julho de 2026**
sob uma premissa explícita: *"o momento é ideal porque ainda não há usuários reais"*.
**Essa premissa venceu.** Hoje existe operação viva: vendas na Amazon, verba de anúncio
rodando e leitura de campanha diária. A janela em que uma migração big-bang custava
apenas tempo fechou.

Enquanto isso, três dores estão medidas:

| Dor | Medida | Quando |
|---|---|---|
| Banco acima do limite do plano | **526 MB de 500 MB** (Supabase Free) | 19/08 |
| Container derrubado por RAM | Render Free, 512 MB, durante cron do TikTok | 15/08 |
| Latência app↔banco | **~180 ms** (Oregon ↔ São Paulo) | — |

### Evidência externa sobre latência (19/08)

Dois operadores independentes, consultados pela dona do produto, convergiram na **mesma
topologia**: compute em São Paulo, banco gerenciado. Um deles descreveu exatamente o
nosso arranjo — app no Railway (Virgínia) com Supabase em SP — e relatou que mover o
compute para SP (Fly.io `gru`) tornou a comunicação *"praticamente instantânea"*.

⚠️ **Isso não é prova para o NEXO.** A leitura do painel vem do cache SWR
([ADR-002](./ADR-002-cache-swr.md)), que absorve a latência por design; o app dele pode
ser sensível por request de um jeito que o nosso não é. Mas é **medição no eixo que o
ADR-006 não considerou** — ele escolhe VPS na Hetzner, sem tratar de região.

### A motivação declarada mudou

A dona não quer isso para economizar: a economia é pequena (~R$ 215/mês contra ~R$ 275
do Render Standard + Supabase Pro). Ela quer **aprender a operar a infraestrutura que
vai rodar por anos num SaaS próprio**. É motivo diferente de "cortar custo" — e mais
sólido, porque o retorno não depende de a conta fechar.

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

**Dividir o ADR-006 em fases. Esta é a Fase A: mover apenas o compute** para uma VPS em
São Paulo com Coolify. **Banco e Auth permanecem no Supabase.** Todo o resto do ADR-006
segue valendo como escrito, para uma fase posterior.

### A reversão que este ADR assume explicitamente

O ADR-006 listou *"Manter Supabase Cloud só para Auth"* em **Alternativas consideradas** e
a **rejeitou** — "deixa uma dependência SaaS, contra o objetivo de self-hosted/OSS".

Este ADR **adota essa alternativa como estado intermediário, não como destino.** O objetivo
de self-hosted/OSS do ADR-006 continua de pé; o que muda é a ordem. Trocamos pureza
temporária por reversibilidade, num momento em que a operação está viva e o ADR-006 não
estava.

### Topologia — Fase A

```
VPS em São Paulo (Coolify)
├── Coolify (control plane)
├── reverse proxy / TLS (Let's Encrypt)
└── NEXO (Next.js 16)

Gerenciado (inalterado)
├── Supabase — Postgres + Auth, São Paulo
└── GitHub Actions — cron de sync (ADR-003, intocado)
```

### 🔴 Pré-requisito duro: domínio próprio

**Antes de qualquer outra coisa**: registrar domínio e cadastrá-lo nas allowlists de
**Shopee e TikTok**, ao lado de `sellercore.onrender.com` — não no lugar dela.

`sellercore.onrender.com` é **Redirect URI** de OAuth nos dois canais (ver
[`AGENTS.md`](../../AGENTS.md)). Trocar de host sem domínio próprio **quebra o OAuth dos
dois**. Isso é necessário em **todos** os cenários, inclusive no de ficar no Render — não
é custo desta migração.

### Sequência (cada passo reversível)

1. **Domínio** no Registro.br + cadastro nas allowlists de Shopee e TikTok.
2. **Destravar o banco**: Supabase Pro **ou** reduzir o banco abaixo de 500 MB. Independe
   de hospedagem e é o que está pegando fogo hoje.
3. **VPS + Coolify** em São Paulo; deploy do NEXO num **subdomínio** (`beta.`), com o
   **Render servindo produção o tempo todo**.
4. **Soak**: só avança depois de a VPS sobreviver a um deploy, um reboot e uma
   atualização do Coolify.
5. **Cutover de DNS**; Render de pé por um período de observação.
6. Só então avaliar a **Fase B** (Postgres self-hosted + Better Auth), pelo ADR-006.

### Prazo de contrato

**O mais curto disponível — não 24 meses.** O plano longo cobra o período inteiro
adiantado (~R$ 1.056 na Hostinger) e trava dois anos numa decisão ainda **Proposta**,
cujo valor principal é aprendizado. Se depois de alguns meses a operação se provar,
aí se compromete o prazo longo.

### Dimensionamento

**2 vCPU / 8 GB / ~100 GB** (ex.: Hostinger KVM 2), em São Paulo.

- Sem Postgres na caixa, a preocupação do ADR-006 — *"build do Next.js disputa recursos
  com o Postgres"* — **deixa de valer nesta fase**. 8 GB acomodam build, app e Coolify.
- **Disco não é restrição em cenário nenhum**: o banco tem 526 MB. Os ~100 GB são a
  **máquina inteira** (SO, imagens e cache de build do Docker, logs), não um volume de
  dados — e o cache de build do Docker é o que enche disco em servidor Coolify sem
  ninguém perceber.

### Ops que passam a ser nossos

| Nosso a partir da Fase A | Continua gerenciado |
|---|---|
| Patch de segurança do SO, reboot | **Backup do banco** |
| Atualizar o Coolify | **Restore e PITR** |
| Firewall e SSH (chave, não senha) | **Integridade do Postgres** |
| Monitoramento e alerta | Auth (GoTrue) |
| Limpeza do cache de build do Docker | |
| **Plantão** | |

**A coluna da direita é a razão de o banco ficar de fora nesta fase.** Backup que nunca
foi restaurado não é backup, e essa é a responsabilidade mais cara de assumir — o próprio
ADR-006 a trata como requisito duro, com drill de restore obrigatório antes do cutover.
Adiá-la é o que torna a Fase A barata.

⚠️ **Servidor único:** o painel que conserta mora na máquina que caiu, e o alerta que
avisaria cai junto. Aceitável porque produção só depende dele **depois** do passo 5.

## Alternativas consideradas

- **Ficar no Render Standard** (recomendação de
  [`../infra-decisao-hospedagem.md`](../infra-decisao-hospedagem.md), 19/08): menor
  esforço, custo previsível, zero migração. Mantém os 180 ms e não ensina ops.
  **Continua sendo o fallback** se o soak do passo 4 não fechar.
- **ADR-006 integral agora:** rejeitado por ora — bundle atômico, com o rework de auth
  segurando o resto, na pior janela para isso.
- **Fly.io `gru`:** mesma topologia desta decisão, sem o painel do Coolify — e portanto
  sem a parte que a dona quer aprender. Volta à mesa se administrar VPS custar mais
  atenção que o previsto. O ADR-006 rejeitou Fly por "custo/OSS/controle" **antes** de a
  região SP entrar na conta.
- **Vercel `gru1`:** rejeitado — serverless mata o cache em processo
  ([ADR-002](./ADR-002-cache-swr.md)) e exigiria o
  [ADR-014](./ADR-014-cache-fora-do-processo-e-ingestao-em-fluxo.md) como pré-requisito,
  além de rework dos syncs longos.

## Consequências

- ➕ Compute e banco na mesma região — remove os 180 ms do caminho frio.
- ➕ Aprendizado real de ops, que é o objetivo declarado.
- ➕ **Rollback é troca de DNS.** Render e Supabase seguem de pé.
- ➕ Destrava o caminho do ADR-006 sem big bang: quando o Better Auth ficar pronto, a
  Fase B acontece numa máquina que já conhecemos.
- ➕ Sem lock-in de compute: Coolify roda em qualquer VPS.
- ➖ **Mantém dependência SaaS**, contra o objetivo declarado do produto — consciente e
  temporário.
- ➖ Ops de aplicação passam a ser nossos, com ponto único de falha.
- ➖ **A economia é pequena** (~R$ 60/mês). Quem justifica esta decisão é latência e
  aprendizado; se alguém a defender por custo, está defendendo pelo motivo errado.
- ➖ **Risco de o intermediário virar permanente por inércia** — daí os gatilhos abaixo.

## Gatilhos que revisam esta decisão

| Gatilho | Ação |
|---|---|
| Soak do passo 4 não fecha | Volta pro Render; este ADR é arquivado |
| Better Auth (ADR-007) pronto | Abre a Fase B (ADR-006) |
| Custo ou limite do Supabase apertando | Antecipa Postgres self-hosted |
| Ops consumindo mais que ~2h/mês fora de incidente | Reavalia contra Render Standard |
| Latência medida no usuário **não** melhorar após o cutover | Metade da justificativa cai; reavaliar |

## O que este ADR NÃO decide

- **Não revoga o ADR-006** — divide a execução dele em fases. O destino segue o mesmo.
- Provedor final da VPS (Hostinger, Vultr ou outro) — o requisito é **região São Paulo**.
- Data da Fase B.
- Se o banco vai para Supabase Pro ou se dá para reduzi-lo abaixo de 500 MB — decisão do
  passo 2, pendente de levantar o tamanho das tabelas.

Relacionado: [ADR-006](./ADR-006-migracao-self-hosted-coolify.md) ·
[ADR-007](./ADR-007-arquitetura-de-auth.md) ·
[ADR-002](./ADR-002-cache-swr.md) ·
[ADR-014](./ADR-014-cache-fora-do-processo-e-ingestao-em-fluxo.md) ·
[`../infra-decisao-hospedagem.md`](../infra-decisao-hospedagem.md)
