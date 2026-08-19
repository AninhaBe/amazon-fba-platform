# Fly.io — o que é, o que custa e o que precisa saber antes de decidir

**Levantado em 19/08/2026** direto da documentação oficial de preços, de sizing de
máquina, de CPU e de volumes. A decisão de usar está no
[ADR-015](./adr/ADR-015-compute-em-sao-paulo-com-banco-gerenciado.md); este doc é a
explicação de apoio.

---

## Em uma frase

Micro-VMs cobradas por segundo, em **São Paulo**, rodando a nossa imagem Docker, por
**~$7/mês**, sem ninguém precisar administrar servidor.

---

## 1. O modelo de cobrança: não existe plano

**É pay-as-you-go puro.** Nas palavras deles: *"Plans get complicated, so we just charge
based on usage."* Você paga por segundo de máquina ligada, GB de disco provisionado e GB
de tráfego de saída.

### O que a nossa configuração custa

| Item | Preço | Nosso caso |
|---|---|---|
| `shared-cpu-1x` com 1 GB | $0,00000228/s (~**$5,92/mês**) | 1 máquina 24/7 |
| Volume | **$0,15/GB/mês** | 1 GB = $0,15 |
| Egress América do Sul | **$0,04/GB** | tráfego de painel, centavos |
| Certificado TLS | primeiros 10 **grátis** | $0 |
| IPv4 dedicado | $2/mês | só se necessário (compartilhado é grátis) |

**Total: ~$6 a $8/mês.**

### Comparando com o que foi avaliado

| Opção | Custo | Gerenciado? | São Paulo? |
|---|---|---|---|
| **Fly.io** | **~$7** | ✅ | ✅ |
| VPS (Hostinger KVM 2) | ~$14 na renovação | ❌ | ✅ |
| Render Standard | $25 | ✅ | ❌ |

O Fly é o mais barato dos três, o único gerenciado **e** o único em São Paulo. Ainda
assim, **preço não é o critério da decisão** — é latência. Se a medição não mostrar ganho,
a escolha cai mesmo custando um terço.

### ⚠️ Consumo não tem teto

Plano fixo protege você de você mesmo; consumo não. Um loop errado, um pico de tráfego ou
um volume grande provisionado por engano vão para a fatura.

**Configurar limite de gasto e alerta antes do primeiro deploy.** É requisito, não
sugestão.

### Outras notas de preço

- **Não existe mais free tier**, só um trial — conferir os detalhes ao criar a conta.
- **Suporte pago começa em $29/mês** (Standard), mais caro que a infraestrutura inteira.
  O suporte da comunidade atende neste porte.

---

## 2. O que ele oferece de máquina

| Tipo | vCPU | RAM possível |
|---|---|---|
| `shared-cpu-1x` a `8x` | 1 a 8 | 256 MB × N até **2 GB × N** |
| `performance-1x` a `8x` | 1 a 8 | 2 GB × N até 8 GB × N |

Nossa configuração é `shared-cpu-1x` com **1 GB**. O teto desse tipo é 2 GB, então há
para onde crescer sem trocar de categoria.

> 512 MB está descartado desde o começo: foi o que matou o container no Render Free
> durante o cron do TikTok, em 15/08.

---

## 3. ⚠️ A pegadinha do "shared": 6,25% de um núcleo

Esta é a parte que ninguém lê e depois estranha.

Shared e performance rodam no **mesmo hardware, com o mesmo clock**. A diferença é quanto
tempo de execução você recebe a cada período de 80 ms:

```
shared       ->   5 ms / 80 ms  =  6,25% de um núcleo (sustentado)
performance  ->  80 ms / 80 ms  =  100%
```

**Mas ele acumula crédito.** O tempo ocioso vira saldo de burst, até **500 segundos** de
CPU cheia guardados. Aplicação que fica quieta e trabalha em rajadas — o perfil exato de
um painel — vive bem assim. Estourou o saldo, a máquina é **estrangulada nos 6,25%** até
recarregar.

Em máquinas maiores as cotas somam: `shared-cpu-2x` recebe 10 ms por período.

### Por que isso importa para o NEXO

Os **syncs** são o que consome. O cron bate a cada 5 minutos, cada sync tem orçamento de
20–60 s e a conciliação de tarifas roda em background dentro do web. Isso queima saldo.

**A referência que tranquiliza:** o Render Free entrega **0,1 CPU sustentado e zero
burst**, e o app sobrevive nele hoje. O Fly dá um pouco menos de base e 500 s de rajada
que o Render nunca deu. Para este perfil, tende a ser melhor.

