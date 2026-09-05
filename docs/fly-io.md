# Fly.io — o que é, o que custa e o que precisa saber antes de decidir

**Levantado em 19/08/2026** direto da documentação oficial de preços, sizing, CPU, volumes
e gestão de custo. A decisão está no
[ADR-015](./adr/ADR-015-compute-em-sao-paulo-com-banco-gerenciado.md); este doc é a
explicação de apoio.

> 🔁 **Revisado em 19/08 após parecer externo (GPT).** A primeira versão continha um erro
> grave — afirmava que dava para configurar limite de gasto e alerta, o que **não existe
> no Fly** — e usava preço da região errada. Sete correções aplicadas; as principais estão
> marcadas com ✅ **Corrigido** ao longo do texto.

---

## Em uma frase

Micro-VMs cobradas por segundo, em **São Paulo**, rodando a nossa imagem Docker, por
**~$7,50/mês**, sem precisar cuidar de máquina Linux.

✅ **Corrigido:** a primeira versão dizia *"sem ninguém precisar administrar servidor"*, o
que vende demais. O que sai da nossa conta é o **servidor** — SO, patches, firewall,
Coolify. **Continuam nossos:** deploy, configuração da Machine, volume, segredos,
métricas e resposta a incidente. É bem menos trabalho que uma VPS, não é zero.

---

## 1. O modelo de cobrança: não existe plano

**É pay-as-you-go puro.** Nas palavras deles: *"Plans get complicated, so we just charge
based on usage."* Paga-se por segundo de máquina ligada, GB de disco provisionado e GB de
tráfego de saída.

### O que a nossa configuração custa — preço de `gru`

✅ **Corrigido:** a versão anterior usava o preço da região base. **Machine tem preço por
região**, e São Paulo é mais cara.

| Item | Preço em `gru` | Nosso caso |
|---|---|---|
| `shared-cpu-1x` com 1 GB | **$0,00000279/s** (~**$7,23/mês**) | 1 máquina 24/7 |
| Volume | $0,15/GB/mês | 1 GB = $0,15 |
| Egress América do Sul | $0,04/GB | tráfego de painel, centavos |
| Certificado TLS | primeiros 10 grátis | $0 |
| IPv4 dedicado | $2/mês | só se necessário |

**Total: ~$7,50/mês.**

O quanto São Paulo custa a mais, para referência:

| `shared-cpu-1x` | IAD (mais barata) | **GRU** | Diferença |
|---|---|---|---|
| 512 MB | $0,00000123/s | $0,00000156/s | +27% |
| **1 GB** | $0,00000220/s | **$0,00000279/s** | **+27%** |
| 2 GB | $0,00000413/s | $0,00000524/s | +27%

Ou seja: **a latência de São Paulo custa ~27% a mais de compute.** Em dinheiro, ~$1,50/mês.

### Comparando com o que foi avaliado

| Opção | Custo | Gerenciado? | São Paulo? |
|---|---|---|---|
| **Fly.io** | ~$7,50 | ✅ | ✅ |
| VPS (Hostinger KVM 2) | ~$14 na renovação | ❌ | ✅ |
| Render Standard | $25 | ✅ | ❌ |

✅ **Corrigido:** a frase anterior dizia que o Fly era *"o único gerenciado e o único em
São Paulo"*. Errado — **o Render também é gerenciado**, só não tem região no Brasil. O
correto é: **o Fly é o único que combina ambiente gerenciado com São Paulo.**

Ainda assim, **preço não é o critério** — é latência. Se a medição não mostrar ganho, a
escolha cai mesmo custando um terço.

### 🔴 Consumo não tem teto — e o Fly NÃO oferece proteção

✅ **Corrigido — este era o erro mais grave da versão anterior.** Ela mandava "configurar
limite de gasto e alerta". **Isso não existe no Fly.** A documentação oficial de gestão de
custo diz, textualmente:

