# Medusa 2.19. Сборка кладёт результат в .medusa/server вместе с
# package.json и package-lock.json — оттуда ставим только прод-зависимости.

FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Собирает и бэкенд (tsc), и админку (vite) в .medusa/server/public/admin
RUN npx medusa build

FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat curl
ENV NODE_ENV=production
COPY --from=builder /app/.medusa/server ./
RUN npm ci --omit=dev && npm cache clean --force
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 9000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
  CMD curl -fsS http://127.0.0.1:9000/health || exit 1
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
