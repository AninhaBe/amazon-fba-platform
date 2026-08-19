# Infraestrutura do NEXO — o que temos, as opções e a recomendação

**Levantado em 19/08/2026** a partir do repo (ADR-006, `vercel-deploy.md`, ADR-013/014),
dos consoles e de verificação externa (regiões Render/Fly). Este doc existe para a
pergunta "onde hospedar o NEXO para vários usuários?" ser decidida com base, não com
marca.

---

## 1. O que temos hoje

| Componente | Onde | Plano | Limite | Estado |
|---|---|---|---|---|
| App (Next.js 16) | **Render**, Oregon | Free | 512 MB / 0,1 CPU | ⚠️ container já caiu por RAM (cron TikTok, 15/08) |
| Banco + Auth | **Supabase**, São Paulo | Free | 500 MB | 🔴 **526 MB — estourado** |
| Cron (sync 5 min) | **GitHub Actions** | Free | — | ✅ estável (ADR-003) |
| DNS | `sellercore.onrender.com` | — | — | 🔴 **preso ao host**: é Redirect URI nas allowlists de Shopee e TikTok |
| Backups do banco | — | — | — | ❌ só o que o Supabase Free retém |

**Custo mensal hoje: R$ 0.** A infra inteira é gratuita — e as três rachaduras já
apareceram: banco estourado, container que caiu, e latência app↔banco de ~180ms
(Oregon ↔ São Paulo).

### O que a arquitetura assume (e restringe a escolha)

- **Processo persistente.** O cache SWR (ADR-002) vive na memória do processo; a
  conciliação de tarifas roda em background dentro do web; os syncs têm orçamento de
  20–60s. Serverless quebra as três coisas — exigiria o ADR-014 (cache externo) **antes**
  de qualquer benefício.
- **O cron independe do host** (GitHub Actions chama URLs). Migrar host não mexe nele.
- **Banco é Postgres puro** (`pg` + `DATABASE_URL`); Auth é a única amarra real com o
  Supabase, centralizada em ~6 arquivos (levantamento do ADR-006).
- **A latência até o banco é absorvida por design**: leitura vem do cache, sync é
  background. O usuário quase não vê os 180ms; quem vê é o cold path.

---

## 2. As opções

### A. Ficar no Render, subir para Standard — **recomendada agora**

**O quê:** manter tudo como está; quando os usuários chegarem, Free → Standard
(2 GB / 1 CPU, ~US$ 25/mês).

| A favor | Contra |
|---|---|
| Zero migração, zero risco | Sem região no Brasil (5 regiões; SP não existe e serviço não muda de região) |
| Arquitetura foi desenhada para isso (processo persistente) | 180ms app↔banco continuam |
| Background Worker nativo = ADR-013 encaixa | Free hiberna e é apertado |
| Preço fixo, previsível | |

### B. Vercel Pro (região `gru1`, São Paulo)

**O quê:** deploy já configurado no repo (`vercel.json` + `docs/vercel-deploy.md`).
~US$ 20/assento/mês + uso.

| A favor | Contra |
|---|---|
| **São Paulo** — mata os 180ms | **Serverless**: cache em processo morre → ADR-014 vira pré-requisito |
| Next.js nativo, previews por PR | Syncs longos e conciliação em background precisam de rework |
| Doc de migração pronto | Custo por uso pode surpreender; sem worker persistente |

### C. Coolify numa VPS — **o plano de longo prazo já escrito (ADR-006)**

**O quê:** VPS com Coolify; app, Postgres e auth self-hosted. ~US$ 5–15/mês.
Status: **Proposto**, escrito em julho sob a premissa "ainda não há usuários reais".

| A favor | Contra |
|---|---|
| Custo mínimo, sem lock-in, tudo open source (objetivo declarado do produto) | **Single-server: site, banco e painel caem juntos** |
| Processo persistente — arquitetura atual funciona inalterada | Operação vira nossa: TLS, backup, monitoramento, segurança |
| VPS em SP existe (Vultr, Hostinger etc.) → resolve latência também | A premissa de julho envelheceu: a operação agora tem vendas e Ads rodando ao vivo — janela de downtime barato está fechando |

### D. Fly.io (região `gru`)

Servidor persistente em São Paulo, ~US$ 5–15/mês. Meio-termo entre Render e VPS.
**Contra:** operação manual sem o painel do Coolify; a região GRU vive lotada
([docs de regiões](https://fly.io/docs/reference/regions/)); ninguém do time conhece a
ferramenta. Não há doc nem plano no repo. **Só entra se A e C caírem.**

---

## 3. Recomendação

### Agora (independe de qualquer migração)

1. **Domínio próprio** (~R$ 40/ano) cadastrado nas allowlists de Shopee e TikTok **ao
   lado** da URL atual. É o que desacopla o OAuth do host para sempre — sem isso,
   qualquer migração quebra as integrações. De quebra, resolve metade da renomeação
   NEXO.
2. **Supabase Pro (~US$ 25/mês).** O banco já passou do limite; isso trava antes de
   qualquer outra coisa.
3. **Ficar no Render.** Subir para Standard só quando houver usuários de fora — leva
   minutos e não exige mudança de código.

**Custo da fase: ~US$ 25–50/mês.**

### Depois (com usuários e métrica)

Implementar o **ADR-014** (cache externo — necessário para escalar em qualquer host) e
**medir**. Aí a decisão final se resolve com dois gatilhos:

| Se doer... | Vai para |
|---|---|
| **Latência** medida no usuário | Compute em SP: **Coolify/VPS em São Paulo** (mantém a arquitetura) ou Vercel `gru1` (se aceitarmos o rework serverless) |
| **Custo** | **Coolify/VPS** (ADR-006) |

Com o domínio próprio feito, essa migração futura é troca de DNS — não de OAuth.

### Por que A e não as outras, em uma frase cada

- **Não Vercel agora:** pagaríamos o ADR-014 adiantado + rework dos syncs para ganhar
  latência que o cache já esconde.
- **Não Coolify agora:** a janela de "sem usuários, downtime grátis" está fechando com
  vendas ao vivo; assumir operação de servidor no meio da lua de mel da Amazon é tirar
  foco do que dá dinheiro.
- **Não Fly:** é o C sem o painel e sem o plano escrito.
- **Render Standard:** é a única opção com custo de migração **zero** — e o recurso
  mais escasso do time hoje não é dinheiro nem RAM, é atenção.

---

## 4. O que este doc NÃO decide

- A data da migração de longo prazo (Coolify vs Vercel) — depende dos gatilhos medidos.
- O plano exato do Supabase — conferir preço no painel na hora de assinar.
- ⚠️ O ADR-006 segue **Proposto**. Se a direção self-hosted for confirmada, atualizar
  o status lá; se a Vercel vencer no futuro, escrever ADR novo revogando o 006.