> *"We don't support billing alerts (yet), so budget accordingly."*

E sobre as franquias gratuitas:

> *"Free allowances don't cap your bill... If you go over, we'll bill you."*

Não há teto rígido, não há alerta, não há corte automático. O que dá para fazer é o que
eles próprios recomendam:

1. **Conferir a fatura parcial no painel** ("current month to date bill") com regularidade
   — é retrospectivo, não preventivo
2. **Orçar pelo pior caso**, ou seja, pelo custo de tudo ligado 24/7 — não contar com
   economia de hibernação (que a gente desligou de propósito, ver seção 6)
3. **Manter uma única Machine e não ligar autoscaling** — o controle real é rodar menos
   máquinas, ou menores
4. `billing@fly.io` em caso de cobrança inesperada

**Isso é uma diferença concreta em relação a plano fixo**, e precisa entrar na decisão com
o nome certo: no Render você não pode gastar mais que o plano; no Fly, pode.

### Outras notas de preço

- **Não existe mais free tier**, só um trial — conferir os detalhes ao criar a conta.
- **Suporte pago começa em $29/mês**, mais caro que a infraestrutura inteira. O suporte da
  comunidade atende neste porte.

---

## 2. O que ele oferece de máquina

| Tipo | vCPU | RAM possível |
|---|---|---|
| `shared-cpu-1x` a `8x` | 1 a 8 | 256 MB × N até **2 GB × N** |
| `performance-1x` a `8x` | 1 a 8 | 2 GB × N até 8 GB × N |

Nossa configuração é `shared-cpu-1x` com **1 GB**. O teto desse tipo é 2 GB, então há para
onde crescer sem trocar de categoria.

> 512 MB está descartado desde o começo: foi o que matou o container no Render Free
> durante o cron do TikTok, em 15/08.

---

## 3. ⚠️ A pegadinha do "shared": 6,25% de um núcleo

Shared e performance rodam no **mesmo hardware, com o mesmo clock**. A diferença é quanto
tempo de execução se recebe a cada período de 80 ms:

```
shared       ->   5 ms / 80 ms  =  6,25% de um núcleo (sustentado)
performance  ->  80 ms / 80 ms  =  100%
```

**Mas ele acumula crédito.** O tempo ocioso vira saldo de burst, até **500 segundos** de
CPU cheia guardados. Estourou o saldo, a máquina é **estrangulada nos 6,25%** até
recarregar. Em máquinas maiores as cotas somam: `shared-cpu-2x` recebe 10 ms por período.

### Por que isso importa para o NEXO

✅ **Corrigido — erro de análise da versão anterior.** Ela dizia que os syncs "queimam
saldo" porque duram 20–60 s. **Duração não é consumo de CPU.** Os nossos syncs passam a
maior parte do tempo *esperando* resposta da Amazon, do Mercado Livre, do TikTok e do
Supabase — isso é espera de rede, que praticamente não gasta processador.

O que realmente consome CPU é o **parsing e a materialização** dos dados recebidos, que é
uma fração pequena desse tempo. Ou seja: o cenário é bem mais favorável ao
`shared-cpu-1x` do que a versão anterior deste doc sugeria.

**A referência que tranquiliza:** o Render Free entrega **0,1 CPU sustentado e zero
burst**, e o app sobrevive nele hoje. O Fly dá um pouco menos de base e 500 s de rajada
que o Render nunca deu.

📌 **Mas segue sendo medição, não premissa.** Só o painel de throttling responde. Se o
saldo acabar com frequência, o caminho é `performance-1x` — e aí o custo sobe muito, a
vantagem de preço evapora e **a VPS volta a fazer sentido**.

---

## 4. ⚠️ A pegadinha do volume: disco local, sem réplica

Documentação do Fly: um volume é *"uma fatia de um NVMe no mesmo servidor físico da
Machine"*. Eles comparam com o disco interno de um notebook.

