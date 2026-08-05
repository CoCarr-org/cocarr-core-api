# cocarr-core-api

> Business Core Platform API.

Part of the **Cocarr Enterprise Platform** ([CoCarr-org](https://github.com/CoCarr-org)).

Topics: `operations`, `booking`, `inventory`, `platform`

## Purpose
The core platform API and system of record for the Cocarr car-sharing business:
bookings, hosts, vehicles, payments, payouts, wallet, memberships, referrals and
KYC — plus the platform's RBAC/IAM layer (teams, levels, per-screen permissions,
`resolveAccess` / `requirePermission`). Migrated unchanged from the original
`COCARR-BACKEND`; business logic is preserved, not rewritten.

## Architecture
This repository is one component of the Cocarr platform, a service-oriented
system fronted by the API gateway. Requests flow through the gateway to the
identity, authorization, workspace, core and notification services, each backed
by its own database. See [`cocarr-docs`](https://github.com/CoCarr-org/cocarr-docs)
for the full platform architecture and Architecture Decision Records.

## Technology Stack
- Node.js
- Express
- Sequelize ORM (MySQL, `dialect: 'mysql'`)
- Firebase Admin (Auth verification — separate user and admin projects)
- Razorpay (payments), Cashfree (Aadhaar e-KYC), SendGrid (email)
- S3-compatible object storage (Tigris) via a private image proxy
- Jest (tests — to be added)

## Folder Structure
```
index.js      # Entry point; mounts src/routes/rootRouter.js at /v1
src/          # controllers, services, models, routes, middlewares, utils, configs
models/       # Sequelize model definitions (top-level)
migrations/   # Sequelize migrations
config/       # Runtime configuration
scripts/      # Operational and migration scripts
docs/         # Domain documentation (e.g. ADMIN_TEAMS_RBAC.md)
seed.js       # Database seed
.github/      # Issue/PR templates, workflows (ci + branch-policy), CODEOWNERS
```

> See `CLAUDE.md` in this repo for the full operational detail carried over from
> `COCARR-BACKEND` (RBAC model, panel binding, KYC flow, payment signatures, etc.).

## Getting Started
```bash
# Clone
git clone https://github.com/CoCarr-org/cocarr-core-api.git
cd cocarr-core-api

# Work from the develop branch
git checkout develop
```
Copy `.env.example` to `.env` where applicable and install dependencies with
your package manager (`pnpm install`).

## Development
- Format: `pnpm prettier --write .`
- Lint: `pnpm lint`
- Test: `pnpm test`

Editor settings, Prettier, ESLint, EditorConfig and VS Code configuration ship
with the repository for a consistent developer experience.

## Contributing
Please read [CONTRIBUTING.md](CONTRIBUTING.md) and use the issue and pull
request templates. All changes require CODEOWNER review.

## Branch Strategy
| Branch    | Purpose                                   | Protected |
|-----------|-------------------------------------------|-----------|
| `main`    | Always-deployable production baseline     | Yes       |
| `develop` | Integration branch for feature work       | No        |
| `release` | Release-candidate stabilisation branch    | Yes       |

Feature branches: `feature/<description>` from `develop`.

## Deployment
Containerised and deployed to Railway. Talks to `cocarr-core-db`.

## Security
See [SECURITY.md](SECURITY.md) for vulnerability reporting. Dependabot alerts
and secret scanning are enabled where supported.

## License
Licensed under the [MIT License](LICENSE).
