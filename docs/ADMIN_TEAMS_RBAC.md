# Admin Teams, Levels & Access (RBAC)

How access to the COCARR admin panel is organised, and how the Super Admin
manages it. Everything here is **data-driven** — teams, levels and the module
grids live in the database and are edited from **Settings › Teams & Access**, not
in code.

---

## Concepts

| Term | What it is |
|---|---|
| **Team** | A department a member belongs to (Super Admin, Admin, Customer Support, Operations, Finance, Marketing, Developer, plus any the Super Admin adds). Defines *which modules* are in scope. |
| **Level** | A rank within a team (Manager / Specialist / Agent by default). Members of the same team can hold different levels. Defines *how much* they can do. |
| **Member** | An admin account, assigned one **team** + one **level**. |
| **Module** | A top-level area of the panel (18 of them). Access is granted per module. |
| **Feature** | A screen/capability inside a module. Every feature inherits the level's access on its module. |
| **Action** | Create / Read / Update / Delete (C/R/U/D), set per module per level. |

A member's access = the **grid of their (team, level)**. The Super Admin edits
those grids; the enforcement middleware reads them on every request.

---

## The seven built-in teams

`FULL` = CRUD · `R+U` = read + update · `R` = read · `—` = none. This is the
**Manager** level of each team (Specialist = Manager minus delete, Agent =
read-only — all editable afterwards).

| Module | Super | Admin | Support | Operations | Finance | Marketing | Developer |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Dashboard | FULL | R | R | R | R | R | R |
| Users | FULL | FULL | R+U | FULL | R | R | — |
| Hosts | FULL | FULL | R | FULL | R | — | — |
| Vehicles | FULL | FULL | R | FULL | R | — | — |
| Bookings | FULL | FULL | R+U | FULL | R | — | — |
| Payments | FULL | R | R | R | FULL | — | — |
| Payouts | FULL | R | — | R | FULL | — | — |
| Support Center | FULL | FULL | FULL | FULL | R | — | — |
| Content Mgmt | FULL | FULL | R | R | — | FULL | — |
| Marketing | FULL | FULL | — | R | R | FULL | — |
| Reports | FULL | R | R | R | FULL | R | R |
| Audit Logs | FULL | R | — | R | R | — | R |
| Settings | FULL | R+U | — | — | — | — | R |
| Admin Accounts | FULL | — | — | — | — | — | — |
| Roles & Permissions | FULL | — | — | — | — | — | — |
| Security | FULL | — | — | — | — | — | FULL |
| System Health | FULL | R | — | — | — | — | FULL |
| Integrations | FULL | R | — | — | — | — | FULL |

Built-in teams can be **edited** (grids, levels, description) but **not deleted**.

---

## Modules and their features

| Module (`key`) | Features |
|---|---|
| Dashboard (`dashboard`) | Overview KPIs & charts, review-queue shortcuts, system alerts, live activity |
| Users (`users`) | Customer list & detail, KYC & documents, verification queue, wallet & bookings, suspend/reactivate |
| Hosts (`hosts`) | Host list & detail, host vehicles, host payments, host bank accounts |
| Vehicles (`vehicles`) | Fleet list & detail, approvals queue, RC details, pricing & plans, availability schedules |
| Bookings (`bookings`) | Rides list & detail, cancellations, disputes, damage claims |
| Payments (`payments`) | Transactions, refund requests, dues, wallet transactions |
| Payouts (`payouts`) | Weekly settlements, payout ledger, invoices, retry failed payouts |
| Support Center (`support`) | Tickets & threads, knowledge base / FAQs, escalation |
| Content Management (`cms`) | Banners, FAQs, blogs, CMS & legal pages |
| Marketing (`marketing`) | Offers & coupons, membership types, email/SMS campaigns, push campaigns, notifications |
| Reports & Analytics (`reports`) | Customer / operational / driver reports, custom report builder, exports |
| Audit Logs (`auditLogs`) | Admin activity log, entity change history |
| Settings (`settings`) | Cities & pickup points, brands, protection plans, membership types, fees & tax, preferences, general |
| Admin Accounts (`adminAccounts`) | Create / edit / deactivate admins, assign team & level, reset-password link |
| Roles & Permissions (`roles`) | Permission matrix, per-team module access (**this is what gates Teams & Access itself**) |
| Security (`security`) | API keys, IP whitelist, login history, sessions / MFA |
| System Health (`systemHealth`) | Background jobs, queues, webhook logs, error / system logs |
| Integrations (`integrations`) | Payment gateway, Firebase, Maps, Email (SendGrid), SMS (MSG91), storage |

The catalog lives in `src/utils/adminPermissions.js` (`ADMIN_MODULE_LIST`).

---

## Levels

Every team is seeded with three levels; the Super Admin can rename, delete or add
more per team.