| | |
|---|---|
| Compartilhar entre máquinas | ❌ um volume, uma máquina |
| Replicação | ❌ **nenhuma** — se o NVMe falhar, a aplicação cai |
| Snapshot | diário automático, 5 dias (configurável 1–60) |
| Encolher | ❌ só dá para aumentar |
| Tamanho máximo | 500 GB |

A própria documentação avisa que o snapshot **não deve ser o backup principal**.

✅ **Corrigido:** a versão anterior citava a recomendação deles de *"provisionar pelo menos
dois volumes"* como se fosse a solução. **Não é** — volumes **não se replicam entre si**.
Dois volumes só ajudam se houver **duas Machines** e **alguma estratégia de replicação de
dados** (LiteFS, ou o dado morar num Postgres gerenciado). Provisionar um segundo volume
sozinho não compra disponibilidade nenhuma.

### O ponto fraco de verdade

**`DATA_DIR` guardando contas OAuth e custos em disco local é a maior fragilidade desta
fase** — mais séria que CPU ou preço.

Para um piloto é aceitável, **com backup**. Mas **esses dados precisam migrar para o
Postgres antes de o NEXO depender definitivamente do Fly.** Isso vale igualmente no
Render e em VPS — não é defeito do Fly, é dívida nossa que o Fly torna mais visível.

---

## 5. O que muda no dia a dia

**Não existe painel para configurar infraestrutura.** É CLI (`fly`) e o arquivo
`fly.toml`, versionado no repo. Para nós é melhor — configuração revisável junto do
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

Consequência assumida: **pagamos o mês cheio.** Os ~$7,50 já refletem isso — e é também o
que os próprios docs mandam fazer ao orçar (pelo custo "always-on").

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

⚠️ **Nunca rodar `fly deploy` cru.** Ele não passa os `--build-arg`, e a imagem sobe com as
credenciais do Supabase vazias — o app funciona, o health check passa, e só a tela de login
denuncia. O script existe para isso.

### ⚠️ "Release criado" NÃO é "release no ar" (incidente de 28/08/2026)

**O que aconteceu.** Um deploy foi disparado, o comando saiu sem erro visível, e a entrega
foi reportada como estando em produção. Não estava: o release **v145** ficou 26 minutos em
`running`, **nunca aplicou**, e ainda segurou o **lease** da máquina — o que fez o deploy
seguinte falhar com `lease currently held by ... expires at ...`. Enquanto isso, a máquina
seguia rodando a versão **anterior (144)**, e uma correção de produção passou uma hora
sendo dada como resolvida sem estar. O sintoma que denunciou foi indireto: um segundo
deploy falhando por lease preso.

**Como o Fly deixa isso invisível:** `fly releases` mostra o release com status `running`,
que parece "em andamento" e não "travado"; e o comando de deploy pode retornar antes de a
máquina assumir. **A fonte de verdade é a máquina, não o release** — `fly status` mostra a
versão que ela realmente roda (campo `fly_release_version` no `--json`).

**A defesa, que agora está no script.** `scripts/fly-deploy.sh` lê a versão ANTES do
deploy e, depois dele, fica até 5 minutos conferindo se a máquina assumiu uma versão
**maior**. Se não assumir, o script **falha com código diferente de zero** e diz, com todas
as letras, para não reportar a entrega como no ar. Também trata o caso do lease preso, com
a instrução de esperar o horário de expiração informado pelo próprio Fly e repetir.

**Comandos de conferência manual**, quando for preciso investigar:

```bash
fly status -a nexo            # a VERSÃO QUE A MÁQUINA RODA (é o que vale)
fly releases -a nexo          # histórico; 'running' por muito tempo = preso
fly machine list -a nexo      # estado das máquinas
```

📌 **A regra que fica:** afirmar "está no ar" exige ter visto a versão nova na máquina.
Release criado, build concluído e health 200 **não provam** que o código novo está
rodando — o health passa igual na versão antiga.

