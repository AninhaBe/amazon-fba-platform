#!/bin/bash
# Deploy do NEXO no Fly.io — ver docs/adr/ADR-015 e docs/fly-io.md.
#
# Uso:
#   wsl bash scripts/fly-deploy.sh                 # producao (app nexo), build remoto
#   wsl bash scripts/fly-deploy.sh --local         # build na propria maquina
#   wsl bash scripts/fly-deploy.sh --app nexo-staging
#
# Por que existe: NEXT_PUBLIC_* sao substituidas DURANTE o `next build`, entao
# precisam entrar como --build-arg. `fly deploy` cru nao passa nada disso e a
# imagem sobe com as credenciais VAZIAS — o app funciona, o health check passa, e
# so a tela de login denuncia ("acesso bloqueado ate as credenciais do Supabase
# serem configuradas").
#
# ⚠️ NAO usar `set -a; . .env.local`: sourcing EXECUTA o arquivo, e o nosso tem
# valor que quebra em varias linhas. O source morre no meio e as variaveis do fim
# nunca sao definidas. Aqui a leitura e por parsing.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=".env.local"

# ── O GIT PRECISA RESPONDER AQUI DENTRO ────────────────────────────────────
#
# ⚠️ MEDIDO EM 02/09/2026, e o modo de falha e o pior que existe: SILENCIOSO E
# VERDE. Este script roda no WSL, e o deploy correto sai de um WORKTREE (regra
# da arvore limpa). Num worktree ligado, `.git` e um ARQUIVO com o caminho do
# Windows dentro ("gitdir: G:/amazon-fba-platform/.git/worktrees/xxx") — que
# nao existe dentro do WSL. O git morre com "not a git repository", e os dois
# portoes abaixo passam por acidente:
#
#   COMMIT="$(git rev-parse ... || echo desconhecido)"  -> carimbo "desconhecido"
#   SUJO="$(git status --porcelain ... || true)"        -> "arvore limpa" SEM CONFERIR
#
# O segundo e o grave: a guarda que impede publicar o trabalho nao commitado de
# outro agente vira no-op justamente no caminho que a regra manda usar. Foi assim
# que a v235 subiu sem carimbo — a imagem estava certa, mas nenhum dos dois
# portoes tinha rodado.
#
# Por isso: traduz o gitdir do worktree, e ABORTA se o git ainda nao responder.
# Portao que nao consegue medir tem de gritar, nunca degradar para "passou".
if [ -f .git ]; then
  GITDIR="$(sed -n 's/^gitdir: //p' .git | tr -d '\r')"
  # Caminho do Windows (G:/...) nao existe dentro do WSL: vira /mnt/g/...
  # ⚠️ Traduzido por `wslpath`, que existe para isto. As duas tentativas
  # anteriores erraram em silencio: um `case` com padrao [A-Za-z]:[/BARRA]* onde a
  # barra invertida ESCAPAVA o colchete de fechamento (a classe nunca fechava, o
  # case nunca casava), e um `sed` com \L que tambem nao pegou. Nenhuma das duas
  # caiu por leitura — as duas cairam ao RODAR. Ferramenta pronta > engenhosidade.
  GITDIR="$(wslpath -u "$GITDIR" 2>/dev/null || printf %s "$GITDIR")"
  if [ -d "$GITDIR" ]; then
    export GIT_DIR="$GITDIR"
    export GIT_WORK_TREE="$PWD"
  fi
fi
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ABORTADO: o git nao responde neste diretorio ($PWD)."
  echo ""
  echo "Sem git, o carimbo de commit vira 'desconhecido' E a guarda de arvore"
  echo "limpa passa sem conferir nada — os dois em silencio. Resolva antes de subir."
  exit 1
fi

# Build REMOTO por padrao: o Fly builda nos servidores dele, sem consumir RAM nem
# disco desta maquina (o C: aqui vive cheio). --local force o build no Docker local.
MODO="--remote-only"
APP_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --local) MODO="--local-only"; shift;;
    --app) APP_ARGS+=(--app "$2"); shift 2;;
    *) echo "Argumento desconhecido: $1"; exit 1;;
  esac
done

command -v fly >/dev/null 2>&1 || export PATH="/root/.fly/bin:$PATH"
command -v fly >/dev/null 2>&1 || {
  echo "ERRO: flyctl nao instalado. Instale com:"
  echo "  curl -L https://fly.io/install.sh | sh"
  exit 1
}
[ -f "$ENV_FILE" ] || { echo "ERRO: $ENV_FILE nao encontrado"; exit 1; }

