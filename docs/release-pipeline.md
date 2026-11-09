# Release pipeline

PR CI checks the source. Publishing calls the same verification workflow before building a linux/amd64 candidate, validates configuration without starting the application, boots it with a disposable database and no external network, upgrades a disposable prior-release database and checks that existing data survives, and publishes that exact local image with a SHA tag. The immutable digest is the release identity. The image exposes its source revision and migration version in its health response.

After publishing main, a separate job asks hawk_suite to open a release PR. Configure repository variable `HAWK_SUITE_APP_ID` and secret `HAWK_SUITE_APP_PRIVATE_KEY` for a GitHub App installed on hawk_suite with Contents write and Pull requests write. The suite receiver verifies the successful publisher run and source revision before proposing the digest. A failure in the proposal job can be retried without publishing again. Version-tag builds publish an immutable candidate without proposing a production release.

Production remains gated in hawk_suite. `.hawk/app.json` documents the image contract. `node scripts/deploy-check.mjs` in the image validates configuration without touching SQLite or external services. Changes to configuration, health or storage must update that contract. No production values belong in it.

## Check the shop database before upgrading

From the candidate source checkout with dependencies installed, run:

```bash
HAWK_SHOP_MIGRATION_CHECK_DB=/path/to/shop.sqlite npm run check:migrations
```

Use the SQLite file under the shop's `DATA_DIR`. Stop writes while the check copies the files, or point it at a consistent filesystem snapshot that includes the database and any adjacent `-wal` and `-shm` files. Copying files separately while the app is writing cannot guarantee a consistent snapshot.

The check copies those files into a temporary directory and opens only the copy with SQLite. It applies pending migrations from the copied database's current level to the candidate head, checks row and value preservation, foreign keys, integrity and leftover rebuild tables, then removes the copy. It uses the shop's actual rows without inserting fixtures. A database already at head still gets integrity checks and has nothing to apply. The source database, WAL and SHM remain unchanged.

A nonzero exit reports the migration and failed assertion. Resolve failures before upgrading. The command also runs the normal empty and seeded migration checks; without the environment variable it runs only those checks. This pre-upgrade check does not replace a backup.