### ⚠️ As três mordidas de 28/08/2026, e a lição comum

Em um único dia o caminho de deploy falhou três vezes, por causas diferentes.
Ficam juntas aqui de propósito: separadas, cada uma parece azar; juntas, mostram
o padrão.

| # | O que aconteceu | Causa |
|---|---|---|
| 1 | Reportei "no ar" o que **não estava**: a `v145` ficou presa em `running`, a máquina seguiu na anterior, e o lease preso fez o deploy seguinte falhar | Confiei no release criado, não na versão da máquina |
| 2 | A defesa criada para o item 1 **quebrou o próprio deploy**, duas vezes: `set -o pipefail` + SIGPIPE do `head` matou o script antes do `fly deploy`; depois `"${APP_ARGS[@]:-}"` com array vazio passou string vazia ao `fly status`, que respondeu texto de uso em vez de JSON | A defesa não foi exercitada nos dois caminhos (com e sem argumentos) |
| 3 | A árvore estava **limpa quando o deploy foi disparado e suja quando o Docker leu**: outro agente salvou no meio, e 92 linhas não commitadas dele foram publicadas sem autorização | Conferência feita minutos antes do uso |

**A lição comum: _estado conferido não é estado no momento do uso._**

É a irmã de *"release criado não é release no ar"*. Nos dois casos alguém olha
um estado, tira uma conclusão, e o mundo muda entre o olhar e o uso. A defesa é
sempre a mesma forma: **mover a conferência para colada no uso**, não deixá-la
na cabeça de quem chamou.

- Item 1 → o script lê a versão **na máquina**, antes e depois, e falha alto.
- Item 3 → o script confere `git status --porcelain` **imediatamente antes** do
  `fly deploy`, e aborta dizendo o que fazer:

  ```
  ABORTADO: a arvore nao esta limpa, e o 'fly deploy' publica a ARVORE, nao o commit.
    - arquivo seu:             commite ou 'git stash push -- <arquivo>' antes de subir
    - arquivo de outro agente: PEÇA para ele commitar ou dar stash.
  ```

  A mensagem diz **o que fazer** porque quem vai lê-la é um agente no meio de uma
  tarefa, não alguém sentado lendo documentação.

📌 O item 2 tem uma lição própria, que vale para qualquer trava: **defesa também
é código, e código não exercitado quebra o que deveria proteger.** Uma trava que
só roda no caminho feliz é um passivo com cara de proteção.

### A quarta forma: ação larga demais (29/08/2026)

Ainda no mesmo dia, um `git add -A` rodado às pressas para destravar uma
migration varreu dois arquivos **untracked de outro agente** para dentro de um
commit alheio. Nada quebrou — o código estava correto e testado —, mas o
histórico passou a dizer que um helper de backend nasceu num commit de front.

Somando o dia inteiro, é **a mesma doença em quatro roupas**:

| Onde | A ação larga demais |
|---|---|
| `fly deploy` | publica a **árvore inteira**, não o commit |
| `useEffect` | dependência ampla demais refaz o que não precisava |
| `invalidateByKeyPart` / reiniciar a máquina | limpa mais cache do que o alvo |
| `git add -A` | commita o que estava em voo de outra pessoa |

**A defesa é sempre a mesma forma: nomear o alvo em vez de pegar tudo.** Deploy
confere a árvore colado no uso; efeito depende do que realmente usa; a
invalidação entra pela chave (versão do prompt); e o commit vai por **caminho
explícito** (`git add <arquivos>`) em vez de `-A`.

📌 E uma decisão tomada junto: **não reescrever histórico para consertar
autoria.** Reescrever commit por estética é pior que o problema — quem procurar o
helper daqui a um mês encontra a origem no ADR-029 e no teste.

---

## 7.1 ⚠️ "Salvei o segredo" NÃO é "o processo tem o segredo"

