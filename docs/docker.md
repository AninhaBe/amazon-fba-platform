# Docker — a imagem do NEXO

**Verificado em 19/08/2026** — imagem buildada, container no ar e health check 200 em
`localhost:3333`.

Existe por causa da **Fase A do [ADR-015](./adr/ADR-015-compute-em-sao-paulo-com-banco-gerenciado.md)**:
o compute vai para uma VPS com Coolify, e o Coolify roda tudo em container. A receita
sendo **nossa e versionada** é o que torna o build reproduzível — a mesma imagem roda na
máquina de quem desenvolve e na VPS, sem "funciona aqui".

## O que NÃO mudou

**Produção continua no Render, com `next start`.** O `render.yaml` declara
`runtime: node` e `buildCommand: npm install && npm run build` — o Render **ignora** o
`Dockerfile`. Nada do que está aqui afeta o que está no ar hoje.

O `output: "standalone"` no `next.config.ts` só liga com `BUILD_STANDALONE=1`, que é
setado dentro do `Dockerfile`. Fora dele, o build é o de sempre.

## Como usar

```bash
wsl bash scripts/docker-build.sh          # builda (le as NEXT_PUBLIC_* do .env.local)
wsl bash scripts/docker-smoke.sh          # sobe, testa /api/health, derruba
wsl docker system prune -af               # devolve o espaco do cache de build
```

Para abrir no navegador, o container precisa ficar de pé num terminal em primeiro plano:

```bash
wsl docker run --name nexo-run --env-file .env.local -e DATA_DIR=/tmp/nexo-data \
  -p 3333:3000 nexo:test
# depois: http://localhost:3333
```

## As três pegadinhas (todas pagas caro em 19/08)

### 1. `NEXT_PUBLIC_*` é assada no build, não lida em runtime

O `next build` **substitui `process.env.NEXT_PUBLIC_*` pelo valor literal** no bundle —
inclusive no código de servidor. Por isso elas entram como `--build-arg`, e não como env
de runtime.

**Sintoma quando falta:** a imagem builda, sobe, `/api/health` responde 200 — e a tela de
login diz *"O acesso está bloqueado até as credenciais do Supabase serem configuradas no
Render"*. Passar a variável no `docker run` **não conserta**: o valor vazio já está no
bundle.

O `scripts/docker-build.sh` tem guarda-corpo para isso: depois de buildar, ele procura a
URL do Supabase dentro de `/app/.next` e **reprova a imagem** se não achar.

### 2. ⛔ Nunca dar `source` no `.env.local`

```bash
set -a; . .env.local; set +a     # NÃO
```

`source` **executa** o arquivo. O nosso `.env.local` tem um valor que quebra em várias
linhas (um token), então o shell tenta rodar o pedaço solto como comando, **morre no
meio, e as variáveis do fim do arquivo nunca são definidas** — silenciosamente. Foi
exatamente esse o bug do primeiro build.

Formas seguras:
- **Scripts em Node:** `node --env-file=.env.local ...` (faz parsing de verdade) — é o que
  `scripts/*.mjs` já usam.
- **Scripts em shell:** parsing por linha, como o `read_env()` do `scripts/docker-build.sh`.
- **Docker:** `--env-file .env.local` (o Docker faz o parsing, não executa).

Além do bug, sourcing arquivo de segredo é executar conteúdo sensível — evitar por
princípio, não só por causa desta falha.

### 3. `DATA_DIR` precisa de volume

O app grava **custos e contas OAuth** em disco. No Render isso é `/var/data`, com disco
persistente declarado no `render.yaml`.

⚠️ **No Coolify, montar um volume e apontar `DATA_DIR` para ele.** Sem isso, cada deploy
apaga esses dados.

## Detalhes da imagem

| | |
|---|---|
| Tamanho | ~302 MB |
| Base | `node:22-alpine` |
| Estágios | `deps` → `builder` → `runner` |
| Usuário | `nextjs` (não-root) |
| Porta | 3000 |
| Health check | `GET /api/health` |

**Segredos ficam fora da imagem:** o `.dockerignore` exclui `.env*` do contexto de build.
Só as duas `NEXT_PUBLIC_*` entram — e elas são públicas por definição (vão para o
navegador).

📌 **`scripts/` fica DENTRO do contexto de propósito:** `src/lib/db.ts` importa
`migration-contracts.mjs` e `migration-safety.mjs` de lá (gate das migrações). Excluir a
pasta quebra o build.

## Ambiente local: Docker Engine no WSL2, não Docker Desktop

Instalado em 19/08: **Docker Engine 29.1.3** dentro do Ubuntu 24.04 do WSL2, com systemd.

Motivo: é **a mesma coisa que a VPS vai rodar**. O Desktop é uma camada de GUI por cima,
mora no `C:` (que está cheio nesta máquina) e tem licença comercial acima de certo porte.
Os comandos aprendidos aqui valem na VPS sem tradução.

⚠️ **Limitação do WSL:** a VM hiberna quando não há sessão ativa, e o container morre
junto (exit 137). Para deixar de pé, manter um terminal em primeiro plano. Na VPS o
systemd resolve isso sozinho.

## O que o Coolify vai precisar

1. Repositório conectado — ele detecta o `Dockerfile` sozinho
2. **Build args:** `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
3. **Env de runtime:** todo o resto (ver a lista em `render.yaml`)
4. **Volume** montado, com `DATA_DIR` apontando para ele
5. **Health check:** `/api/health`

Relacionado: [ADR-015](./adr/ADR-015-compute-em-sao-paulo-com-banco-gerenciado.md) ·
[ADR-006](./adr/ADR-006-migracao-self-hosted-coolify.md) ·
[`infra-decisao-hospedagem.md`](./infra-decisao-hospedagem.md)
