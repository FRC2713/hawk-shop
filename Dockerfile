# syntax=docker/dockerfile:1

# Debian rather than Alpine so the glibc prebuilds work as shipped.
#
# node:22 ships npm 10, which rejects the lockfile this repo commits — npm 11
# resolves the nitro/unstorage dependency tree differently, and `npm ci` under
# npm 10 fails as out of sync. Pin npm 11 so the container matches the npm that
# writes the lockfile.
FROM node:22-bookworm-slim AS base
RUN npm install -g npm@11

# --ignore-scripts is load-bearing. better-sqlite3 bundles prebuilt binaries for
# linux/darwin/win x64+arm64 and declares no install script, but npm runs
# `node-gyp rebuild` by default for any package carrying a binding.gyp — which
# needs python3 and a C++ toolchain, and would compile from source what is
# already sitting in the tarball. Nothing else in the tree needs an install
# script; if that changes, this flag has to be revisited.
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
# Nitro's node-server preset reads these; HOST is the bind address.
ENV PORT=3000
ENV HOST=0.0.0.0
# The single durable location: SQLite database + uploaded images.
ENV DATA_DIR=/data

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs hawkshop

# `vite build` emits a self-contained .output: the server bundle, the traced
# runtime dependencies it needs (including the better-sqlite3 native addon under
# .output/server/node_modules), and the static assets under .output/public,
# which the node-server preset serves itself.
COPY --from=builder --chown=hawkshop:nodejs /app/.output ./.output

# Applied on boot by app/lib/db/client.ts.
COPY --from=builder --chown=hawkshop:nodejs /app/drizzle ./drizzle

RUN mkdir -p /data/uploads && chown -R hawkshop:nodejs /data

USER hawkshop
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