**Medido em 04/09/2026, e custou uma hora.** A dona do produto criou três
segredos no painel do Fly e clicou em *Deploy Secrets*. O `fly secrets list`
passou a mostrar os três como **`Deployed`**. E o processo **não os tinha**.

O painel conhece um fato só: o segredo está no cofre. Se ele chegou ao
ambiente do processo é outro fato, e ninguém mede por você.

### O que NÃO bastou, medido um a um

| tentativa | resultado |
|---|---|
| `fly secrets deploy -a nexo` (rolling update, 1/1 healthy) | **não injetou** |
| um deploy novo por cima | **não injetou** |
| `fly machine restart <id>` | **não injetou** |
| `fly secrets set OUTRA_COISA=1` | **injetou — e as três atrasadas vieram junto** |

📌 A leitura: `secrets deploy` e `restart` reaproveitam a configuração de
máquina existente; foi o `secrets set` que a **regenerou**. Se você caiu neste
estado, o conserto é um `fly secrets set` de qualquer variável — inclusive uma
descartável.

### 🔬 O MÉTODO DA SONDA — separe "quebrado para tudo" de "quebrado para estes"

Antes de pedir à dona do produto que recolasse a credencial (o palpite óbvio,
e errado), subi uma variável **sem segredo nenhum**:

```bash
fly secrets set NEXO_SONDA_SECRETS=1 -a nexo   # nenhum valor sensível
# ... medir ...
fly secrets unset NEXO_SONDA_SECRETS -a nexo   # e some depois
```

Ela chegou ao processo **e arrastou as três que faltavam**. Isso respondeu de
uma vez: a injeção do app não estava quebrada, e a credencial dela nunca esteve
errada — faltava um `set` que regenerasse a config.

⚠️ **Use a sonda sempre que a hipótese for "a credencial está errada".** Uma
variável descartável testa o CAMINHO sem tocar no segredo, e evita pedir à
pessoa que recole uma chave que já estava certa — o que teria "consertado" por
acidente e ensinado a lição errada.

### Como medir presença sem NUNCA imprimir valor

```bash
fly ssh console -a nexo -C '/bin/sh -c "
for v in MINHA_VAR OUTRA_VAR; do
  eval val=\$$v
  if [ -z "$val" ]; then echo "$v: AUSENTE/VAZIA"; else echo "$v: ${#val} caracteres"; fi
done"'
```

O tamanho já distingue os casos que importam: ausente, vazia, ou presente com
comprimento plausível (uma app key de 13 caracteres, um service id de 19).

⚠️ **E leve um CONTROLE junto.** Ao medir `TIKTOK_PUBLIC` e receber zero, a
primeira pergunta é se a sonda funciona: contar `SHOPEE_` (deu 4) e o
`TIKTOK_` antigo (deu 3) provou que o ambiente respondia e que a ausência era
real. Sem controle, "não achei" e "não sei procurar" são a mesma saída.

📌 Vale procurar o nome em **qualquer posição da linha**, com `cat -A`: nome
com espaço à esquerda ou caractere invisível — coisa que colar no painel
produz — não casa com `grep "^MINHA_VAR"` e passaria por ausente.

📌 Esta é a mesma família de **"release criado não é release no ar"** e de
**"migration aplicada não é leitor com a coluna"**: em todas, o painel conhece
um passo e o mundo depende do seguinte.

## 8. O piloto — e o que ele precisa provar

**A decisão aprovada é testar, não migrar.** O cutover só acontece depois que a medição
sustentar a escolha.

### Antes de subir

- [ ] **Destravar o limite do Supabase** (559 MB de 500 MB, subindo ~7 MB/dia)
- [ ] Registrar **domínio próprio** e cadastrar nas allowlists de Shopee e TikTok — sem
      isso o OAuth dos dois canais quebra na troca de host, **em qualquer cenário**
- [ ] Conferir **capacidade em `gru`** e o que o trial inclui
- [ ] Aceitar conscientemente que **não há teto de gasto**, e definir uma rotina de
      conferir a fatura parcial no painel

