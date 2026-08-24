#!/usr/bin/env bash
# Deploy do NEXO para o Fly.
#
# Existe porque `fly deploy` pelado QUEBRA O LOGIN em produção, e isso já
# aconteceu (24/08/2026): as variáveis `NEXT_PUBLIC_*` são inteiradas no bundle
# DURANTE o build, e `fly secrets` só existe em tempo de execução. O app sobe
# "saudável" — health check verde — com a autenticação morta:
#
#   /login  → "Configure as credenciais do Supabase no servidor"
#   logs    → [scheduler] <canal>: HTTP 503 em 0s, nos quatro canais
#
# Uso:  bash scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "⚠️  Há mudanças não commitadas. O fly deploy sobe a ÁRVORE DO DISCO, não o commit:"
  git status --short
  echo
  read -r -p "Subir mesmo assim? [s/N] " resposta
  [ "$resposta" = "s" ] || { echo "Abortado."; exit 1; }
fi

SUPA_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2- | tr -d '"\r')
SUPA_KEY=$(grep '^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=' .env.local | cut -d= -f2- | tr -d '"\r')

if [ -z "$SUPA_URL" ] || [ -z "$SUPA_KEY" ]; then
  echo "🔴 Faltam NEXT_PUBLIC_SUPABASE_URL e/ou NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY no .env.local."
  echo "   Subir assim derruba o login. Abortado."
  exit 1
fi

# O carimbo da versão liga a proteção de version skew (next.config.ts →
# deploymentId): a aba de quem já estava com o NEXO aberto recarrega sozinha em
# vez de falhar com "Failed to find Server Action".
VERSAO=$(git rev-parse --short HEAD)

echo "▸ Subindo $VERSAO para o app nexo (região gru)"
fly deploy --app nexo \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$SUPA_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$SUPA_KEY" \
  --build-arg DEPLOYMENT_VERSION="$VERSAO"

echo
echo "▸ Conferindo se a autenticação subiu configurada (o health check NÃO prova isso)"
sleep 8
if fly logs --app nexo --no-tail 2>/dev/null | tail -40 | grep -q "HTTP 503 em 0s"; then
  echo "🔴 Schedulers em 503 — a autenticação NÃO subiu. Conferir os build-args."
  exit 1
fi
echo "✅ Sem 503 nos schedulers."
