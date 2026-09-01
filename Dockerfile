# NEXO — imagem de produção (Next.js 16, output standalone)
#
# Build:
#   docker build -t nexo \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
#     --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... .
# Run:
#   docker run -p 3000:3000 --env-file <env de runtime> nexo
#
# ⚠️ Variáveis NEXT_PUBLIC_* são inteiradas no bundle DURANTE o build — por isso
# entram como build args, não como env de runtime. Todo o resto (DATABASE_URL,
# tokens, segredos) entra só em runtime e nunca fica na imagem.
# O .dockerignore exclui .env* de propósito: segredo não entra em camada de imagem.
#
# ⚠️ DISCO PERSISTENTE: o app grava custos e contas OAuth em DATA_DIR (no Render é
# /var/data, ver render.yaml). No Coolify/VPS, montar um volume e apontar DATA_DIR
# para ele — sem isso, cada deploy apaga esses dados.
# Health check: GET /api/health (mesmo path do Render).

# ---- deps: instala node_modules a partir do lockfile ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: next build em modo standalone ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
# Opcional: sem valor o widget do Crisp fica dormente (nenhum script carrega).
ARG NEXT_PUBLIC_CRISP_WEBSITE_ID
# Carimbo da versao: com ele o Next detecta version skew e recarrega sozinho
# a aba de quem ja estava com o produto aberto. Passar o SHA do commit:
#   --build-arg DEPLOYMENT_VERSION=$(git rev-parse --short HEAD)
ARG DEPLOYMENT_VERSION
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_CRISP_WEBSITE_ID=$NEXT_PUBLIC_CRISP_WEBSITE_ID \
    DEPLOYMENT_VERSION=$DEPLOYMENT_VERSION \
    BUILD_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner: só o necessário para servir ----
FROM node:22-alpine AS runner
WORKDIR /app

# ⚠️ O ARG PRECISA SER REDECLARADO AQUI, e esquecer isso foi um defeito real.
#
# `ARG`/`ENV` do estágio `builder` NÃO atravessam para o `runner`: são imagens
# diferentes. Em 01/09/2026 o carimbo do commit chegou ao build (o bundle recebeu
# a variável) e o RUNTIME ficou sem ela — `/api/health` respondeu
# `commit: "desconhecido"` depois de o build-arg já estar correto.
#
# Foram TRÊS camadas do mesmo defeito, e cada uma parecia consertada até a
# próxima ser verificada: (1) `fly-deploy.sh` não passava o build-arg;
# (2) a rota lia `FLY_MACHINE_VERSION`, que é id de máquina do Fly e não commit;
# (3) o ENV não existia neste estágio. Conferir no `/api/health` depois de cada
# tentativa foi o que separou as três — supor que a anterior bastava teria
# deixado o campo mentindo.
ARG DEPLOYMENT_VERSION
ENV DEPLOYMENT_VERSION=$DEPLOYMENT_VERSION \
    NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

# roda sem root
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# standalone não copia public/ nem .next/static sozinho (docs do output standalone)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