### O piloto

Uma máquina `shared-cpu-1x` de 1 GB, **autostop desligado, sem autoscaling**, com o
**Render servindo produção o tempo todo**, rodando **todos os syncs por pelo menos uma
semana**.

### O que medir antes de trocar o DNS

| Medida | Por que decide |
|---|---|
| **Latência contra o Render** | É a justificativa inteira. Não melhorou, decisão cai |
| **Saldo de burst e throttling** | Se acabar sempre, `shared-cpu-1x` não serve |
| **Memória** | 512 MB já matou o app uma vez |
| **Persistência do volume** entre deploys | `DATA_DIR` não pode sumir |
| **Custo parcial no painel** | Única proteção que existe |

**Se a máquina compartilhada aguentar, o Fly resolve por ~$7,50.** Se o burst acabar
sempre e for preciso `performance-1x`, a vantagem de preço encolhe muito e **a VPS volta a
fazer mais sentido** — por isso a decisão de cutover fica para depois da medição, não
agora.

---

## 8.5. Como desenvolver sem rodar nada local

Contexto: a máquina de desenvolvimento aqui tem `C:` cheio e RAM apertada. Três medidas
tiram o trabalho pesado dela.

### 1. Build nos servidores do Fly (padrão)

`fly deploy` usa o Docker **local** se encontrar um. No primeiro deploy foi o que
aconteceu — o build rodou nesta máquina. Para não acontecer:

```powershell
powershell -File scripts/fly-deploy.ps1   # Windows, sem WSL — recomendado
```
```bash
wsl bash scripts/fly-deploy.sh            # via WSL (--remote-only por padrão)
wsl bash scripts/fly-deploy.sh --local    # força build local, se quiser
```

📌 **Prefira a versão PowerShell.** O `flyctl` vivia só dentro do WSL, e ligar a VM do
WSL exige ~1 GB de RAM livre. Em 19/08/2026 a máquina de desenvolvimento ficou com
**0,9 GB livres** (Chrome com 67 processos ocupando 5,7 GB) e o WSL parou de subir —
bloqueando o deploy, que **não precisa de recurso local nenhum**: o build roda nos
servidores do Fly.

Instalar no Windows: `iwr https://fly.io/install.ps1 -useb | iex`. A autenticação pode
ser reaproveitada copiando o `config.yml` de dentro do WSL (acessível pelo Explorer em
`wsl.localhost`) para `%USERPROFILE%/.fly/` — não precisa logar de novo.

Com build remoto, o Fly compila nos servidores dele e a máquina local só envia os
arquivos. **Zero RAM e zero disco seus.**

### 2. Um app de staging que dorme

Um segundo app (`nexo-staging`) com **`auto_stop_machines = true`** — ligado, ao contrário
da produção.

📌 **Aqui a hibernação é desejável.** O motivo de desligá-la em produção é o cache em
memória ([ADR-002](./adr/ADR-002-cache-swr.md)); staging não precisa de cache quente. A
máquina dorme quando ninguém usa e acorda no primeiro acesso.

Custo: usando ~2h por dia, fica em torno de **$0,60/mês** em vez de $7.

Fluxo que isso destrava:

```
edita o código  →  deploy no staging  →  testa no navegador  →  aprova  →  deploy em nexo
```

Nada roda na máquina local.

⚠️ **Staging não deve apontar para o banco de produção.** Enquanto não houver um banco
separado, tratar o staging como somente-leitura e nunca disparar sync manual por ele.

### 3. Testes automatizados no GitHub Actions

`npm test` roda na nuvem a cada push, de graça — a conta já usa Actions para o cron
([ADR-003](./adr/ADR-003-cron-github-actions.md)).

### Deploy: Fly é manual, Render é automático

