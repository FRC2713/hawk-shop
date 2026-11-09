# Hawk Shop

Manufacturing workflow for Red Hawk Robotics. Release parts from an Onshape Part Studio, track them on a live kanban board, assign work, manage equipment and manufacturing processes, and review completed parts.

Shop uses Astro server-rendered pages and React islands, with Hawk Eye's typography, team marks, semantic colors, and system dark mode. SQLite and uploads live together under `DATA_DIR` in one container.

## Sign-in and CAD access

Sign in through Hawk Suite with the team's Slack workspace account. Onshape is an optional CAD connection, available from the account menu. It is required for importing CAD parts and writing part numbers. Local cards, equipment, processes, assignments, and the board work without connecting Onshape.

The app accepts Suite identity headers only when `HAWK_SUITE_TRUST_PROXY=true`. Run it on an isolated network behind the Suite gateway, which must strip caller identity headers before authorization. Do not publish the trusted app port to an untrusted network. The standalone Compose file binds to loopback by default.

The matching gateway and Compose changes are in [deploy/hawk-suite-auth.patch](deploy/hawk-suite-auth.patch). Apply and verify them in Hawk Suite before deploying this image. This repository does not enable or deploy that patch automatically. See [docs/architecture.md](docs/architecture.md) for the authentication contract and migration details.

## Setup

Use Node 24 or later and npm 11.

```bash
npm ci
cp .env.example .env
# Configure the trusted Suite gateway, workspace, issuer, and public APP_URL.
npm run dev
```

The default address is `http://localhost:3000`. Without Suite configuration, the sign-in page explains the missing setup and data endpoints fail closed. There is no development authentication bypass. Tests use disposable databases and synthetic gateway identities.

For CAD access, create an [Onshape API key pair](https://dev-portal.onshape.com/keys) and set `ONSHAPE_ACCESS_KEY` and `ONSHAPE_SECRET_KEY` on the server. Every CAD request uses that Onshape account, so give it access to the robot documents only. `/onshape` shows whether the key pair is configured. An embedded Onshape entry offers a top-level continuation for Suite sign-in while preserving its Part Studio parameters.

## Configuration

| Variable                                    | Default                     | Purpose                                                                |
| ------------------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| `HAWK_SUITE_TRUST_PROXY`                    | `false`                     | Enable only behind the isolated, trusted Suite gateway                 |
| `HAWK_SUITE_TEAM_ID`                        | unset                       | Approved Slack workspace ID, required with proxy trust                 |
| `HAWK_SUITE_ISSUER`                         | unset                       | Suite origin ending in `/`, required with proxy trust                  |
| `APP_URL`                                   | `http://localhost:3000`     | Browser-facing origin for cookies, login return URLs, and write checks |
| `HOST` / `PORT`                             | `127.0.0.1` / `3000`        | Server listener; container listens on `0.0.0.0`                        |
| `ONSHAPE_ACCESS_KEY` / `ONSHAPE_SECRET_KEY` | unset                       | Optional Onshape API key pair for CAD import and part-number writes    |
| `ONSHAPE_BASE_URL`                          | `https://cad.onshape.com`   | Onshape stack origin; enterprise stacks use their own subdomain        |
| `ONSHAPE_CACHE_TTL_SECONDS`                 | `300`                       | Editable workspace cache TTL; immutable part versions do not expire    |
| `DATA_DIR`                                  | `./data`, `/data` in Docker | Database and uploads root                                              |
| `DATABASE_PATH`                             | `$DATA_DIR/hawk-shop.db`    | SQLite path override                                                   |
| `UPLOADS_DIR`                               | `$DATA_DIR/uploads`         | Upload path override                                                   |

## Development and verification

```bash
npm run typecheck
npm run format:check
npm run build
npx playwright install chromium
npm test
npm run start
```

The checks cover Astro and TypeScript, formatting, the production build, Suite access control, manufacturing and equipment API behavior, uploads, live updates, and browser interactions. Tests do not call live Onshape endpoints.

The file map and conventions are in [AGENTS.md](AGENTS.md). Before changing UI, read [docs/BRANDING.md](docs/BRANDING.md). Run `npm run generate:onshape-client` only when intentionally refreshing the generated client from Onshape's live specification.

## Data and upgrades

Keep the existing volume when upgrading. The schema, timestamps, card IDs, column IDs, historical users, image paths, and ordered migration history are preserved. New submitters and assignees use verified Suite identities. No database reset is needed.

Edit `src/server/db/schema.ts`, run `npm run db:generate`, and commit the new generated SQL. Never edit a shipped migration. The server applies migrations and seeds missing defaults on boot. `npm run db:migrate` applies migrations without starting the app.

Back up the whole data directory. Stop the app before copying SQLite and its WAL files, or use SQLite's online backup API. Restore the database and uploads together.
