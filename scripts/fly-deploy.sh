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
[ -n "$SUPABASE_URL" ] || { echo "ERRO: NEXT_PUBLIC_SUPABASE_URL vazia em $ENV_FILE"; exit 1; }
[ -n "$SUPABASE_KEY" ] || { echo "ERRO: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY vazia em $ENV_FILE"; exit 1; }
echo "ok: URL (${#SUPABASE_URL} chars) e KEY (${#SUPABASE_KEY} chars) lidas de $ENV_FILE"
if [ -n "$CRISP_ID" ]; then echo "ok: CRISP_WEBSITE_ID presente (widget ativo no build)"; else echo "ok: CRISP_WEBSITE_ID ausente (widget dormente)"; fi
echo "build: $MODO"

# A versao ANTES do deploy, para saber o que precisa mudar depois dele.
VERSAO_ANTES="$(fly status "${APP_ARGS[@]:-}" --json 2>/dev/null \
  |  grep -o '"fly_release_version":[[:space:]]*"[0-9]*"' | head -1 | grep -o '[0-9]*$')"
[ -n "$VERSAO_ANTES" ] && echo "versao rodando agora: $VERSAO_ANTES"

set +e
fly deploy "$MODO" "${APP_ARGS[@]:-}" \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$SUPABASE_KEY" \
  --build-arg NEXT_PUBLIC_CRISP_WEBSITE_ID="$CRISP_ID"
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
  VERSAO_AGORA="$(fly status "${APP_ARGS[@]:-}" --json 2>/dev/null \
    |  grep -o '"fly_release_version":[[:space:]]*"[0-9]*"' | head -1 | grep -o '[0-9]*$')"
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
