#!/bin/bash
# Builda a imagem do NEXO lendo as NEXT_PUBLIC_* do .env.local.
#
# Por que existe: NEXT_PUBLIC_* sao substituidas DURANTE o `next build`, entao
# precisam entrar como --build-arg. Passar isso na mao atravessando camadas de
# shell (Git Bash -> WSL -> docker) perde as aspas silenciosamente e a imagem sai
# com a variavel VAZIA — o app builda, sobe, e so falha na tela de login dizendo
# que falta configurar o Supabase.
#
# ⚠️ NAO use `set -a; . .env.local`: sourcing EXECUTA o arquivo, e o nosso tem
# valor que quebra em varias linhas (token). O source morre no meio e as
# variaveis do fim do arquivo nunca sao definidas — foi exatamente esse o bug.
# Aqui a leitura e feita por parsing, sem executar nada.
#
# Uso (a partir da raiz do repo):   wsl bash scripts/docker-build.sh [tag]
set -euo pipefail

cd "$(dirname "$0")/.."
TAG="${1:-nexo:test}"
ENV_FILE=".env.local"

[ -f "$ENV_FILE" ] || { echo "ERRO: $ENV_FILE nao encontrado"; exit 1; }

# Le UMA variavel do .env sem executar o arquivo: primeira linha que casa,
# tudo depois do primeiro '=', sem \r final e sem aspas em volta.
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

docker build -t "$TAG" \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$SUPABASE_KEY" \
  .

# Guarda-corpo: a imagem so presta se o valor foi mesmo assado no bundle.
# Sem isso o erro so aparece na tela de login, muito depois.
echo "== verificando se a URL do Supabase foi assada na imagem =="
if docker run --rm --entrypoint sh "$TAG" -c 'grep -rqo "https://[a-z0-9]*\.supabase\.co" /app/.next 2>/dev/null'; then
  echo "OK — imagem $TAG pronta"
else
  echo "FALHOU: a imagem foi buildada SEM a URL do Supabase. Nao use."
  exit 1
fi