# Le UMA variavel do .env sem executar o arquivo.
read_env() {
  grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null \
    | cut -d= -f2- \
    | tr -d '\r' \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

SUPABASE_URL="$(read_env NEXT_PUBLIC_SUPABASE_URL)"
SUPABASE_KEY="$(read_env NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
# Opcional: vazia = widget do Crisp dormente no bundle (nenhum script carrega).
# NEXT_PUBLIC entra no bundle NO BUILD — esquecer o build-arg aqui foi o que já
# quebrou o login uma vez; por isso toda env nova do bundle passa por este script.
CRISP_ID="$(read_env NEXT_PUBLIC_CRISP_WEBSITE_ID)"

# O COMMIT QUE ESTA SUBINDO — e ele estava FALTANDO ate 01/09/2026.
#
# O Dockerfile ja declarava `ARG DEPLOYMENT_VERSION` com o comentario dizendo
# "passar o SHA do commit", e este script NUNCA passava. Duas consequencias, as
# duas silenciosas: a deteccao de version skew do Next (que recarrega a aba de
# quem esta com o produto aberto quando sai versao nova) nunca teve o carimbo, e
# `/api/health` nao tinha como dizer que commit esta no ar.
#
# Achado ao conferir se a v222 continha um commit especifico: o campo respondia
# com FLY_MACHINE_VERSION, que e identificador do Fly e nao do repositorio.
COMMIT="$(git rev-parse --short=12 HEAD 2>/dev/null || echo desconhecido)"
if [ "$COMMIT" = "desconhecido" ]; then
  echo "AVISO: sem git aqui — a imagem sobe sem carimbo de commit."
fi
[ -n "$SUPABASE_URL" ] || { echo "ERRO: NEXT_PUBLIC_SUPABASE_URL vazia em $ENV_FILE"; exit 1; }
[ -n "$SUPABASE_KEY" ] || { echo "ERRO: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY vazia em $ENV_FILE"; exit 1; }
echo "ok: URL (${#SUPABASE_URL} chars) e KEY (${#SUPABASE_KEY} chars) lidas de $ENV_FILE"
if [ -n "$CRISP_ID" ]; then echo "ok: CRISP_WEBSITE_ID presente (widget ativo no build)"; else echo "ok: CRISP_WEBSITE_ID ausente (widget dormente)"; fi
echo "build: $MODO"

# Le a versao que a MAQUINA roda — a unica fonte de verdade sobre o que esta no ar.
#
# ⚠️ ISOLADA NUMA FUNCAO COM '|| true' de proposito: 'set -o pipefail' somado ao
# SIGPIPE que o 'head' provoca no 'grep' derruba o script inteiro. Foi o que
# aconteceu no PRIMEIRO uso desta defesa (28/08/2026): a conferencia criada para
# impedir deploy silencioso acabou impedindo o proprio deploy, e o script morreu
# antes de chamar o 'fly deploy'. Falha aqui devolve vazio; quem chama decide.
#
# ⚠️ E SEM "${APP_ARGS[@]:-}": com o array VAZIO (o caso padrao, que usa o
# fly.toml), essa expansao passa uma STRING VAZIA como argumento, e o
# 'fly status' responde com o texto de uso em vez do JSON — a leitura voltava
# vazia e a conferencia acusava "versao desconhecida" num deploy que tinha
# funcionado. Aqui expandimos so quando ha algo, com '+'.
versao_na_maquina() {
  fly status ${APP_ARGS[@]+"${APP_ARGS[@]}"} --json 2>/dev/null \
    | tr ',' '\n' \
    | grep -m1 fly_release_version \
    | grep -o '[0-9][0-9]*' \
    || true
}

# A versao ANTES do deploy, para saber o que precisa mudar depois dele.
VERSAO_ANTES="$(versao_na_maquina)"
[ -n "$VERSAO_ANTES" ] && echo "versao rodando agora: $VERSAO_ANTES"

# ── ARVORE LIMPA, CONFERIDA AGORA ──────────────────────────────────────────
#
# ⚠️ 'fly deploy' monta a imagem lendo a arvore no momento DELE, nao no momento
# em que alguem conferiu o 'git status'. Em 28/08/2026 a arvore estava limpa
# quando o deploy foi disparado e SUJA quando o Docker leu: outro agente salvou
# no meio, e 92 linhas nao commitadas dele foram publicadas sem autorizacao.
#
# A licao e a mesma do "release criado nao e release no ar", virada do avesso:
# ESTADO CONFERIDO NAO E ESTADO NO MOMENTO DO USO. Por isso a conferencia mora
# aqui, colada no 'fly deploy', e nao na cabeca de quem chamou o script.
SUJO="$(git status --porcelain 2>/dev/null || true)"
if [ -n "$SUJO" ]; then
  echo ""
  echo "ABORTADO: a arvore nao esta limpa, e o 'fly deploy' publica a ARVORE, nao o commit."
  echo ""
  echo "$SUJO"
  echo ""
  echo "O QUE FAZER:"
  echo "  - arquivo seu:            commite ou 'git stash push -- <arquivo>' antes de subir"
  echo "  - arquivo de outro agente: PEÇA para ele commitar ou dar stash. Nao mexa no"
  echo "                             trabalho alheio para ganhar tempo, e nao publique"
  echo "                             o que voce nao tem autorizacao para publicar."
  echo ""
  echo "Depois rode este script de novo. Ele confere a arvore OUTRA VEZ, aqui mesmo."
  exit 1
fi
echo "ok: arvore limpa conferida agora, colada no deploy"

set +e
fly deploy "$MODO" "${APP_ARGS[@]:-}" \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$SUPABASE_KEY" \
  --build-arg NEXT_PUBLIC_CRISP_WEBSITE_ID="$CRISP_ID" \
  --build-arg DEPLOYMENT_VERSION="$COMMIT"
SAIDA_DEPLOY=$?
set -e

# ─────────────────────────────────────────────────────────────────────────────
# CONFERENCIA OBRIGATORIA: "release criado" NAO e "release no ar".
#
# INCIDENTE DE 28/08/2026 que criou esta secao: a v145 foi criada, ficou 26
# minutos em 'running', NUNCA aplicou — e ainda segurou o LEASE da maquina, o
# que fez o deploy seguinte falhar com "lease currently held by...". Como o
# comando de deploy tinha saido sem estardalhaco, foi reportado como "no ar", e
# uma correcao de producao ficou uma hora inteira sendo dada como resolvida
# enquanto a maquina rodava a versao ANTERIOR (144).
#
# Daqui em diante o script so termina em sucesso depois de VER a maquina rodando
# uma versao NOVA. Se nao vir, falha ruidosamente — e melhor um deploy que grita
# do que uma pessoa afirmando o que nao aconteceu.
# ─────────────────────────────────────────────────────────────────────────────
if [ "$SAIDA_DEPLOY" -ne 0 ]; then
  echo
  echo "ERRO: 'fly deploy' terminou com codigo $SAIDA_DEPLOY — o release NAO esta no ar."
  echo "  Se a mensagem acima fala em LEASE preso ('lease currently held by'), ha um deploy"
  echo "  anterior travado segurando a maquina: espere o horario de expiracao que ela informa"
  echo "  e rode de novo. NAO afirme que a correcao subiu ate este script sair com 0."
  exit "$SAIDA_DEPLOY"
fi

echo
echo "conferindo se a maquina realmente assumiu a versao nova..."
VERSAO_AGORA=""
for _ in $(seq 1 30); do
  VERSAO_AGORA="$(versao_na_maquina)"
  # Sem versao anterior conhecida, basta ler alguma; com ela, exigimos avanco.
  if [ -n "$VERSAO_AGORA" ] && { [ -z "$VERSAO_ANTES" ] || [ "$VERSAO_AGORA" -gt "$VERSAO_ANTES" ]; }; then
    break
  fi
  sleep 10
done

if [ -z "$VERSAO_AGORA" ] || { [ -n "$VERSAO_ANTES" ] && [ "$VERSAO_AGORA" -le "$VERSAO_ANTES" ]; }; then
  echo
  echo "ERRO: a maquina continua na versao '${VERSAO_AGORA:-desconhecida}' (antes: ${VERSAO_ANTES:-?}) apos 5 minutos."
  echo "  O release foi criado mas NAO foi aplicado — provavelmente preso em 'running'."
  echo "  Confira com:  fly releases  |  fly status  |  fly machine list"
  echo "  ⚠️ NAO reporte esta entrega como 'no ar': a maquina esta rodando a versao ANTERIOR."
  exit 1
fi

echo "ok: maquina rodando a versao $VERSAO_AGORA (antes: ${VERSAO_ANTES:-?})"
echo
echo "Lembretes pos-deploy:"
echo "  - segredos de runtime vao por 'fly secrets set', NAO no fly.toml"
echo "  - conferir o health check em /api/health"
