# Deployment — cocarr-core-api (Railway)

The API is containerised (`Dockerfile`) and deployed on Railway from the
`develop` branch. Config is declared in `railway.json`; every value the code
needs is documented in [`.env.example`](../.env.example).

## Runtime facts
- Entry point: `node index.js`, mounts all routes at **`/v1`**.
- Binds `0.0.0.0` and reads **`process.env.PORT`** (Railway injects it; falls back to `3030`).
- ORM: Sequelize → **MySQL** (`dialect: 'mysql'`). Needs a reachable MySQL instance.
- On boot it connects to the DB and ensures the break-glass super-admin exists
  (`BOOTSTRAP_SUPER_ADMIN_EMAIL`). A missing/unreachable DB fails the boot.
- In-process cron jobs (settlement, refunds) via `node-cron`.

## First-time Railway setup (manual — needs your dashboard + secrets)
1. **Create a project / service** and connect the GitHub repo
   `CoCarr-org/cocarr-core-api`, branch **`develop`**. Railway reads
   `railway.json` and builds from the `Dockerfile` automatically.
2. **Add a MySQL database** (Railway MySQL plugin or external). Copy its host,
   port, name, user, password into `DB_*`.
3. **Set all env vars** from `.env.example` in the service Variables tab. The
   sensitive ones you must supply: `DB_PASS`, `USER_SERVICE_ACCOUNT`,
   `ADMIN_SERVICE_ACCOUNT` (Firebase service-account JSON, one line),
   `PG_KEY` / `PG_SEC` / `PG_HIDDEN`, `KYC_*`, `SENDGRID_API_KEY`, `MSG_KEY`,
   `STORAGE_*`, `BOOTSTRAP_SUPER_ADMIN_PASSWORD`.
4. **Networking:** generate a public domain (or map `api.cocarr.com`). Set
   `PUBLIC_API_URL` to `https://<that-domain>/v1`.
5. **CORS / panels:** set `CORS_ORIGINS` to every browser origin (admin panels +
   rider web), and `ADMIN_PANEL_ORIGINS` per the panel plan.

## Scaling caveat
Cron jobs run inside the process. If you raise `numReplicas`, run the crons on
exactly one instance — set `SETTLEMENT_CRON_ENABLED` / `REFUND_CRON_ENABLED` to
`false` on the others, or split a dedicated worker service.

## Health check
No dedicated health route is wired yet. `railway.json` intentionally omits
`healthcheckPath` so a deploy isn't blocked. Consider adding a `GET /v1/health`
that returns 200 (and `db.authenticate()`) before enabling a Railway healthcheck.

## Migrations
The app has historically relied on `db.sync` at boot; explicit Sequelize
migrations live in `migrations/`. If you adopt migration-based deploys, run
`npx sequelize-cli db:migrate` as a release step (requires the `sequelize-cli`
devDependency — drop `--omit=dev` for that job or run it separately).