| | Render | Fly |
|---|---|---|
| Gatilho | `git push` na main (`autoDeploy: true`) | comando, quando você quiser |
| Controle | nenhum — push errado vai ao ar | você escolhe a hora |
| Estratégia | — | *rolling*: a máquina nova só entra depois de passar no health check |

Dá para automatizar com GitHub Actions depois. **Não foi feito agora de propósito:** com o
Render ainda em produção, dois hosts subindo sozinhos sobre o mesmo banco é confusão.

---

## 8.6. ⚠️ O WSL como pedágio — e por que ele saiu do caminho (19/08/2026)

O `flyctl` foi instalado primeiro **dentro do WSL**, porque era onde o Docker estava. Isso
criou uma dependência que não devia existir: **para fazer deploy, o Windows precisava
ligar a VM do WSL** — e ligar essa VM exige ~1 GB de RAM livre.

Na noite de 19/08 o deploy passou a falhar com:

```
Não existem recursos de sistema suficientes para concluir o serviço solicitado.
Wsl/Service/CreateInstance/CreateVm/HCS/0x800705aa
```

Medição da máquina naquele momento:

| | |
|---|---|
| RAM total | 15,9 GB |
| **RAM livre** | **0,9 GB** |
| `chrome` | **5.762 MB em 67 processos** |
| `claude` | 1.692 MB |
| `msedgewebview2` | 1.307 MB |
| `vmmem` (o próprio WSL) | 1.002 MB |
| `node` | 959 MB em 13 processos |

Não foi um evento único: foi **acúmulo de um dia longo de trabalho** — dezenas de abas
abertas para operar Fly, Registro.br, Amazon Ads, Solution Provider e Seller Central, mais
os processos de script.

### O absurdo que isso revelou

**O deploy não usa recurso local nenhum.** O build roda nos servidores do Fly
(`--remote-only`); o `flyctl` só envia arquivos e conversa com a API. Ou seja: a máquina
não conseguia iniciar uma VM de 1 GB para executar um comando que existe justamente para
que ela **não** faça trabalho pesado.

### A correção

`flyctl` instalado **nativamente no Windows** e `scripts/fly-deploy.ps1` criado. O WSL
continua útil para o Docker local, mas **saiu do caminho crítico do deploy**.

A autenticação **não precisou ser refeita**: o `config.yml` do flyctl dentro do WSL é
acessível pelo sistema de arquivos do Windows (via `wsl.localhost`), e foi copiado para
`%USERPROFILE%/.fly/`.

📌 **Lição:** ferramenta de deploy não deve morar atrás de um runtime que pode não subir.
Se o comando falha por falta de recurso numa máquina que só faz uma chamada de rede, a
dependência está no lugar errado — não o recurso.

---

## 9. Resultado do primeiro deploy (19/08/2026, ~18h30)

App **`nexo`** no ar em `gru`: **https://nexo.fly.dev** · imagem de 62 MB · volume de 1 GB
criptografado com snapshot diário · health check `1 total, 1 passing`.

### Latência medida — a justificativa do ADR-015, confirmada

| Rota | Fly (`gru`) | Render (Oregon) |
|---|---|---|
| `/api/health` (sem banco) | **0,074 – 0,080 s** | 0,210 – 0,525 s |
| `/login` (toca o Supabase) | **0,094 – 0,147 s** | 0,208 – 0,514 s |

**2 a 5× mais rápido — e muito mais estável.** O Fly variou ~6 ms entre rodadas; o Render
variou de 210 a 525 ms. A instabilidade do Render é provavelmente o que faz o painel
parecer travado de vez em quando.

### ✅ Validado de ponta a ponta (19/08, ~20h)

A vendedora fez login em `nexo.fly.dev` e **o dashboard carregou com os dados reais**.
Isso fecha a cadeia inteira: imagem Docker → máquina em `gru` → Supabase Auth → Postgres →
renderização.

Antes disso, o que dava para provar de fora era parcial e vale registrar por quê:

