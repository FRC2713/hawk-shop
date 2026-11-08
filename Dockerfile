# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
RUN npm install -g npm@11
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS production-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/data
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs hawkshop
COPY --from=production-deps --chown=hawkshop:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=hawkshop:nodejs /app/dist ./dist
COPY --from=builder --chown=hawkshop:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=hawkshop:nodejs /app/package.json ./package.json
RUN mkdir -p /data/uploads && chown -R hawkshop:nodejs /data
USER hawkshop
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/entry.mjs"]