| Level | Default grant (relative to the team's Manager grid) |
|---|---|
| **Manager** | Full — the team's matrix above. The **default** level for new members. |
| **Specialist** | Manager minus **delete**. |
| **Agent** | Read-only (read where Manager could read; no create/update/delete). |

(Super Admin has a single **Administrator** level = full access.)

Levels are just named grids — once seeded, each is edited independently, so
"Agent" can be given whatever access you like.

---

## Data model

| Table | Holds |
|---|---|
| `adminTeams` | `{id, key, name, description, isSystem, isActive, legacyRole}` |
| `adminTeamLevels` | `{id, teamId, key, name, rank, isDefault}` |
| `adminTeamPermissions` | `{id, teamId, levelId, module, canCreate, canRead, canUpdate, canDelete}` — one row per (team, level, module) |
| `admins` | gains `teamId` + `teamLevelId` (the legacy `role` integer is kept) |

Deliberately **no foreign-key associations** are declared (INTEGER PKs referenced
by plain INTEGER columns) — this repo has a history of `db.sync({alter:true})`
aborting on FK type mismatches, so lookups are stitched in the service instead.

Code: `src/models/adminTeam*.js`, `src/services/adminTeamService.js`.

---

## Enforcement

`requirePermission(module, action)` (`src/middlewares/permissionMiddleware.js`)
runs on every `/admin` route. For a request it resolves, in order:

1. **Bootstrap super admin** (`BOOTSTRAP_SUPER_ADMIN_EMAIL`) → always allowed (break-glass).
2. **Super Admin** role/team → full access.
3. The member's **(team, level, module)** row → its C/R/U/D.
4. **No team yet** (not migrated) → falls back to the legacy role matrix (`DEFAULT_PERMISSIONS`).

Enforcement is **on by default**. Set `RBAC_ENFORCE=false` to fall back to
dry-run (denials logged, requests allowed) while tuning grids.

---

## What the Super Admin can do (Settings › Teams & Access)

- **Add a team** — name + description, optionally *copy access from* an existing
  team. It comes seeded with Manager/Specialist/Agent levels.
- **Edit / delete a team** — built-in teams can't be deleted; a team with members
  can't be deleted until they're moved.
- **Manage levels** — add, rename, delete, set the default. A team keeps ≥1 level;
  a level with members can't be deleted.
- **Edit the grid** — per level, toggle Create/Read/Update/Delete per module, with
  per-row Full/None and "set all" Full / Read-only / None shortcuts. Save.
- **Assign members** — Admin Accounts › add/edit an admin picks a **Team** and a
  **Level** (the level list follows the team; the team's default is pre-selected).

### API (all gated on the `roles` module → Super Admin by default)

```
GET    /admin/teams                                   list teams (+ levels, member counts)
GET    /admin/teams/modules                           module + feature catalog
POST   /admin/teams                                   { name, description, copyFromTeamId? }
GET    /admin/teams/:id                               team + levels + full grid
PUT    /admin/teams/:id                               { name?, description?, isActive? }
DELETE /admin/teams/:id                               (blocked for built-in / with members)
POST   /admin/teams/:id/levels                        { name }
PUT    /admin/teams/:id/levels/:levelId               { name?, isDefault? }
DELETE /admin/teams/:id/levels/:levelId               (blocked for last level / with members)
PUT    /admin/teams/:id/levels/:levelId/permissions   { permissions: { module: {create,read,update,delete} } }
```

Admin create/edit (`POST/PUT /admin[/:id]`) accept `teamId` + `teamLevelId`.

---

## Migration from the legacy roles

Existing admins have a `role` integer, not a team. On boot, **`seedAdminTeams()`**:

1. Seeds/updates the seven built-in teams and their levels + grids
   (idempotent — never overwrites a Super Admin's grid edits).
2. **Migrates** every admin with no `teamId` onto the team matching their legacy
   role, at that team's default level:

   | Legacy role | → Team |
   |---|---|
   | Super Admin (2) | Super Admin |
   | Platform Admin (1) | Admin |
   | Support Executive (3) | Customer Support |
   | Operations Manager (5) | Operations |
   | Finance Manager (4) | Finance |
   | Marketing Manager (8) | Marketing |
   | Developer/DevOps (10) | Developer |
   | KYC (6), Fleet (7) | Operations |
   | Analytics (9) | Admin |

Because each team's **Manager** grid equals the old role's matrix, migrated
admins keep the same access. The legacy `role` column stays for back-compat.

---

## How to…

- **Add a team:** Teams & Access → *Add team* → optionally copy from another →
  edit its level grids → assign members in Admin Accounts.
- **Give a level more/less access:** open the team → pick the level → toggle the
  grid → Save.
- **Create a new rank (e.g. "Team Lead"):** open the team → *+ Level* → edit its
  grid.
- **Move someone between teams/levels:** Admin Accounts → Edit → change Team/Level.
- **Debug a lockout:** set `RBAC_ENFORCE=false` (dry-run) and watch the
  `[rbac:dry-run]` logs; the bootstrap super admin is never locked out.
