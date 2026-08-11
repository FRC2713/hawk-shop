# syntax=docker/dockerfile:1

# Debian rather than Alpine so the glibc prebuilds work as shipped.
#
# --ignore-scripts is load-bearing. better-sqlite3 bundles prebuilt binaries for
# linux/darwin/win x64+arm64 and declares no install script, but npm runs
# `node-gyp rebuild` by default for any package carrying a binding.gyp — which
# needs python3 and a C++ toolchain, and would compile from source what is
# already sitting in the tarball. Nothing else in the tree needs an install
# script; if that changes, this flag has to be revisited.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# The single durable location: SQLite database + uploaded images.
ENV DATA_DIR=/data

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# `output: "standalone"` already traces in the runtime dependencies it needs,
# including the better-sqlite3 and sharp native addons.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Applied on boot by app/lib/db/client.ts.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data

USER nextjs
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
