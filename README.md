# hawk-shop

Self-hostable manufacturing workflow tool for an FRC team. Parts are pulled from
an Onshape CAD Part Studio, released onto a kanban board, and tracked through
manufacturing processes on shop equipment.

This is a self-hosted port of [rhr-mfg](https://github.com/FRC2713/rhr-mfg):
same app, but it runs as a single Docker container backed by SQLite instead of
depending on Supabase.

## Features

- 🔗 Onshape integration — browse a Part Studio, release parts onto the board
- 📦 Part management with cached thumbnails
- 📊 Kanban board with configurable columns and live updates
- 🏭 Equipment and manufacturing process tracking
- 🔒 Onshape OAuth sign-in
- 🐳 One container, one volume, no external services

## What differs from rhr-mfg

|              | rhr-mfg                  | hawk-shop                                                      |
| ------------ | ------------------------ | -------------------------------------------------------------- |
| Database     | Supabase Postgres        | SQLite via Drizzle ORM                                         |
| Migrations   | hand-applied SQL         | `drizzle-kit`, applied automatically on boot                   |
| File storage | Supabase Storage buckets | local files under `DATA_DIR/uploads`, served by `/api/files/*` |
| Live updates | Supabase Realtime        | server-sent events from `/api/kanban/events`                   |
| Deployment   | Vercel                   | any Docker host                                                |

Everything durable lives under a single directory (`DATA_DIR`) — back up that
one path and you have backed up the whole install.

## Quick start (Docker)

You need an Onshape OAuth application: create one at
[dev-portal.onshape.com/oauthApps](https://dev-portal.onshape.com/oauthApps).
Its redirect URL must exactly match `ONSHAPE_REDIRECT_URI` below.

```bash
git clone https://github.com/FRC2713/hawk-shop.git
cd hawk-shop
cp .env.example .env    # fill in ONSHAPE_CLIENT_ID / ONSHAPE_CLIENT_SECRET
docker compose up -d
```

The app comes up on http://localhost:3000. On first boot it creates the SQLite
database, applies migrations, and seeds the default kanban columns and the stock
process list.

To run it on your shop network, set `ONSHAPE_REDIRECT_URI` and `APP_URL` to the
machine's address (e.g. `http://shop-box.local:3000`) and register that same
redirect URL with your Onshape app.

### Serving over HTTPS / embedding in Onshape

To use hawk-shop as an embedded Onshape application, put it behind TLS and set
`ONSHAPE_IFRAME_EMBED=true`. That switches the auth cookies to
`SameSite=None; Secure`, which is required for third-party iframe contexts — and
which browsers reject over plain HTTP, hence the flag. Leave it `false` for a
normal LAN deployment.

## Configuration

| Variable                | Required | Default                                | Purpose                                                    |
| ----------------------- | -------- | -------------------------------------- | ---------------------------------------------------------- |
| `ONSHAPE_CLIENT_ID`     | yes      | —                                      | Onshape OAuth app client id                                |
| `ONSHAPE_CLIENT_SECRET` | yes      | —                                      | Onshape OAuth app secret                                   |
| `ONSHAPE_REDIRECT_URI`  | yes      | —                                      | Must match the app's registered redirect URL               |
| `ONSHAPE_SCOPE`         | no       | `OAuth2Read OAuth2ReadPII OAuth2Write` | Requested OAuth scopes                                     |
| `APP_URL`               | no       | `http://localhost:3000`                | Public origin; decides whether cookies get `Secure`        |
| `ONSHAPE_IFRAME_EMBED`  | no       | `false`                                | `SameSite=None` cookies for iframe embedding (needs HTTPS) |
| `COOKIE_SECURE`         | no       | derived from `APP_URL`                 | Override when TLS terminates upstream                      |
| `DATA_DIR`              | no       | `./data` (`/data` in Docker)           | Root for the database and uploads                          |
| `DATABASE_PATH`         | no       | `$DATA_DIR/hawk-shop.db`               | SQLite file location                                       |
| `UPLOADS_DIR`           | no       | `$DATA_DIR/uploads`                    | Uploaded image location                                    |

## Local development

```bash
npm install
cp .env.example .env     # fill in the Onshape credentials
npm run dev              # http://localhost:3000
```

The dev server creates and migrates `./data/hawk-shop.db` on first request.

```bash
npm run typecheck        # tsc — the main static check
npm run format           # prettier
npm run build            # production build
npm run db:generate      # new migration from schema changes
npm run db:migrate       # apply migrations without starting the server
npm run db:studio        # drizzle studio against the local database
```

## Backup and restore

Stop the container, copy the volume, start it again:

```bash
docker compose stop
docker run --rm -v hawk-shop_hawk-shop-data:/data -v "$PWD":/backup busybox \
  tar czf /backup/hawk-shop-backup.tar.gz -C /data .
docker compose start
```

SQLite runs in WAL mode, so a copy taken while the app is running may miss the
most recent writes — stop the container first for a consistent snapshot.

## Schema changes

Edit `app/lib/db/schema.ts`, then:

```bash
npm run db:generate      # writes drizzle/NNNN_*.sql
```

Commit the generated SQL. Migrations are applied automatically the next time the
app boots, so a `docker compose up` after an upgrade is all a deployment needs.