- `/api/health` **não toca o banco** — só devolve `{ok:true}`. Health check passando não
  prova conectividade com Postgres.
- Todas as rotas de dados (`/api/orders`, `/api/sales`, `/api/products`) respondem **401
  antes** de consultar o banco.

📌 **Lição:** um health check que não toca a dependência crítica dá falsa segurança. Vale
considerar um `/api/health?deep=1` que faça um `SELECT 1` — hoje o app responde "saudável"
mesmo se o banco estiver inacessível.

Também confirmado nos logs: **o volume montou correto** em `/data` (1 GB, uid 100/gid 101),
que era um dos riscos listados.

### 🌐 Domínio próprio no ar (19/08, ~20h15)

**`https://nexoaihub.com.br` e `https://www.nexoaihub.com.br`** servindo o NEXO, HTTPS
válido nos dois (~0,17s). O Fly emitiu o certificado sozinho assim que a zona publicou.

Sequência que funcionou, para repetir:

1. Registrar no **Registro.br** (~R$ 40/ano), deixando o campo de servidores DNS **vazio**
   na compra — assim usa o DNS gratuito deles.
2. `fly certs add <domínio>` **antes** do DNS — o Fly já entrega os valores a cadastrar.
3. Painel → DNS → **Configurar zona DNS** (exige *Modo avançado*), quatro registros:
   A e AAAA na raiz (campo Nome **vazio**) e A e AAAA no `www`.
4. Salvar e esperar a **transição** terminar.

⚠️ **A pegadinha que me custou duas horas:** ao entrar no Modo avançado, o painel mostra
*"os servidores DNS do domínio se encontram em transição — aproximadamente 2h"*. **Isso
NÃO bloqueia a edição da zona** — bloqueia apenas voltar ao Modo básico. Eu li como
bloqueio e parei; ela abriu e cadastrou normalmente. Durante a transição os registros
ficam salvos mas não são servidos, então `nslookup` responde "não existe" — o que parece
erro e não é.

**Isso destrava o pré-requisito duro do ADR-015:** agora dá para cadastrar o domínio nas
allowlists de Shopee e TikTok **ao lado** de `sellercore.onrender.com`, sem quebrar o OAuth.

### O que ficou provado e o que não

✅ Capacidade em `gru` existe (era dúvida do checklist) · ✅ o `Dockerfile` do repo sobe no
Fly sem ajuste · ✅ 29 segredos aplicados por `fly secrets set` · ✅ o gate de "verificação
de conta" **não bloqueia** o deploy depois do cartão cadastrado.

❌ **Ainda não medido:** saldo de burst e throttling sob carga de sync, memória sob carga,
persistência do volume entre deploys, custo real acumulado. São os itens que exigem a
semana de piloto.

⚠️ **`nexo.fly.dev` aponta para o banco de produção.** Render e Fly estão vivos ao mesmo
tempo, sobre os mesmos dados. Não é problema — o Render segue sendo produção — mas evita
disparar sync manual pelos dois ao mesmo tempo.

⚠️ **OAuth não funciona em `nexo.fly.dev`**: o domínio não está nas allowlists de Shopee e
TikTok. Leitura funciona; reautorizar canal, não. É o pré-requisito do domínio próprio.

### Nota de método

Este doc afirmou três coisas erradas sobre o Fly antes de serem verificadas: que dava para
configurar limite de gasto (não dá), que duração de sync equivale a consumo de CPU (não
equivale) e que o trial permitia testar sem cartão (a tela exige verificação para
deployar). Duas foram corrigidas por revisão externa, uma pela própria tela. **Preço,
limite e gate de plataforma são para ler na fonte antes de escrever, não depois.**

---

Relacionado: [ADR-015](./adr/ADR-015-compute-em-sao-paulo-com-banco-gerenciado.md) ·
[`docker.md`](./docker.md) ·
[`infra-decisao-hospedagem.md`](./infra-decisao-hospedagem.md)
