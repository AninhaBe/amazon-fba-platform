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
[ -n "$SUPABASE_URL" ] || { echo "ERRO: NEXT_PUBLIC_SUPABASE_URL vazia em $ENV_FILE"; exit 1; }
[ -n "$SUPABASE_KEY" ] || { echo "ERRO: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY vazia em $ENV_FILE"; exit 1; }
echo "ok: URL (${#SUPABASE_URL} chars) e KEY (${#SUPABASE_KEY} chars) lidas de $ENV_FILE"
echo "build: $MODO"

fly deploy "$MODO" "${APP_ARGS[@]:-}" \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$SUPABASE_KEY"

echo
echo "Lembretes pos-deploy:"
echo "  - segredos de runtime vao por 'fly secrets set', NAO no fly.toml"
echo "  - conferir 'fly status' e o health check em /api/health"
