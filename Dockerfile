# ---------- Stage 1: dependências ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Retries acima do default: redes intermitentes derrubam o npm ci.
RUN npm ci \
  --fetch-retries=5 \
  --fetch-retry-mintimeout=10000 \
  --fetch-retry-maxtimeout=120000 \
  --fetch-timeout=600000

# ---------- Stage 2: build do TypeScript ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- Stage 3: runtime ----------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# As migrations são JS puro (node-pg-migrate) e precisam de existir no
# container para o entrypoint as aplicar antes do boot.
COPY migrations ./migrations
COPY package.json ./

# Processo corre como utilizador sem privilégios.
USER node

EXPOSE 3000

CMD ["node", "dist/server.js"]