📌 **Mas é medição, não premissa.** Conferir o saldo de burst depois do deploy antes de
declarar que `shared-cpu-1x` serve. Se estourar com frequência, o caminho é
`performance-1x` — e aí o custo sobe muito e a comparação com o Render Standard volta a
ficar parelha.

---

## 4. ⚠️ A pegadinha do volume: disco local, sem réplica

Documentação do Fly: um volume é *"uma fatia de um NVMe no mesmo servidor físico da
Machine"*. Eles comparam com o disco interno de um notebook.

| | |
|---|---|
| Compartilhar entre máquinas | ❌ um volume, uma máquina |
| Replicação | ❌ **nenhuma** — se o NVMe falhar, a aplicação cai |
| Recomendação deles | **provisionar pelo menos dois volumes por app** |
| Snapshot | diário automático, 5 dias (configurável 1–60) |
| Encolher | ❌ só dá para aumentar |
| Tamanho máximo | 500 GB |

A própria documentação avisa que o snapshot **não deve ser o backup principal**.

Nossa topologia — 1 máquina, 1 volume — é exatamente o arranjo que eles desaconselham.

**Aceito nesta fase**, porque o `DATA_DIR` guarda contas OAuth (reconectáveis por
re-OAuth) e custos. Mas reforça uma conclusão que já estava no ADR-015: **esse dado
deveria morar no Postgres, não em disco local.** Isso vale igualmente no Fly, no Render e
numa VPS — não é defeito do Fly.

---

## 5. O que muda no dia a dia

**Não existe painel para configurar infraestrutura.** É CLI (`fly`) e o arquivo
`fly.toml`, versionado no repo. Para nós é melhor — a configuração fica revisável junto do
código — mas é diferente do Render, onde se clica.

---

## 6. As duas configurações que não podem ser esquecidas

Ambas já estão no `fly.toml` do repo, com comentário explicando.

### `auto_stop_machines = false`

O Fly hiberna máquina ociosa por padrão, e é daí que vem boa parte da economia da
plataforma. **A gente desligou de propósito:** o cache do NEXO vive na memória do processo
([ADR-002](./adr/ADR-002-cache-swr.md)) e a conciliação de tarifas roda em background.
Máquina que hiberna perde o cache e mata trabalho em andamento — seria reintroduzir, por
configuração, o mesmo problema que fez a Vercel ser rejeitada.

Consequência assumida: **pagamos o mês cheio.** Os ~$6 já refletem isso.

### `[mounts]` com `DATA_DIR`

O app grava custos e contas OAuth em disco. Sem volume montado, **cada deploy apaga esses
dados**.

---

## 7. Como subir

Detalhes de build e das pegadinhas do Docker em [`docker.md`](./docker.md).

```bash
# 1. instalar o CLI e autenticar
curl -L https://fly.io/install.sh | sh
fly auth login

# 2. criar o volume ANTES do primeiro deploy
fly volumes create nexo_data --region gru --size 1

# 3. deploy
wsl bash scripts/fly-deploy.sh

# 4. segredos de runtime (lista completa em render.yaml)
fly secrets set DATABASE_URL=... LWA_CLIENT_SECRET=...
```

⚠️ **Nunca rodar `fly deploy` cru.** Ele não passa os `--build-arg`, e a imagem sobe com
as credenciais do Supabase vazias — o app funciona, o health check passa, e só a tela de
login denuncia. O script existe para isso.

---

## 8. Checklist antes de decidir

- [ ] Configurar **limite de gasto e alerta** (modelo sem teto)
- [ ] Conferir **capacidade na região `gru`** — regiões brasileiras costumam operar cheias
- [ ] Conferir o que o **trial** inclui e quando a cobrança começa
- [ ] Registrar **domínio próprio** e cadastrar nas allowlists de Shopee e TikTok — sem
      isso o OAuth dos dois canais quebra na troca de host, em qualquer cenário

E depois de subir, duas medições que decidem se a escolha se sustenta:

- [ ] **Latência contra o Render.** É a justificativa inteira da mudança. Se não melhorar,
      a decisão cai.
- [ ] **Saldo de burst de CPU.** Se os syncs estourarem com frequência,
      `shared-cpu-1x` não serve.

---

Relacionado: [ADR-015](./adr/ADR-015-compute-em-sao-paulo-com-banco-gerenciado.md) ·
[`docker.md`](./docker.md) ·
[`infra-decisao-hospedagem.md`](./infra-decisao-hospedagem.md)
