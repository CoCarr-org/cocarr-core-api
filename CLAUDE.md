# COCARR-BACKEND

Node/Express API for COCARR (car-sharing platform). Sequelize ORM (MySQL, not Postgres — `dialect: 'mysql'` in `src/configs/db.js`), Firebase Auth verification, Razorpay payments, Cashfree Aadhaar e-KYC.

**Working branch: `railway-dev`** — code changes are made and committed here, not `main`. Deploys to Railway from this branch. `main` is kept only as a baseline. (Same convention applies to COCARR-ADMIN.)

## Structure
- `index.js` — entry point; mounts `src/routes/rootRouter.js` at `/v1`
- `src/routes/rootRouter.js` — mounts all sub-routers (`/image`, `/user`, `/booking`, `/host`, `/vehicle`, `/admin`, `/settings`, etc.)
- `src/controllers/`, `src/services/`, `src/models/` — standard layering

## Images — private bucket
`src/routes/imageRouter.js` (mounted at `/image`, so full path `/v1/image/:key`) streams objects from a **private** S3-compatible bucket (Tigris/storageapi.dev) using server credentials — the bucket itself is not public. Every client (web, mobile, admin) must link images through this proxy (`${API_URL}/image/:key}`), never the raw bucket URL directly, or they 403. `imageController.getSignedUrl` (`GET /image/url`) issues presigned-POST upload credentials; the returned `fields.key` is the bare UUID to use with the proxy afterward — **not** `url + key` concatenated (a bug that recurred across multiple frontend upload screens).

`src/utils/publicUrl.js` (`toPublicUrl`) does this same rewrite **server-side** — `User.profilePhoto` has a Sequelize getter that runs every stored value through it before the API even responds, so that field always comes back proxy-safe regardless of client. Not all models have this getter (vehicle images, ride photos don't) — those still rely on each client applying its own `photoUrl()`.

**Gotcha**: `toPublicUrl` builds the URL against `PUBLIC_API_URL` (env var, defaults to `https://api.cocarr.com/v1`) — but each client's own `photoUrl()` fallback default is *different* (mobile also defaults to `api.cocarr.com`, web defaults to `cocarr-web-production.up.railway.app`, admin defaults to `localhost`). If a client's configured base URL doesn't match `PUBLIC_API_URL`, a value that already went through this server-side getter would 404/fail to load unless the client's `photoUrl()` rewrites it again against its *own* base — all three clients' `photoUrl()` now do this (extract the key from any `/image/` path regardless of host, not just from the bucket or their own exact base URL) specifically to defend against this mismatch.

## Two separate Firebase projects
- **User/frontend project** — consumer end-users (riders/hosts), via `src/helper/userAuth.js` (`USER_SERVICE_ACCOUNT` env var). Used by web + mobile app auth.
- **Admin project** — admin-panel staff accounts, via `src/helper/adminAuth.js` (`ADMIN_SERVICE_ACCOUNT` env var). Used by COCARR-ADMIN auth. These are genuinely different Firebase projects with different service accounts — don't assume a uid from one means anything in the other.

**There is no bulk Firebase→DB sync any more.** Rows are created by the flow that creates the account: `userService.verifyOtp` inserts the `users` row on first successful OTP, and `adminService.createAdmin` inserts the `admins` row alongside the Firebase user. Nothing pulls `listUsers()` at boot, on a timer, or from the panel — `userSyncService`/`adminSyncService`, their CLI wrappers, the `POST /admin/sync-users` and `POST /admin/sync-admins` endpoints and the panel's "Refresh from Firebase" buttons were all removed.

The one thing that still runs at boot is `bootstrapAdminService.ensureBootstrapSuperAdmin()`, which touches exactly one row — `BOOTSTRAP_SUPER_ADMIN_EMAIL` — and is what keeps the panel administrable. It is not a backfill.

`authenticateAdmin` (in `authMiddleware.js`) checks the Firebase token AND looks up the `admins` row by uid — if a row exists and `isActive === false`, the request is rejected (403). If no row exists at all, the request proceeds (avoids locking out the bootstrap account on an empty table). The found row (or `null`) is attached to `req.admin` for any route to use — currently only for activity-log attribution ("who did this"), not authorization.

`role` (`src/utils/adminRoles.js`: `ADMIN_ROLES` = Admin(1, default)/Super Admin(2)/Support(3)/Accountant(4)) now has named semantics, but **still isn't read anywhere for authorization** — any authenticated, active admin can call any admin endpoint regardless of role. The names exist for the UI and for future permission-gating, not as an enforced hierarchy yet.

## Admin panel binding — root. / admin. / per-module, top-down
`src/utils/adminPanels.js` — which admin site a request came from, and whether the caller's team may use it. Mirrors `_helpers/panels.js` in COCARR-ADMIN; that copy decides what to *render*, this one is the enforcement.

| Host | Tier | Who |
|---|---|---|
| `root.cocarr.com` | 0 | `super-admin` only. Every module, every permission |
| `admin.cocarr.com` | 1 | every other team, one combined login |
| `ops.` `support.` `finance.` `growth.` `developer.` | 2 | one team each — declared, dormant until given an origin |

**Tier numbers ARE the hierarchy, and lower is more privileged** (like a uid, where 0 is root). They are only compared, never displayed, so the gaps are free — a tier can be inserted later without renumbering.

**Access is top-down and never upward.** Each team has a HOME panel; it may use that panel and anything *below* it, nothing above. Super admin therefore reaches `admin.` and every module panel; an Operations admin cut over to `ops.` can no longer open `admin.`, because admin is now above them. The upward denial is evaluated **first and alone** in `check()` — no later branch can reach past it.

**Sibling panels are closed too**, and that is a different question: Finance cannot open `ops.` even though both are tier 2. Otherwise the whole Operations menu renders and every call behind it 403s, which reads as a broken panel rather than a refusal. Root is the exception — it reaches panels that do not list it, because that is what root means.

**`resolveAccess` is what makes root "all permissions"**, not this file: `team.key === 'super-admin'` already returns a full grid unconditionally, ignoring the stored grid. Panel binding only decides which *site* you may use.

**And because those rows are never read, `setLevelPermissions` now REFUSES to write them** (400, naming the reason). The editor previously accepted changes to super admin's grid, saved them and showed them back, and they did nothing — so an admin tightening super admin's access would have believed they had. Storing a permission that is never consulted is worse than refusing it: it looks like a configuration that holds, and the only way to discover it does not is to rely on it. It also keeps root's authority uneditable from inside root — honouring the grid would let a Super Admin revoke their own team and lock every super admin out, recoverable only through the bootstrap break-glass.

### The two-step cutover — the order is load-bearing
1. **Deploy the host**: `ADMIN_PANEL_ORIGINS=…,ops=https://ops.cocarr.com`. Operations can now use **both** `admin.` and `ops.`, because their home is still `admin` and tier 1 reaches down. Nothing is taken away, so a broken build is not an outage.
2. **Move their home**: `ADMIN_PANEL_HOMES=operations=ops`. `admin.` closes for them. One env var, so undoing a bad cutover is one env var too.

**Step 2 without step 1 locks out an entire team** — a home they cannot reach plus an admin panel that now refuses them, produced by one variable and no error anywhere. `HOME_OVERRIDES` therefore **refuses** a home whose panel has no origin/key configured, and refuses one whose panel does not list that team, logging why in both cases. `ADMIN_PANEL_HOMES` is keyed by TEAM (`operations=ops`, not `ops=operations`) so a team with two homes is unrepresentable rather than something to validate.

### Configuration
**OFF until configured**, deliberately — most panel hosts do not exist yet, and a default-on check would reject every request from the single admin panel running today:
```
ADMIN_PANEL_ORIGINS=root=https://root.cocarr.com,admin=https://admin.cocarr.com
ADMIN_PANEL_KEYS=root=<secret>,admin=<secret>        # optional, stronger
ADMIN_PANEL_HOMES=operations=ops                     # the cutover switch
```
With ORIGINS alone the panel is inferred from `Origin` — enough to stop someone opening the root URL and signing in, useless against curl. The admin panel now actually **sends** a key (`x-cocarr-panel-key`), which it never did before, so KEYS was previously documented but inert. **A key that does not match is a hard deny, never a fall-through to the Origin check** — otherwise sending a key would be strictly worse than sending none.

**How much a key is worth depends on where the panel keeps it.** Sent from the browser (`NEXT_PUBLIC_PANEL_KEY`) it is inlined into the client bundle, so it is readable by anyone who opens the site and replayable by curl — a speed bump, not a boundary. The admin app can instead route through its own server-side gateway (`NEXT_PUBLIC_PANEL_GATEWAY=true` + a server-only `PANEL_KEY`), where the browser never holds the value and a request bearing a valid root key must have passed through the root deployment. Nothing changes on this side either way; it is worth knowing which mode a deployment is in before trusting the key.

`console` and `portal` are accepted as **aliases** for `root` and `admin`, so an environment carrying the old names keeps working through the deploy rather than failing closed.

**Checked per REQUEST, never at sign-in.** Every panel shares one Firebase project and one API, so a token minted at `admin.` is a valid token at `root.` — there is nothing panel-specific about the credential, and a sign-in check would be checked once then bypassed for the session. The login screen *also* calls `/admin/me` and signs a wrong-panel account straight back out (403 carries `code: 'panel_denied'` so it can tell that from every other 403) — but that is for the person, so they are told at the password box instead of after landing. It is not what holds.

**A SECOND control, not the first.** The permission grid still refuses a support agent anything useful even if they reach the root API; this stops them using the root UI at all. Requests with no `Origin` (curl, mobile, server-to-server) are allowed — browsers always send it cross-origin, so its absence is not a signal. Do not mistake this for the access control.

The bootstrap break-glass bypasses it, or a wrong panel config could lock everyone out.

### CORS
`CORS_ORIGINS` is a comma-separated allowlist; unset means allow everything **with a loud startup warning** (which is what it did before, so merging cannot break a deploy). Two things before setting it:
1. **This API fronts the rider web app too.** An allowlist of admin origins alone breaks the customer site — list every browser origin.
2. **CORS is a browser control.** It does nothing about curl or a native app. Worth setting; not the boundary that holds.

## Sub-module permissions — per SCREEN, not just per module
> **If you see `Unknown column 'submodule'`**, the database has not had the column added:
> ```
> node scripts/addSubmodulePermissionColumn.js --dry-run
> node scripts/addSubmodulePermissionColumn.js --confirm
> ```
> `db.sync({alter:true})` does **not** reliably apply this, because it also *replaces* a unique index — `(teamId, levelId, module)` becomes `(teamId, levelId, module, submodule)`. Sequelize adds the new index while the old one still exists, which on MySQL fails or silently duplicates, and **a failed index change aborts the whole sync pass**, leaving every model after it un-migrated. The script drops the superseded index only *after* the replacement exists, matches indexes by their columns rather than by name (Sequelize auto-names them, differently per environment), and is safe to re-run.
>
> The old 3-column key does not merely become redundant — it **blocks** the feature: a module row and its per-screen overrides share the same first three columns.
>
> **The code degrades rather than dying.** A missing column makes reads fall back to module-only permissions with one loud log line, and override writes return 503 naming the script — instead of `Unknown column` taking out `/admin/me` and therefore the entire panel, since every page waits on it.

`adminTeamPermission.submodule` (nullable). NULL is the module-level grid; a non-null row overrides one screen inside it.

**The key is the nav route** (`/dashboard/users/verification`). It is already unique, already stable, and already what navConfig uses — a parallel slug vocabulary would be two lists to keep in step, and they would drift. No migration: every existing row is already `submodule: NULL`, so a team with no overrides behaves exactly as before.

**An override WINS outright; it is not intersected with the module.** That is deliberate and is the main thing people want this for: granting a single screen inside a module the team otherwise cannot read. An intersection could only ever subtract. Verified both directions — an override can hide `/dashboard/bookings/damages` from a team that can read `bookings`, *and* grant `/dashboard/finance/refunds` to a team denied `payments`.

**`undefined` vs `{}` on save is load-bearing.** `setLevelPermissions(…, submodules)` treats `undefined` as "this client didn't send any" (leave overrides alone) and `{}` as "there are none" (delete them). Conflating them would make any client predating this feature wipe every override just by saving a module grid.

**Enforcement is opt-in per route.** `requirePermission(module, action, submodule)` takes an optional third argument. Routes are **not** being converted wholesale — one endpoint usually serves several screens, so each mapping is a judgement call and a bad guess silently narrows access. **Until a route opts in, sub-module permissions gate the UI only.** That is a real improvement to what each team *sees*, but it is not by itself access control.

## Access resolution — `resolveAccess` is the one answer, and it is TOTAL
`adminTeamService.resolveAccess(admin)` returns `{source, team, level, permissions}` and **never null**. `requirePermission`, `GET /admin/me` and (soon) the panel's nav filter all read it, so enforcement and UI cannot disagree.

`source` is explicit, and this is the point:

| source | meaning |
|---|---|
| `bootstrap` | break-glass account — always everything |
| `team` | resolved from team + level. **An all-false grid is a DENY**, returned as one |
| `legacy` | **only** when the admin row exists and `teamId` is null (boot migration hasn't reached them) |
| `none` | explicit deny: no admin row, inactive/deleted team, team with no levels |

**Why it replaced `resolvePermission`.** That returned `null` on five paths and the middleware treated all of them as "fall back to the legacy role matrix". Only one was legitimately that. The others were denials converted into grants — so **deactivating a team did not remove its members' access**, it quietly reverted them to their old `role` permissions. The one control a Super Admin would reach for to cut off a team did almost nothing. `resolvePermission` survives as a per-module shim over `resolveAccess` for the middleware's existing call shape.

**The legacy `role` column no longer outranks the team.** There was a `role === SUPER_ADMIN` short-circuit *before* any team lookup, and `migrateAdminsToTeams` maps `role → teamId` without ever clearing `role` — so moving a super admin onto Operations left them with full access, invisible in the Teams & Access UI because that screen edits teams, not that column. Super admin is now recognised by `team.key === 'super-admin'`. **Nothing should branch on `admins.role` again**; `/admin/me` returns it for display only.

**Three fail-open paths are now closed:**
- No `admins` row → **deny** (was: allow). Written for a Firebase→DB sync that no longer exists; a Firebase login with no row is a mistake, not a transitional state. The bootstrap break-glass is what makes this safe.
- Permission-lookup error → **503** (was: allow). "The check broke" is not a reason to perform an unchecked write.
- Both still allow under `RBAC_ENFORCE=false`, so dry-run remains a way to debug a lockout.

**`scripts/checkAccessMigration.js`** is the read-only pre-flight: role-2 admins not on the super-admin team (they lose access), admins with no team, admins on inactive teams, teams with no levels. Run it before deploying. It does **not** check for orphaned Firebase users — that needs the Firebase admin SDK and is a separate step before the no-row denial ships.

## RBAC — built to the Access Matrix spec, enforcement is OPT-IN
Source of truth: `Admin_Panel_Access_Matrix_and_Module_Specification.docx` in the repo root.

- `src/utils/adminRoles.js` — the spec's **10 roles**. **Integers 1-4 deliberately keep their pre-spec meanings** (1 was "Admin"→Platform Administrator, 2 Super Admin, 3 Support→Support Executive, 4 Accountant→Finance Manager) so existing `admins.role` values weren't silently re-roled; new roles are appended from 5. `ADMIN_ROLE_ORDER` is the spec's *display* order, which is NOT the stored order — use it for UI, never assume the integers are ordered by privilege.
- `src/utils/adminPermissions.js` — the spec's **18 modules** and the seeded `DEFAULT_PERMISSIONS` matrix. Modules carry `built: false` where the spec asks for something with **no backend at all** (support, cms, reports, security, systemHealth, integrations) — permissions are assignable for them but there's nothing behind them.
- `DEFAULT_PERMISSIONS` for Super/Platform/Ops/Support/Finance is transcribed from the spec table. The other five roles are marked **DERIVED** in-file — my reading of each role's one-line description, not something the spec states. Worth a review before trusting them.
- `rolePermission` rows are only written when a cell **deviates** from the default; a missing row means "use the seeded default", not "no access".

**`requirePermission(module, action)` (`src/middlewares/permissionMiddleware.js`) is applied to every `/admin` route and ENFORCES BY DEFAULT.** The flag is `RBAC_ENFORCE !== 'false'` — enforcement is on unless you explicitly set `RBAC_ENFORCE=false`, which falls back to dry-run (denials logged as `[rbac:dry-run]`, requests allowed) so a lockout can be debugged without redeploying.

What makes enforce-by-default safe is the **break-glass exception**: the bootstrap super admin (`BOOTSTRAP_SUPER_ADMIN_EMAIL`, default `cocarrluxury23@gmail.com`) is never denied, even if someone edits Super Administrator's permissions to nothing. `bootstrapAdminService` guarantees that account exists and holds role 2 on every boot, so the panel can never become permanently unadministrable.

**Still worth knowing before trusting it:** the spec gives Platform Administrator (stored role 1 — what every pre-existing admin has) no access to Admin Accounts or Roles & Permissions. Those admins are locked out of those screens right now unless they were re-roled. `scripts/setExistingAdminsReadOnly.js --dry-run` shows the blast radius.

## The spec's previously-missing modules (all now have backends)
Built to satisfy the Access Matrix spec's module list. 11 new models, all created by `db.sync({alter:true})` on boot — no migration step.

- `src/services/crudFactory.js` — `createCrudService({model, entityType, searchable, allowed})` gives list/get/create/update/remove with search, pagination and activity logging. **`allowed` is a whitelist** — anything else in a request body is dropped, so a client can't set `id`/timestamps. Use this for any new plain-CRUD module rather than hand-rolling it.
- `src/services/adminModulesService.js` — the modules themselves. Plain CRUD ones are one line each; Tickets, API Keys, Reports, System Health and Integrations are bespoke.
- `src/routes/adminModulesRouter.js` — 41 routes, **mounted at `/admin` BEFORE `adminRouter`** in rootRouter.js. That order is load-bearing: adminRouter ends with catch-all `/:id` handlers that would otherwise swallow `/admin/tickets`, `/admin/banners`, etc.

Models: `ticket`, `ticketMessage`, `banner`, `faq`, `page` (CMS **and** legal pages, split by `type`), `featureFlag`, `apiKey`, `ipWhitelist`, `loginHistory`, `webhookLog`, `messageTemplate`.

**Built ≠ wired end-to-end.** These have working admin CRUD, but several store data nothing downstream consumes yet — worth knowing before assuming a toggle does something:
- **Feature flags** — no client reads them.
- **Message templates** — the email/push subscribers still send hardcoded content.
- **API keys** — hashed and revocable, but no request path authenticates with them.
- **IP whitelist** — stored, but no middleware enforces it.
- **Login history / webhook logs** — tables exist and are readable, but nothing writes to them yet (auth middleware and webhook handlers would need to record).
- **Legal pages** — the rider/host apps still link to externally-hosted copies.

`getIntegrations()` reports whether each integration's env vars are set, **never their values**. Note the real names are unintuitive: Razorpay is `PG_KEY`/`PG_SEC` (not `RAZORPAY_*`), and storage accepts four aliases — check `helper/payment.js` and `services/imageService.js` before adding to that list.

## Legacy note — the earlier none/read/write matrix
`src/models/rolePermission.js` (one row per `(role, module)` pair, unique index on that pair, `access` is `'none'|'read'|'write'`) + `src/services/permissionService.js` (`getPermissionMatrix`, `updatePermissionMatrix`) + `GET`/`PUT /admin/permissions`. `src/utils/adminPermissions.js` defines the fixed module list (`ADMIN_MODULES`, one entry per top-level admin-panel sidebar section: Dashboard/Rides/Vehicles/Payments/Hosts/Offers/Users/Configurations/Settings) and `ACCESS_LEVELS`. A missing row for a given `(role, module)` pair means `'none'` — rows are only written when a cell is actually edited via the admin UI's Roles & Permissions matrix (Settings > Administration), not pre-seeded for every combination. Route order matters here: `GET/PUT /admin/permissions` must be registered **before** `PUT /admin/:id` in `adminRouter.js`, or Express would match `/permissions` as `:id`.

**This matrix is purely descriptive today — nothing in the codebase checks it before allowing a request.** It records intended access; actually gating requests on it (e.g. a middleware that looks up `req.admin.role` + the target module + method, and rejects if the stored access is `'none'` or `'read'` on a write) is real, not-yet-done work.

## Admin user management (full CRUD)
`adminService.js`: `createAdmin`, `updateAdminAccess` (despite the name, edits name/email/mobile/role/isActive — not just access), `deleteAdmin`. Two things worth knowing if you touch these:
- **name/email/mobile edits are pushed to the Firebase admin-project user too** (`adminAuth.updateUser`), not just the DB row — Firebase is where the admin actually signs in, so a DB-only edit would leave them signing in against stale details.
- **`deleteAdmin` deletes the Firebase user too** (`adminAuth.deleteUser`), not just the `admins` row — leaving the Firebase account alive would let a "deleted" admin keep signing in. Self-delete is blocked (`id === actingAdmin.id` → 400).
- **New admins have no way to sign in without a manual step**: `createAdmin` creates the Firebase user with a random unknown password (no forgot-password page exists in the admin app to let them set one), so it also calls `adminAuth.generatePasswordResetLink(email)` and returns it in the response (`resetLink`) — whoever creates the account has to hand that link to the new admin themselves. Building a real forgot-password flow would remove the need for this.

## Activity logging
`src/models/activityLog.js` + `src/services/activityLogService.js` (`logActivity`, `getActivityLogs`) — a generic `{adminId, adminName, action, entityType, entityId, changes}` log, `changes` is JSON (`{field: {from, to}}` for updates, `{created: {...}}`/`{deleted: {...}}` for create/delete). `adminName` is denormalized at write time so a log entry still reads sensibly after that admin is later edited/deleted. `logActivity` never throws — a failed log write must not break the operation it's attached to.

**Only Admin create/update/delete call `logActivity` today** (`GET /admin/activity-logs`, consumed by the admin UI's Activity Logs views). Extending this to other admin-mutating endpoints (vehicles, bookings, offers, cities, brands, commissions, etc.) is straightforward — call `logActivity({adminId: req.admin?.id, adminName: req.admin?.name, action, entityType, entityId, changes})` from each — but hasn't been done; the Audit section's "Activity Logs" will show whatever's logged, which today is Admin-entity actions only.

## Payment signatures — verified in ONE place
`src/utils/paymentSignature.js` (`assertPaymentSignature`). Every Razorpay confirmation path goes through it: booking, extension, reschedule, membership, dues.

**It was not verified at all.** All five sites computed `isValid` and then threw the answer away — the `if(!isValid) throw` line was commented out in each. Any authenticated caller who knew an `orderId` could post any signature and have the transaction marked `TRANSACTION_AUTHORIZED` and the booking confirmed, **without a successful payment**.

**Why it had been commented out** is the interesting half: `PG_HIDDEN` in `configs/constants.js` was the literal string `"test123"`, not the Razorpay key secret. Verifying a real signature against that fails for *every* legitimate payment — so someone hit that, commented out the throw, and the placeholder stayed. Fixing one without the other would have looked like a regression. The constant is deleted; **never reintroduce a literal secret** — a fake one is worse than none, because it makes the check look wired up.

The secret is **`PG_SEC`**, the same one `helper/payment.js` builds the Razorpay instance with. It has to be: Razorpay signs `order_id|payment_id` with the secret belonging to the key that created the order.

**With `PG_SEC` unset it logs loudly and allows** rather than throwing. A signature cannot be checked without the secret, and refusing every payment would turn a config gap into a total outage of the booking flow. So configured environments become secure immediately; unconfigured ones behave exactly as before but say so on every call.

`middlewares/paymentMiddleware.js` was **deleted** — an abandoned half-edit of `webookMiddleware.js` that had a syntax error since the initial commit (so it could never even be `require`d), plus an undefined `webhookSignature` and an undefined `PG_HIDDEN`. Nothing imported it. `webookMiddleware.js` (note the typo in the filename) is the real, working one, wired to `POST /hook`; its `process.env.PG_HIDDEN` is the separate **webhook** secret and is left alone.

## Booking lifecycle
Model default status is `initiated` (`BOOKING_INITIATED`) — set implicitly by the Sequelize model default when `initiateBooking` creates the row. `confirmBooking` (called client-side right after Razorpay checkout succeeds, or via the `order.paid` webhook as a fallback) transitions it to `booked`.

If `confirmBooking` fails after payment capture (network drop, backgrounded app) and the webhook is delayed/misconfigured, a booking can be stuck at `initiated` indefinitely — this is a real state, not just a transient one, and every client-side "upcoming rides" view needs to handle it alongside `booked`.

## Ride handshake OTPs — two-phase, and the phases matter
`src/services/rideOtpService.js` is the ONLY place these are issued or checked. **These are not the Firebase/MSG91 auth OTPs** — nothing is sent by SMS or email. They are generated by us, stored on the booking row, and displayed **only on the host's screen**. The host reads the code aloud; the **rider types it into their own app**. Entry must never happen on the same device that displays it, or the code proves nothing.

Issue timing is load-bearing:
- **start OTP** — issued by `confirmBooking`.
- **end OTP** — issued when the ride actually starts, *not* at confirmation. Issuing both up front (which is what the code used to do) means the end code is visible for the entire booking, so it could be handed over at pickup and the end-of-ride check would prove nothing.

**Starting and ending a ride is two-phase:**
1. **Host captures** (`POST /host/bookings/start|end/:id`) — records odometer, fuel and photos, stamps `booking.startCapturedAt` / `endCapturedAt`. **Does not change status** and requires no OTP.
2. **Rider confirms** (`POST /booking/start-ride|end-ride/:id`) — verifies the OTP and *only then* moves `booked → ongoing → finished`.

When `startCapturedAt`/`endCapturedAt` is already set, the rider's request doesn't have to resend kms/fuel/images — it's just the handshake. Fields are only overwritten when actually supplied, so the rider's call can't blank out what the host captured.

Wallet points are awarded in `bookingService.startRide` only. `hostService.startBooking` used to award them too; with the split that would have double-credited.

**This was a real hole, not a theoretical one:** `hostService.startBooking`/`endBooking` — the endpoints the host app actually calls — previously performed **no OTP check whatsoever**, and `endBooking` had no status guard either, so a booking that was never started (or already finished) could be "ended". Both are fixed.

`startFuel`/`endFuel` were commented out in `bookingService`, so fuel captured by both apps was silently discarded while the host path saved it. Now persisted on both paths.

## Known bugs / gotchas found so far
- `userController.updateLicenseInfo` was calling `UserService.updateKycInfo` instead of `UserService.updateLicenseInfo` (copy-paste bug) — **fixed**. `updateKycInfo` requires `user.kycNumber`/`kycRef` to already be set; `updateLicenseInfo` does not.
- `GET /user/kyc-info` is a no-op stub (`()=>console.log('runnigng')`) — never call it, it hangs.
- `utilityService.validatePlace`/`validatePlaceByLatLong` — `isPlaceValid` is true if the point falls within the *current* city's radius OR any *other* city's radius (in which case `isCityChanged` is also true and the *other* city is returned as `city`). Only false when no city's radius contains the point at all.
- `City` model has no `radius` column in some environments — code defaults to 20km via destructuring default, not a bug, just worth knowing.
- Repo has committed Google service-account keys (`src/configs/admin-service-account.json`, `user-service-account.json`) pushed with GitHub push-protection bypassed — treat as compromised if repo is ever made public; recommend rotation.

## Referrals, wallet credits, and tracing them
`src/services/referralService.js` + `src/services/walletAdminService.js`.

### `users.name` is NULL for almost everyone — use `displayName()`
`src/utils/userDisplayName.js` is the one resolver: `firstName + lastName` → `name` → `email` → `contactNumber`. **`users.name` is only populated for accounts that arrived with a Firebase displayName.** The OTP signup flow creates a row holding nothing but a phone number, and the onboarding wizard then writes `firstName`/`lastName` and never touches `name`. Every screen reaching for `user.name` therefore invented its own fallback — "Unknown", "Friend", "No name" — which is exactly why referred users rendered as unknown in the admin panel: the name was there the whole time, in the columns nobody was selecting. `DISPLAY_NAME_ATTRIBUTES` exists so a query cannot select too few columns and silently fall through to the phone number.

### Referral points are released on ACTIVATION, and nowhere else
`releaseReferralOnActivation()` in `userVerificationService` is the single place a referral reward is paid. Nothing credits at signup — `recordPendingReferral` writes the referral row and touches no wallet.

**`approve()` is its only caller. Reactivation deliberately does not pay.** Only an ACTIVE account can be suspended (enforced in `setSuspension`), so anyone being reactivated was approved once already and has been paid — crediting again would double-pay, or at best lean on an idempotency flag to do nothing. Reactivation restores access; it is not a second approval.

**Only `active` accounts can be suspended.** Suspension withdraws access that approval granted, so there must be something to withdraw. Suspending a `pending`/`incomplete` profile took away access it never had and — because reactivation returns a profile straight to `active` with no re-review — handed it back as access it had never earned. **Suspend-then-reactivate was a way to approve somebody without approving them.** To block a pending or rejected account, reject it with a reason. The admin UI already only offered Suspend on active profiles; this closes the server-side gap.

`releaseReferralOnActivation` stays a named function so the invariant can be pointed at. If a third route to `active` appears, ask whether it is an APPROVAL — if so call it; if it merely restores access to an already-approved profile, do not. Idempotent regardless, and best-effort: a referral hiccup must never block an approval.

**Legacy data**: rows suspended from a non-active state before this guard existed will still reactivate to `active` without ever having been approved. The guard stops new ones; existing ones need a one-off check if any exist.

The first-booking stage (`handleFirstBooking`) is separately guarded on `signupRewarded`, so it can never fire ahead of activation either.

### Referral status: pending until the money actually moves
`pending` (recorded at signup, nothing credited) → `completed` (the wallet transactions exist) → or `cancelled`/`fraud`. **The status flip happens inside the same DB transaction that writes the wallet rows**, so it can never claim a credit that rolled back nor miss one that committed. `completedAt` is written at the same moment, which makes it proof rather than intent.

`rewardStatus` (`pending|partial|credited`) is the finer-grained view for the two-stage campaign — `completed` means the sign-up credit landed, `partial` says the first-booking stage is still to come. Two different questions, two different fields; the admin screens need both.

**Legacy values**: rows written before this hold `eligible` and `rewarded`. Both mean the money moved, so both read as completed. `status` is a STRING not an ENUM, so nothing needed migrating — but every query filtering on it must use `COMPLETED_STATUSES`/`PENDING_STATUSES`, not a literal.

### Wallet transactions carry their provenance
`referenceType` / `referenceId` / `counterpartyUserId` / `metadata` on `wallettransaction`. Before these, a referral credit was a row whose only clue was the string "Referral reward (sign-up)" — enough to see points moved, useless for working out why, from whom, or under which campaign. `metadata` snapshots `balanceBefore`/`balanceAfter` rather than leaving them to be recomputed by replaying the ledger, which is the kind of arithmetic that quietly disagrees with the wallet after one adjustment lands out of order.

`referenceId` is deliberately **not** a foreign key — it points at different tables depending on `referenceType`, which an FK cannot express. The index on `(referenceType, referenceId)` is what makes "every credit from this referral" cheap.

Descriptions are written from the reader's point of view, because the user sees them in their own wallet history: the referrer gets "*X* joined using your code ABC123", the referee gets "you joined using *Y*'s code ABC123".

### Admin endpoints
- `GET /admin/wallet-transactions` — the ledger. Search matches the **user**, not the transaction, because an admin arrives from a support ticket holding a name or phone number, never a transaction id. Matching users are resolved first so the count stays honest. Totals are computed over the whole filtered set, not the page.
- `GET /admin/wallet-transactions/:id` — the trace: transaction → user → referral → both parties → campaign → every reward stage → every wallet row that referral produced on either side. This is the "back-track to user level" view.
- `GET /admin/wallet/user/:userId` — one user's balance and recent ledger.
- `GET /admin/wallet/user/:userId/referrals` — both directions at once (who referred them, who they referred), each with the wallet rows it produced. The user detail screen needs both and they are meaningless apart.

A row with no `referenceType` predates these columns; the trace says so rather than inventing a source.

## Marketing campaigns (email/SMS) + report builder
- `src/models/campaign.js` — one row per campaign. `channels` is a **comma-separated string** (`'email,sms'`), not an array — parse it on both ends. Per-channel content lives in separate columns (`emailSubject`/`emailBody`, `smsBody`) because the two channels never share copy.
- `src/services/audienceService.js` — `SEGMENTS` (18) + `resolveAudience()` + `previewAudience()`. Each segment carries a `params` descriptor so the admin UI renders its own controls; **add a segment here and the builder picks it up with no frontend change.** Only segments answerable from real tables exist — nothing based on app opens/device/push tokens, because that data isn't collected.
- `src/services/campaignService.js` — CRUD + `send()`. Sends **sequentially** (both providers rate-limit). A sent campaign is immutable: it's the record of what recipients actually got. Errors carry `statusCode`, so bad input is a 400 not a 500.
- `src/services/smsService.js` — **campaign SMS is not the OTP path.** MSG91's `/otp` endpoint (used by the existing OTP flow via `MSG_KEY`) can only send OTP templates. Campaigns use `/flow/`, which needs `MSG91_CAMPAIGN_FLOW_ID` pointing at a **DLT-approved** template — Indian regulation forbids arbitrary promotional text. Without that env var, SMS campaigns refuse to send rather than failing per-recipient.
- `mailService.sendCampaignEmail(to, subject, html)` — raw content, unlike `sendBookingEmail` which is SendGrid-template-only. It **throws** (the booking one deliberately swallows errors so a booking still succeeds if its email doesn't).
- `src/services/reportBuilderService.js` — `getDriverReport()` (host performance: completion/cancellation/on-time rates, ratings, revenue; "driver" in spec language = host here) and the custom report builder. `DATASETS` declares every queryable dataset/groupBy/metric/filter, and `getReportSchema()` ships it to the UI so the builder renders itself. **Anything not declared is rejected** — client-supplied column names never reach SQL.

Routes on `adminModulesRouter`: `/admin/campaigns*` (note `/campaigns/segments` and `/campaigns/audience-preview` are registered **above** `/campaigns/:id`), `/admin/reports/driver`, `/admin/reports/custom/schema`, `/admin/reports/custom/run`.

**Not built: there is no scheduler.** Setting `scheduledAt` marks a campaign `scheduled` but nothing fires it — sending is manual. A cron calling `campaignService.send()` for due campaigns is the missing piece.

## Identity documents & bank details
`src/services/documentService.js` + routes on `adminModulesRouter`.

**PAN did not exist in the schema before this** — `kycNumber`/`kycRef` hold the Aadhaar e-KYC reference from Cashfree, and there was no PAN column anywhere. Added to `User`: `panNumber`, `panName` (name as printed on the card — a mismatch against `name` is exactly what a reviewer needs), `panImage`, `panVerified`. Created by `db.sync({alter:true})` on boot. **Nothing collects PAN yet** — no rider/host app screen writes these fields, so the column is populated only if you backfill it or build a capture flow.

**Aadhaar and PAN are masked server-side** (`•••• •••• 9012`, `••••••234F`) and the full value never leaves the API. The document image is still served so an admin can check the card. Do not "fix" this by returning the raw number — an unmasked Aadhaar in a browser ends up in logs, screenshots and support tickets. Licence numbers are left readable (not a regulated identifier, and admins match them against the scan). Bank account numbers need no masking: `hostPayoutAccount.accountNumber` **only ever stores the last 4 digits** by design.

- `GET /admin/user-documents` — filter by `type` (kyc|pan|license) and `status` (pending|verified|missing). "Pending" means submitted-but-unverified; users who never submitted are excluded, since they aren't actionable.
- `PUT /admin/user-documents/:id/:docType` — `{verified}`. One endpoint per document so the activity log records *which* document was approved.
- `GET /admin/vehicle-rc`, `PUT /admin/vehicle-rc/:id` — RC number/image plus the RC-derived fields (engine, chassis, maker, colour). Note the model has **both** `vehicleRcVerified` (the admin-facing flag this screen toggles) and `rcVerified`/`rcVerificationId` (the Cashfree provider result) — they are different things and the UI shows both.
- `GET /admin/host-bank-accounts`, `PUT /admin/host-bank-accounts/:id` — sets `isVerified` **and** `isManuallyVerified`, so an admin override stays distinguishable from a penny-drop-verified account. The service computes `nameMismatch` (host-typed name vs bank-returned name), which is the main fraud signal on that screen.

**`Vehicle → Host` now exists** (`association.js`: `Vehicle.belongsTo(Host, { as: 'host' })` via `hostId`, and `Host.belongsTo(User, { as: 'user' })`), so `include: [{ model: Host, as: 'host', include: [{ model: User, as: 'user' }] }]` is the supported way to reach the host and their identity/PAN — `adminService.getVehicleById` and `vehicleReviewService` both use it. (`listVehicleRc` still stitches hosts in a second query; it predates the association and was left alone.)

## Vehicle approval & physical verification
Built to mirror the user verification flow (`userVerificationService`): a vehicle goes live ONLY through a gated Approve, never as a side effect of a document decision. `src/services/vehicleReviewService.js` + routes on `adminRouter`.

- **`approvalStatus`** on the Vehicle model is `pending | approved | rejected | suspended | maintenance`. `maintenance` is new — a damaged/under-repair car taken off the platform (`isAdminApproved=false`, reversible, `maintenanceReason`/`maintenanceAt`) that does NOT look rejected or suspended to the host. Every public listing query still gates on `isAdminApproved`, so suspended and maintenance both drop out of search.
- **`approve()` refuses** unless the RC is verified, the host's PAN is verified, the host is `active`, and — when the `vehicle.physicalVerification` feature flag is on — all four physical checks are verified. It names what's outstanding, exactly like the user approve gate. Approving sets `approved` + `isAdminApproved` + `active`.
- **Per-document review** reuses `documentStore.review('rc'|'pan', …)` — RC keyed by `vehicleId`, host PAN by the host's `userId`.
- **Physical verification** (`vehiclePhysicalVerification` model, one row/vehicle, per-item `{vehicle,rc,pan,host}Status`+`Reason`) is an in-person inspection. Gated by the `vehicle.physicalVerification` **feature flag** (`featureFlag` row, seeded default-OFF at boot; env override `VEHICLE_PHYSICAL_VERIFICATION=true|false`). **This is the first code that actually reads a feature flag.** When off, the section is hidden and not required.
- Endpoints (all `vehicles.update`, except review = `vehicles.read`): `GET /admin/vehicle/:id/review`, `POST /admin/vehicle/:id/document/:docType` (`docType`=`rc|pan`, body `{status, reason}`), `POST /admin/vehicle/:id/physical-check` (`{item, status, reason}`), `POST /admin/vehicle/:id/approve` (now gated), `POST /admin/vehicle/:id/maintenance` (`{maintenance, reason}`). `/reject` and `/suspend` are unchanged.
- **"Live"** is computed, not stored: `approved && active &&` an available `schedule` window (`Schedule` row, `status='available'`, `deleted=false`) covers now. The review payload returns `isLive`/`liveReason`.
- New model registered in `association.js` + `index.js`; run `scripts/syncNewTables.js` (new table) and the alter-sync (ENUM value + `maintenanceReason`/`maintenanceAt`) after deploy.

## Damage claims
Hosts file damage claims from the app (`POST /damage/create`, within **240 hours / 10 days** of booking end — enforced in `damageService.createDamage`). Before this there was **no admin-side view**: `damageRouter` only exposed get-by-id and get-by-booking, both behind `authenticateUser`.

`src/services/adminDamageService.js` + `GET /admin/damages`, `GET /admin/damages/:id`, `PUT /admin/damages/:id` (gated on the `bookings` module).

- **`damageImage` is a comma-joined string of URLs**, not a JSON array (`damageService.createDamage` does `.map(img => img.url).join(',')`). The admin API splits it into a `damageImages` array so clients don't have to know that.
- Status flow is `pending → approved|rejected`, and separately `→ paid`. **`paid` is rejected by the admin endpoint** — it's set by `damageService.updateDamagePayment`, which attaches the transaction. Allowing it by hand would mark a claim settled with no payment behind it.
- Admins set `damageAmount` when approving; it can differ from whatever the host first claimed. Input is validated **before** the `findByPk`, so bad input costs no DB round-trip.
- The list returns `totals` (claimed, approved+paid) computed over the **whole filtered set**, not the current page.
- Damage rows reach vehicle/rider/host through the booking. Those are fetched in bulk and stitched rather than nested includes, so one missing association can't break the list. Note `Damage.belongsTo(User, {foreignKey: 'userId'})` exists in `association.js` but there is **no `userId` column declared on the model** — Sequelize adds it implicitly; the rider is resolved via the booking instead.

## Weekly host settlement
Runs **Monday 06:00 Asia/Kolkata** and settles the week that just ended — **Monday 00:00:00.000 to Sunday 23:59:59.999**. `src/utils/settlementScheduler.js` + `src/services/settlementService.js`.

**It is OFF by default.** `SETTLEMENT_CRON_ENABLED=true` is required to arm it — deploying this code must not by itself start moving money on a timer. `SETTLEMENT_CRON` and `SETTLEMENT_TIMEZONE` override the schedule. **The timezone is pinned deliberately**: on a UTC server an unpinned "Monday 06:00" fires at 11:30 IST and, worse, computes the window against a different day.

This is separate from `payoutScheduler.js`, which runs **hourly** and only builds per-booking `hostPayoutLedger` rows 48h after a ride ends. That per-booking maths (commission, GST, `hostPayableAmount`) already existed — settlement *groups* those rows per host and makes one gateway transfer against them. If a ledger row is missing when the weekly job runs (booking ended late in the week), it builds it rather than dropping the host's money.

**Eligibility — a booking settles only when every claim against it is resolved.** Unresolved means: damage claim in `pending` **or `approved`** (approved = money owed but not yet collected, so the amount is still in flux — only `rejected`/`paid` are done), or a dispute that is `open`/`investigating`. Held bookings aren't lost: they're excluded from this batch, counted in `heldBookingCount`/`heldAmount`, and become eligible in a later run.

- `src/models/settlement.js` — one row per host per week. **Booking status is never touched** (it keeps its five values), so nothing across the four clients that filters on booking status can break. Status: `pending → submitted → paid | failed`, plus `on_hold`/`cancelled`.
- **`(hostId, periodStart)` is UNIQUE.** This is what makes the job safe to re-run: a second run for the same week hits the constraint instead of paying twice. A re-run reports the host as skipped with the existing settlement's status.
- `hostPayoutLedger.settlementId` — NULL means unsettled, which is exactly what the job looks for, so a ledger row can never be pulled into two batches.
- **The gateway call happens OUTSIDE the DB transaction.** Inside it, a gateway timeout would roll back the record of a transfer that may actually have gone through.
- `submitted` ≠ paid. It means the gateway accepted the transfer. `paid` is only set by the **webhook** (`transfer.*` events → `syncFromGateway`), which mirrors the gateway's own status onto the settlement and its ledger rows. Unrecognised gateway statuses leave our status alone but still record the raw value.

`POST /admin/settlements/run` with `{dryRun: true}` reports what would be paid without creating records or moving money. Also `scripts/runWeeklySettlement.js --dry-run [--date=YYYY-MM-DD]`. Failed batches keep their ledger rows attached and can be retried via `POST /admin/settlements/:id/retry`.

**Bug fixed here:** `payoutService.processHostPayout` did `require('./hostPayoutAccount')`, which resolves to `src/services/` where no such file exists — it threw `MODULE_NOT_FOUND` before ever reaching Razorpay, so host payouts could never have worked. Corrected to `../models/hostPayoutAccount`.

## Vehicle approval / rejection
`vehicle.approvalStatus` — `pending | approved | rejected` — plus `rejectionReason`, `reviewedAt`, `reviewedByAdminId`. Before this only `isAdminApproved` (boolean) existed, so an admin could approve but never reject, and a host was never told why their vehicle wasn't live.

**`isAdminApproved` is kept in sync** (approved ⇒ true, otherwise false) because `vehicleService`'s public listing queries gate on that boolean — don't remove it. But it cannot express "rejected", which is why **counts of `isAdminApproved: false` used to mean "pending"** and would silently have started including rejected vehicles. Those counts (`adminExtraService`) now filter on `approvalStatus: 'pending'`, and the `?approved=false` list filter does too — a rejected vehicle is a different queue and must not sit in the approvals list.

- `POST /admin/vehicle/:id/reject` — **`reason` is required** (a rejection with no reason isn't actionable). Approving clears any earlier reason so the host doesn't see stale feedback against a live vehicle. Both actions write to the activity log.
- **Editing a rejected vehicle IS the resubmission**: `hostService.updateVehicle` flips `rejected → pending` and clears the reason, so the host isn't left staring at feedback they've already addressed.

## PAN capture
Two write paths, both landing on the `panCards` table via `documentStore`:
- `PUT /user/update-pan` — the legacy direct submit used by the standalone `/verify/pan` page: `panNumber` (validated `^[A-Z]{5}[0-9]{4}[A-Z]$`, upper-cased and stripped server-side), `panName`, `panImage` (already uploaded to the `pan` folder).
- `POST /user/verification/pan/scan` + `POST /user/verification/pan/number` + `POST /user/verification/pan/retry-ocr` — the **KYC-style OCR flow**, used by the listing wizard's PAN step (`onboardingDocumentService.scanPan`/`confirmPanNumber`). Mirrors the licence exactly: `scan` stores the card (base64 → `pan` folder), OCRs it (`documentOcrService` `pan` document-type, `KYC_OCR_TYPE_PAN` override), returns `needsManualEntry`; `number` confirms the PAN and runs the advisory registry check; `retry-ocr` re-reads the stored image.

  **`scan` takes BOTH FACES** — `frontImage` and `backImage`, both required, exactly like `scanLicence`. Only the **front** is OCR'd (the number and the printed name are not on the back) and `retry-ocr` still re-reads the front alone; the back exists for the reviewer, who needs it to spot a tampered or laminated-over card. `panCards.backImageKey` is **nullable** because every row submitted before this has a front and nothing else, and those must keep reading cleanly — `projectUserDocuments` emits `panBackImage: null` for them while `panImage` keeps meaning the front, so nothing that already read it changed. Added by `db.sync({alter:true})` on boot (a plain nullable column, no index change).

  ⚠ **`PUT /user/update-pan` is deliberately still single-faced.** It backs the standalone `/verify/pan` page and mobile's `PanVerificationScreen`, which were not part of the listing-flow change. Those two screens still capture one face — worth closing later so PAN is captured the same way everywhere. **`panCards` gained `ocrStatus/ocrVerificationId/ocrFields/ocrRaw/ocrCheckedAt/manualConsent/manualConsentAt`** for this (added on boot by `db.sync({alter:true})`). The advisory `providerStatus` (PAN registry) stays separate from `ocrStatus` (reading the photo).

Both paths keep `panVerified` an admin decision, and changing the PAN starts a new submission rather than inheriting an old approval.

**Security fix made here:** `updateKycInfo` and `updateLicenseInfo` both built a whitelist object `data` and then called `user.update(updatedData)` with the **raw request body**. An authenticated user could `PUT /user/update-license` with `{"licenseVerified":true,"kycVerified":true}` and verify themselves — the exact decision an admin is supposed to own. Both now write only the whitelisted fields, and `updatePanInfo` follows the same discipline. **Never pass a request body straight to `user.update()`.**

Uploads go to the `pan` storage folder. Web has `/verify/pan` (linked from Profile). Mobile has `PanVerificationScreen`, registered in **both** `ProfileStackNavigator` and `HostProfileStackNavigator` and linked from the rider profile menu and the host menu (next to Bank Details — both gate payouts). It is currently the **only** verification screen on mobile; KYC and licence capture still have no mobile UI.

## db.sync failures are silent — this is how a table goes missing
`index.js` runs `db.sync({alter:true})` on every boot. That call **used to swallow its error** with `console.log(err)`, so a failed sync looked like a normal boot. When alter-sync throws partway through, **every model after the failure point never gets its table**, and the server comes up healthy until something queries it — that is exactly how `Table 'railway.settlements' doesn't exist` happened.

Two mitigations are now in place:
- The sync `.catch` logs loudly (`!!! SCHEMA SYNC FAILED !!!`) with the underlying `sqlMessage`, and points at the repair script.
- **Newer models are required explicitly at the top of `index.js`.** They were previously reachable only through a chain of service requires (`settlementScheduler → settlementService → models/settlement`); an explicit require makes registration independent of that chain. A model that isn't registered before `db.sync` runs simply never gets a table.

`scripts/syncNewTables.js` creates only the MISSING tables using plain `model.sync()` (CREATE TABLE IF NOT EXISTS) — it never alters, drops or reindexes anything that already exists, so it is safe to run on production. Supports `--dry-run`. Use it instead of forcing another full alter-sync when a table turns up missing.

**The usual cause of alter-sync failing on MySQL is the 64-keys-per-table limit** — repeated `alter:true` runs accumulate duplicate indexes until a table trips it. If the loud error names a specific table, check its index count (`SHOW INDEX FROM <table>`) before assuming the model is wrong.

## Signup & KYC verification workflow (PRD)
`src/services/userVerificationService.js` + `src/services/nameMatchService.js`.

**`user.verificationStatus`** (`incomplete → pending → active | rejected`, plus `active ⇄ suspended`) is the PROFILE's position in the review workflow. It is deliberately NOT the same as the per-document `status` on the document tables, which records whether each individual document is approved — those keep their own `verified` value, and only the profile-level status uses `active`. The queue and searchability key off `verificationStatus`.

**Suspension is an access decision, not a re-review.** `POST /admin/user-verification/:id/suspend` with `{suspended, reason}` — reason mandatory when suspending. Suspending sets `isSearchable: false` and stamps `suspensionReason`/`suspendedAt`; reactivating returns the profile straight to `active`, never back through the queue, because every document approval is retained. Same shape as vehicle suspension, and kept separate from `verificationRejectionReason` so a suspended account doesn't look like it failed review.

**`incomplete` is the resting state**, not a transient one. The onboarding wizard's profile step is mandatory but the licence and Aadhaar steps are **skippable**, and skipping either leaves the profile `incomplete` rather than queueing a submission an admin cannot action. `submitForReview` therefore 400s only on a missing PROFILE field; missing documents are a normal outcome. `refreshAfterDocument()` (called from `updateKycInfo`/`updateLicenseInfo`) promotes `incomplete → pending` by itself the moment the last document lands, so a user who skipped and came back never has to find a submit button again. The old `not_started`/`in_progress` split was collapsed into it — no client ever acted on the two differently.

**Only `active` may book.** `initiateBooking` gates on `verificationStatus === 'active'` alone. That replaced a set of per-document checks (`isKycVerified && isLicenseVerified`) which could disagree with the profile status in both directions: a user whose documents were each verified but whose profile was never approved could book, and a rejected user could too while the old flags were still set. `precheck` now returns `verificationStatus` and `canBook` at the top level so clients can disable the button rather than let the user reach a 400.

**A suspended user cannot sign in, and loses access immediately.** `verifyOtp` refuses to mint a custom token (403), AND `authenticateUser` rejects every request from a suspended row. Blocking only at sign-in would leave anyone already signed in with up to an hour of full access after being suspended, which is the whole point of the state.

**`scripts/migrateVerificationStatus.js`** rewrites the retired values (`not_started`/`in_progress` → `incomplete`, `verified` → `active`) before alter-sync narrows the ENUM. **MySQL refuses to drop an ENUM value rows still hold**, and a failed alter aborts the whole sync pass, silently leaving every model after `user` without a table (see "db.sync failures are silent"). Not needed on a database built by `initSchema.js` — the column is created with the new vocabulary directly — but it is what you run against any database that still holds the old values.

**Signing in routes into onboarding.** Web (`OtpPage`, after `verify-otp` succeeds) and mobile (`MainNavigator`, once authenticated) both read `GET /user/verification` and send the user into the onboarding wizard when the status is `incomplete` or `rejected`. Both **push** rather than gate — a failed status call falls through to normal navigation, so a flaky network can never lock someone out of the app.

New User columns: `firstName`, `lastName`, `dateOfBirth`, `address`, `city`, `state`, `pincode`, `licenseName`, `kycName`, `verificationStatus`, `verificationRejectionReason`, `verificationSubmittedAt/ReviewedAt/ReviewedByAdminId`, `isSearchable`, `nameMatchResult`.

`isSearchable` is its own column rather than derived from `verificationStatus`, so an admin can hide a verified profile without un-verifying their documents. **Approval grants no additional application access** — the PRD is explicit, so nothing in `approve()` touches roles or permissions.

### The name matching rule (nameMatchService)
One implementation shared by **Signup FR-5** (profile vs licence vs Aadhaar) and **Bank/PAN FR-6** (profile vs bank holder vs PAN holder) — they must agree, so don't reimplement either.

- First name must match **exactly**. No allowance.
- Last name: exact, OR **first character matches** (the PRD's explicit allowance for initials/abbreviations).
- Names are normalised first (case, punctuation, double spaces, leading honorifics) so `Dr. RAJESH  KUMAR.` compares equal to `Rajesh Kumar`.
- A missing surname on either side is **not** treated as failure — single-word names are common and failing them would reject legitimate users.
- **Interpretation, not in the PRD:** `Rajesh Kumar` vs `Rajesh Kumar Singh` matches. A strict last-token comparison gives `Kumar` vs `Singh` → reject, but the surname is present and merely displaced by an extra name, which is very common on Indian documents. If you want the strict reading, remove the `a.rest.includes(b.last)` branch.

User endpoints: `GET /user/verification`, `PUT /user/onboarding`, `POST /user/verification/submit`. Admin: `GET /admin/user-verification`, `POST /admin/user-verification/:id/{approve,reject,searchable}`. Rejection **requires** a reason. Editing after rejection returns the profile to `in_progress` and clears the stale reason.

## PAN provider verification
`updatePanInfo` calls Cashfree's `/verification/pan` using the **same** `KYC_URL`/`KYC_ID`/`KYC_SECRET` already used for Aadhaar e-KYC and bank verification — no new credentials needed.

`panProviderStatus` / `panProviderName` / `panNameMatch` record what the PROVIDER said; `panVerified` remains the **admin's** decision. A provider outage stores `UNCHECKED` and lets the submission through for manual review rather than blocking onboarding — only an explicit `INVALID` verdict rejects. A reviewer needs to tell "provider says invalid" apart from "we never got an answer".

## Vehicle suspension
`approvalStatus` gained `suspended`, plus `suspensionReason`/`suspendedAt`. `POST /admin/vehicle/:id/suspend` with `{suspended, reason}` — reason mandatory when suspending. Suspending sets `isAdminApproved: false` (which is what every public listing query gates on) while retaining all data; restoring returns it to `approved`, **not** to pending, because suspension is not a re-review. Kept separate from `rejectionReason` so a suspended vehicle doesn't look like it failed review.

## Document tables (normalised) — MIGRATION IN PROGRESS
Identity and vehicle documents moved out of inline columns into their own tables. **Hybrid design**: a dedicated table per known document type, plus one polymorphic table for everything else.

| Table | Owner | Holds |
|---|---|---|
| `kycDocuments` | `userId` | Aadhaar / e-KYC |
| `panCards` | `userId` | PAN |
| `drivingLicences` | `userId` | Licence (both faces) |
| `vehicleRcDocuments` | `vehicleId` | RC + the details captured from it |
| `otherDocuments` | polymorphic `ownerType`+`ownerId` | address proof, insurance, permits, anything new |

Bank accounts stay on **`hostPayoutAccount`** (host-level) — payouts only ever go to hosts, and the settlement engine resolves accounts by `hostId`.

**One row per SUBMISSION, not per owner.** A rejected document is kept and a new row added, so the reason and the trail survive a resubmission. `isCurrent` marks the row the app should read — exactly one per owner per type. `documentStoreService.submit()` demotes the previous row; **always go through that service** rather than the models, or you end up with two current documents and a queue showing stale data.

`status` (`pending|verified|rejected`) is the **admin's** decision. `providerStatus` records what the verification API said, separately — a reviewer must be able to tell "provider says invalid" from "we never got an answer" (`UNCHECKED`). **Provider verdicts are advisory and never block a submission**; only format validation rejects outright.

### Migration ordering — this is load-bearing
1. `scripts/syncNewTables.js` — creates the five tables.
2. `scripts/backfillDocumentTables.js --dry-run`, then for real. Safe to re-run: it only inserts when the owner has no current document of that type, and it never touches the inline columns.
3. **Services read/write the tables — DONE.** Every read and write path was moved: `userService` (Aadhaar OTP flow, KYC/licence/PAN writes, `precheck` flags), `userVerificationService` (readiness, name match, admin queue, approve), `documentService` (admin documents + RC screens), `adminService` (manual verify, user export), `adminExtraService` (pending-KYC alert count), `audienceService` (KYC/licence segments), `hostService` (RC written at vehicle onboarding).
4. **Model fields removed — DONE.** 19 columns off `User` (kyc*/pan*/license*) and 5 off `Vehicle` (vehicleRc*/rcVerified/rcVerificationId). `db.sync({alter:true})` re-adds any column still declared on a model, so this had to happen before the drop or they would come back empty on the next boot.
5. `scripts/dropLegacyDocumentColumns.js --dry-run`, then `--confirm`. **Take a backup first — this is irreversible.** The script refuses to run unless every row with inline data has a matching document record.

Four things depended on the dropped columns and were repaired in step 4: `hostService` (vehicle create + the listing attributes both set RC columns — now write a `vehicleRcDocument` instead), `adminService.getVehicleById` (read `vehicle.rcVerificationId` for provider re-lookup — now reads the document), and `adminExtraService.listVehicleDocuments` (named `rcVerified`/`rcVerificationId` in its `attributes` list, which would have thrown once dropped). The express-validator `body('kycNumber')` rules in `userRouter` are validating the REQUEST payload, not a column, so they stay.

**The API response shape is unchanged.** `documentStoreService.projectUserDocuments()` / `projectVehicleRc()` flatten the document rows back into the legacy field names (`kycNumber`, `licenseVerified`, `panImage`, `vehicleRcVerified`, …), so **no client needed changing** and the inline columns can be dropped without breaking web, mobile or admin. Responses now also carry a nested `documents` object with the real rows — per-document status, rejection reason, review history — which is what new client code should read. Delete the projection only once every client has moved.

**Do not run step 5 before step 4**, or the columns reappear on the next deploy and the drop looks like it silently failed.

## Driving licence extraction (PRD Signup FR-3)
`src/services/licenceVerificationService.js` — same Cashfree account and 2FA header convention as RC/Aadhaar/bank. Endpoint is configurable (`KYC_LICENCE_VERIFY`, default `/verification/driving-licence`) because Cashfree's paths differ between products and sandbox.

Called from `updateLicenseInfo`. **Extracted values overwrite typed ones** — the point of extraction is that the document is the source of truth, not the form. Holder name, DOB, issue and expiry dates all land on the `drivingLicences` row, and `expired` is computed because an expired licence shouldn't let someone book.

The provider needs licence number **and** date of birth — DOB is the second factor proving the submitter holds the licence rather than merely knowing its number. The profile's DOB is used when the client doesn't send one.

**Never throws on a provider failure** — returns `{status: 'UNCHECKED'}` and the submission proceeds to manual review, matching the PAN behaviour. The one exception is a malformed licence number, which is a typo, not a verdict, and is rejected as a 400. Auth/IP failures are logged as OUR misconfiguration rather than surfacing as "your licence is wrong".

## Vehicle listing wizard — 9 steps, bank + PAN before review
`ListYourCarPage.jsx` (web) and `AddCar.js` (mobile) now run the SAME 9 steps:
**RC → Details → Photos → Location → Preferences → Pricing → Bank → PAN → Review.**
Mobile previously had no bank step (bank lived only in `HostBankPage`); it now has one in-wizard too, so the two platforms match. Bank and PAN are stored per host and reused for every car.

- **Bank — Scenario A** — an active account exists: shown (account masked to last 4), with "Use a different account". An unverified existing account is flagged, since payouts are on hold until it verifies. **Scenario B** — none exists: the form is shown and must verify before continuing.
- **PAN (step 8)** is captured with the SAME KYC document flow as Aadhaar/licence (scan → OCR read → `OcrFallback` retry / manual number), see the OCR section below. An already-verified/submitted PAN just shows and the step continues.
  **Both faces, in the RC step's own capture UI** — web renders two `DocImage` tiles in a `.doc-row` (identical markup to the RC step); mobile renders two `DocTile`s, a module-scope component in the RC tile's visual language (dashed when empty, brand-coloured when filled) sized to sit two-up. Picking one face never clears the other: replacing a blurry back must not cost a front that already scanned.
  **A successful PAN submission goes straight to Review**, from all three routes into it (scan, retry-OCR, manual entry) — PAN is the last thing collected, so finishing it *is* the end of data entry. Web `setStep(STEP_REVIEW)` / mobile `handleNext()`, both inside `confirmPan`/`confirm` so no path can miss it.
- **The mock "SAMPLE · REGISTRATION CERTIFICATE" card above the RC upload is gone**, on both clients (web's `.rc-sample*` CSS deleted with it). The labelled capture tiles already say which face goes where, and a fake card sitting above real upload slots read as another thing to tap.

`loadBankAccount()`/`loadPan()` run when Pricing/Bank continue and when the step rail jumps back. After a bank save it **re-reads** rather than trusting the POST body (the bank returns the authoritative holder and bank name).

**RC uses the KYC document UI** — the web `DocImage`/`OcrFallback` widgets (shared in `components/app/DocCapture.jsx`), reusing the existing `/host/vehicles/rc-ocr` + `/host/vehicles/verify` endpoints (RC has no base64 `scan`/`retry-ocr`; "retry" re-posts the held file, and the manual "verify by car number" is the OcrFallback's manual path).

**Photos** include named interior slots (Dashboard / Front Seats / Rear Seats) alongside the exterior angles. `Image.type` is a plain VARCHAR, so these are just new strings — no migration.

## Signup & KYC — the actual flow, both sides
**User (mobile + web):** mobile number → OTP → onboarding → enter details → **upload driving licence** → **authenticate with Aadhaar** → submit → *Verification Pending*.

**Admin:** the user lands in the pending queue → admin opens them → **re-checks the licence with Cashfree** → **checks Aadhaar against the document/number** → eyeballs every scan and the entered details → approves, or rejects with a mandatory reason.

Mobile screens (all in `ProfileStackNavigator` AND `HostProfileStackNavigator`):
- `VerificationScreen` — profile form, outstanding-items checklist, submit. Links to all three capture screens.
- `LicenceVerificationScreen` — number + DOB + both faces. DOB is required because the provider looks the licence up by number **and** DOB; the profile's DOB prefills it.
- `AadhaarVerificationScreen` — two phases, mirroring the provider: number → OTP → verified, then optionally attach the document photo.
- `PanVerificationScreen`.

Admin: `_components/UserVerificationDetail.jsx`, opened from the queue. Per-document cards showing the extracted values, the scans, the provider verdict and the admin status, each with **Re-check with provider** / **Mark verified** / **Reject document**, then approve or reject the profile as a whole.

`GET /admin/user-verification/:id` returns the full submission. `POST .../recheck/:type` (licence|pan) re-runs the provider lookup — worth having as an explicit action because the check at submission time may have returned `UNCHECKED` when the provider was down, and re-checking beats rejecting a good user. `POST .../document/:docType` records the per-document decision.

**Provider verdicts stay advisory everywhere.** `providerStatus` is what the API said; `status` is what the admin decided. The two are shown separately so `INVALID` and `UNCHECKED` never look the same.

**React gotcha hit three times in these screens:** a component defined *inside* another component's render is a new type every render, so React remounts it. In a form that means the `TextInput` loses focus after one keystroke; in the admin detail it closed an open document lightbox. `Field` (mobile), `Field` and `DocCard` (admin) are all at module scope for this reason — don't move them back in.

## Rider refunds — separate from settlement
**Settlement pays HOSTS for completed bookings. Refunds return the RIDER's deposit.** Different tables, different services, different money direction — don't conflate them.

`src/services/refundService.js` + `src/models/refundRequest.js` + `src/utils/refundScheduler.js`.

### Timeline
| When | What |
|---|---|
| 0–24h after ride end | host may report damage (`DAMAGE_REPORT_WINDOW_HOURS`) |
| 0–7 days | admin verifies the photos, then assessment prices it |
| day 7 | daily job writes eligible bookings into the refund list (`REFUND_HOLD_DAYS`) |
| then | admin checks the figures and initiates |

### Damage is now two-step
`pending → approved → assessed`, and separately `rejected`/`paid`. **`approved` no longer means "charge this"** — it means the photos were verified and it's with the assessment team. Only `assessed` (or `paid`) carries a figure the refund calculation will use.

- `POST /admin/damages/:id/verify` — `{accept, reason}`. The admin compares **three** photo sets: ride-start, ride-end, and the claim. `getDamage` returns all three (`startImages`/`endImages`/`damageImages`) because a claim cannot be judged from the damage photos alone — the question is whether it's absent at pickup and present at return.
- `POST /admin/damages/:id/assess` — `{assessedAmount, notes}`. Rejects a missing or zero amount: an assessed claim with no figure would silently refund the full deposit.

### Eligibility
A booking joins the list when the hold has elapsed AND no claim is `pending`/`approved`. A blocked booking isn't lost — it's reported in `blocked[]` and picked up by a later run once assessment finishes. Cancellations use the same 7-day hold.

### The calculation
Deposit, minus: damage excess, fuel, late return, extra km, cleaning, other.

**Protection plan cover is a per-tier cap**, from `protectionplan.{tier}{Luxury}AccidentAmount`. Damage up to the cover is absorbed; the rider pays only the excess. **This required a schema fix**: `booking.protectionPlan` stores the plan ROW id, and the tier string was used to price the fee then thrown away — so there was no way to know whether a booking bought basic, silver or gold. Added `booking.protectionPlanTier`.

Cancellations: **host or admin cancelled ⇒ full refund** including the convenience fee. Rider cancelled ⇒ tiered (>24h full fare, 12–24h 50%, <12h nothing), with the protection-plan and convenience fees non-refundable. The deposit always comes back.

`shortfall` is surfaced when deductions exceed the deposit — the rider then **owes** money, which is a collection, not a refund, and must not silently clamp to zero.

### Processing
`processRefund` uses **`payments.refund` against the original transaction**, NOT a payout transfer. Transfers pay hosts, who never paid us; refunding a rider through one would move platform money with no link to their payment. Status is marked `processing` **before** the gateway call, so a successful call whose response is lost doesn't leave the row looking sendable. `completed` comes from the `refund.*` webhook.

`REFUND_CRON_ENABLED` defaults to **ON** (unlike the settlement job) — this job only builds review rows, it never pays anyone. `scripts/buildRefundList.js --dry-run [--date=]` for a manual run.

**Replaced a dead stub:** the previous `refundService.js` was never imported and called `db.transaction()` without importing `db`, and read `paymentId` off Booking where it lives on Transaction.

## Onboarding: OCR-backed Aadhaar + licence capture
`src/services/documentOcrService.js` + `src/services/onboardingDocumentService.js`.

There are document-verification touchpoints across the product: Aadhaar + licence during USER onboarding, and PAN + bank during HOST onboarding. **Aadhaar, licence AND PAN all go through the OCR service now** (`documentOcrService` carries `aadhaar`/`licence`/`pan` document-type candidates and extractors); PAN's scan/number/retry live in `onboardingDocumentService` alongside the other two and share `retryDocumentOcr`/`reRunOcr` via the `SCANNED_KINDS` map. Bank details are the one touchpoint that is a registry check only, not OCR.

> Note: `retryDocumentOcr` previously read a `fields` key off `reRunOcr`'s return that never existed, so a successful "retry verification" silently never recorded the number. It now reads the extracted number back from the reloaded row's `ocrFields` — fixed for all three kinds while wiring PAN in.

OCR uses the **same** Cashfree `bharat-ocr` endpoint and 2FA credentials that already power vehicle-RC scanning in `hostService` — `document_type` is `AADHAAR` or `DRIVING_LICENSE`, alongside the existing `VEHICLE_RC`. Deliberately constants, not env vars: three knobs for one provider contract is how they drift apart.

**`document_type` is probed, not hardcoded.** `DRIVING_LICENSE` was a guess by analogy with the working `VEHICLE_RC` call and is **wrong** — the provider answers `document_type_invalid`, so licence OCR silently never worked. Cashfree's docs are not reachable programmatically, so each kind now carries ordered candidates (licence: `DRIVING_LICENCE` → `DL` → `DRIVING_LICENSE`) tried **only** when the provider specifically rejects the type. The accepted value is cached for the process and logged with the env var to pin it.

Set **`KYC_OCR_TYPE_LICENCE`** / **`KYC_OCR_TYPE_AADHAAR`** once the right value is known and no probing happens at all. Any other failure — auth, IP, unreadable image — does **not** retry: the type was fine, and retrying would repeat the real error under a misleading label.

**`runOcr` never throws on a provider problem.** A timeout, an auth failure, an unreadable photo all come back as `{status}` — `VALID | INVALID | UNCHECKED | FAILED`. Only a malformed request throws. That contract is what makes the consent fallback possible: an OCR outage is OUR problem, and dead-ending the user on it would be wrong.

### The wizard's order: three uploads, then the identity check
Both clients run **details → Aadhaar card → licence → selfie → Aadhaar KYC**, and the server endpoints follow it:

1. `POST /user/verification/aadhaar/scan` — store both faces, OCR the front. Returns `needsManualEntry` when the number could not be read. Also accepts a **consent-only call** (`{manualConsent: true}`, no images) for the user who picks "your team verify it" over another retry — the scans are already stored, so re-posting megabytes of base64 to set a flag would be absurd.
2. `POST /user/verification/licence/scan` — the licence's exact counterpart to the Aadhaar scan: store both faces, OCR the front, return `needsManualEntry` when the number could not be read. Then `POST /user/verification/licence/number` only when OCR could not read one, because support cannot look up a licence with no number. Also takes the same consent-only call.
   **This reverses the old "consent before anything is stored" rule for the licence.** That rule bought a clean database at the cost of throwing the photo away on every failed read — which is exactly the retry the flow needs. A draft row with no `licenceNumber` is not `submitted` as far as `readiness()` is concerned, so nothing reaches the review queue on the strength of it.
   The single-shot `POST /user/verification/licence` survives for legacy clients; `licenceNumber` on it is now optional too.
3. `POST /user/verification/selfie`.
4. `POST /user/verification/aadhaar/number` — settles WHICH Aadhaar is about to be verified: format, uniqueness against other accounts, and agreement with what OCR read off the uploaded card. Returns the details on file. Refuses on an already-`verified`/`rejected` row (a new number is a new submission).
5. `check-kyc` → `verify-kyc` → `POST /user/verification/submit`.

**`POST /user/verification/:kind(aadhaar|licence)/retry-ocr` re-reads a scan already on file.** This is what "retry verification" means in both clients, and the reason the images are stored before the read is judged: OCR fails for reasons that have nothing to do with the photograph — a provider timeout, an IP that fell off the allowlist, a transient 5xx — and the honest response is to read the same scan again, not to send someone back to re-photograph a document that was fine. A read that finally succeeds writes the number and **withdraws** the `manualConsent` the earlier failure prompted; nobody needs to eyeball a card the machine has now read. The kind is a route segment, not a payload field, so a client cannot ask us to OCR something we don't scan. It shares `reRunOcr` with the admin re-run so both produce identical results from identical input.

**The full Aadhaar number leaves the API exactly once** — in the `scan` response, to the owner of the document, so the client can prefill it. Everything after that is masked. Consequently a client that reloads no longer holds it, and `confirmAadhaarNumber`, `checkKycNumber` and `verifyKycNumber` all **fall back to the number on the current KYC row** when the request omits it (`resolveKycNumber` in `userService`). An omitted `kycNumber` is the normal case, not a malformed request.

**`readiness()` measures whether the USER finished onboarding, not whether the automatic checks passed.** A number and a scan for each identity document is enough to reach `pending`. OCR can fail, the Aadhaar OTP can fail, the provider can be down for a week — none of that is the user's fault, and all of it is exactly what a human reviewer is for. Gating `pending` on a provider verdict stranded those users at `incomplete`, staring at a finished wizard with nothing left to do. It is not a way to self-verify: `pending` means only that somebody will look, and the worst a made-up number achieves is wasting a reviewer's time.

The number is **not** checked against Aadhaar's Verhoeff checksum: provider sandboxes issue test numbers that fail it, and rejecting a real card the user is holding is worse than letting the OTP arbitrate.

The **selfie is mandatory in both clients but deliberately not part of `readiness()`** — a photo is not an identity document, and gating the review queue on it would strand anyone whose device camera genuinely fails.

### Aadhaar OTP is a hard prerequisite (legacy single-shot submit only)
The order is fixed, and enforced on the SERVER — not just in the wizard, because a client could otherwise post straight to the last step and register an Aadhaar nobody proved they hold:

1. `POST /user/check-kyc` — the provider sends an OTP to the Aadhaar-linked phone, returns `ref_id`
2. `POST /user/verify-kyc` — on success writes the `kycDocuments` row with `referenceId` **and** `otpVerifiedAt`
3. `POST /user/verification/aadhaar` — attaches the scans and OCR

**`referenceId` is the proof.** It is written only by a successful OTP verification, so `submitAadhaar` refuses when it is absent, and refuses again when the submitted number differs from the one that was verified (otherwise scans could be attached to an unverified identity). Both refusals carry `needsOtp: true` so the client returns the user to the OTP phase instead of showing a dead end. `readiness()` likewise treats an Aadhaar number with no `referenceId` as not submitted.

**Two data-loss traps here, both fixed:** `documentStore.submit()` creates a NEW row and demotes the previous one, so anything not explicitly passed is silently dropped. `submitAadhaar` therefore carries `referenceId`/`otpVerifiedAt` forward from the OTP row (or the scans would erase the OTP proof), and `verifyKycNumber` carries `imageKey`/`backImageKey` forward (or re-verifying the OTP would erase already-uploaded scans).

**The provider's holder name outranks OCR.** It comes from the Aadhaar database itself, not from reading a photograph, so it wins when both are present — and it is what the KYC name-matching rule compares the profile against.

**The consent path.** When OCR does not return `VALID`, the submission is refused with `needsConsent: true` on the error body, and the client shows a prompt instead of an error. Only after the user actively agrees does `manualConsent` get sent, and it is recorded with a timestamp. Consent is checked **before** anything is stored, so a refusal leaves no half-written document row. `manualConsent` on a row is itself the signal to the admin that this one needs human eyes.

**Extracted values are stored ALONGSIDE what the user typed, never instead of it.** The reviewer's whole job is comparing the two; overwriting the typed value with the provider's would destroy the discrepancy they are looking for. `ocrFields` holds the parsed subset, `ocrRaw` the untouched payload.

**`ocrRaw` and `ocrFields` are stripped from every API response.** Both repeat the Aadhaar number in plaintext, which would defeat the masking applied to `documentNumber` two lines away. They stay in the database for support; the admin gets a masked `ocr` summary instead, carrying `nameMatchesProfile` and `numberMatchesTyped` computed server-side so every screen judges it identically.

Routes: `POST /user/verification/{aadhaar,licence,selfie}`. Admin: `POST /admin/user-verification/:id/ocr/:kind` re-reads the stored SCAN (distinct from `/recheck/:type`, which re-queries the licence REGISTRY by number).

**`bodyParser.json` is set to 12mb.** Scans and the selfie arrive as base64 data URIs and a phone photo encodes to several megabytes; at the 100kb default every upload failed with a bare 413 that read like a server error.

### Approval is now the last step, not a shortcut
`approve()` used to mark every document verified as a side effect — so an admin could approve a profile without opening a single scan, while the per-document status then claimed a human had checked it. It now **refuses** unless the profile is `pending` AND every document is already `verified`, naming what is outstanding. The admin verifies each document first, or rejects with a reason.

**Nothing else moves the profile. `active` is reachable ONLY through `approve()`, and `rejected` only through `reject()`.** `reconcileAfterDocumentDecision` used to promote the profile the instant the last identity document was verified, and reject it when one was turned down. Both are gone, replaced by `profileReviewState(userId)`, which **reports** (`verificationStatus`, per-document status, `readyToApprove`) and changes nothing. Verifying a scan says "this document is good"; it does not say "this person may now book", and one click must never silently mean the other. The old behaviour also made the outcome depend on the ORDER documents happened to be reviewed in, and let a profile go live without anyone ever opening the decision screen.

**`reject()` is available from `pending` AND `active`.** Rejecting an active profile withdraws an approval — for something that came to light after the fact — and is deliberately distinct from suspension, which is an access ban for misconduct and says something quite different to the user. The other three states are refused: `incomplete` never submitted anything, `rejected` is already there, and `suspended` would be silently overwritten, losing its reason and letting the account sign in again.

The admin UI mirrors that gate exactly, so it never offers a button the server would refuse. There is now **one** review screen (the user detail page) — the second reviewer component was deleted, because a decision could be made from a screen that didn't show the extracted data.

**`DOC_TYPE_MAP` accepts both spellings.** It had only `license` (US) while the admin UI sends `licence` (UK), so every licence verify/reject threw `Unknown document type` and the button silently did nothing. It now takes `license`/`licence` and `kyc`/`aadhaar`.

## Dashboard summary — a dashboard per team, composed by level
`src/services/dashboardSummaryService.js` + `GET /admin/dashboard/summary`.

**There is no universal dashboard.** A block registry (`BLOCKS`) plus a per-team layout (`TEAM_LAYOUTS`). Each block declares the **module** and **action** it needs, and is computed only if the caller holds it.

**Level falls out for free.** A block that offers to act declares `action: 'update'`, so an Operations *Agent* (read-only) receives `bookingsQueue` and nothing else, while a *Manager* on the same layout also gets `vehicleApprovals`, `kycQueue`, `disputesOpen` and `damageClaims`. No per-level branching anywhere — which matters because levels are editable at runtime, so a layout keyed on level would go stale the moment a Super Admin edits the grid.

**Do not gate this endpoint on one module.** `dashboard.read` grants access to the endpoint; each block is gated on its **own** module. Gating only at the top would hand a Support agent the settlement backlog from a tile — leaking exactly what a per-team portal exists to partition.

**A team with no layout gets `defaultLayout()`** — every block it can read. So a Super Admin creating a team at runtime gets a working dashboard with no deploy. Named layouts are curation, not a requirement.

**A failing block is reported, not dropped.** One bad count must not shorten the page silently, because a missing tile reads as "you have no access".

**Three field/enum mistakes were caught by checking the models rather than assuming** — worth repeating before adding a block: `damage` uses **`damageStatus`**, not `status`; `ticket`'s enum is `open|pending|resolved|closed` (no `in_progress`); `refundRequest`'s is `pending_review|approved|processing|completed|failed|rejected` (no bare `pending`). All three would have silently returned zero or counted everything.

## Rebuilding a database from nothing
`scripts/initSchema.js` — for a database with **no tables at all**, which is where the Development environment was after being cleared.

```
railway run node scripts/initSchema.js --dry-run
railway run node scripts/initSchema.js --confirm
```

**It requires every file in `src/models` rather than relying on require chains.** That is the whole reason it exists: `index.js` runs `db.sync({alter:true})`, and which models are registered by then depends on which service happens to have pulled them in — exactly how `settlements` went missing before. Requiring the directory removes the guesswork. `association.js` is required last, since it wires relations between models that must already be defined. Uses plain `db.sync()` (no `alter`, no `force`), then seeds config and the bootstrap super admin.

`scripts/verifySchema.js` — read-only, and the thing to run after any schema work. Checks every registered model has a table, that the critical tables exist, that every column referencing `users.id` is `varchar` not `char(36)`, that the `verificationStatus` ENUM holds the four states, that no legacy inline document columns survive, and that cities/settings/admins are non-empty.

`scripts/smokeTest.js` — read-only. Calls the ~21 service functions the admin panel and apps hit, against the real database, and reports which throw. Catches a missing table or a stale `attributes` entry without clicking through the UI.

### Foreign-key type mismatches are the #1 cause of a lost table
`scripts/auditForeignKeys.js` — read-only, no DB needed. Compares all ~140 foreign-key columns against the primary key each one references and reports any whose declared type disagrees.

**Run this before trusting any schema change.** MySQL rejects a mismatched FK outright, and a rejected FK **aborts the whole `db.sync({alter:true})` pass** — so every model after the failure point silently never gets its table or its new columns, while the server boots looking perfectly healthy. This is not theoretical: it is how `settlements` went missing, and later how `users` lost every onboarding column (`firstName`, `verificationStatus`, …) on a database where they had already been created correctly. One bad FK in an unrelated table undid all of it.

`scripts/rebuildTables.js <table>… --confirm` drops and recreates named tables from their models, for when the column type is already wrong in the database and `alter` cannot change it (MySQL will not alter a column a foreign key depends on). **It refuses if any named table has rows.**

`scripts/runAlterSync.js --confirm` runs exactly the boot-time alter with every model registered, and reports whether it completes — the direct way to prove a deploy will not abort partway. Note `alter:true` DOES drop columns no longer declared on a model, and repeated runs accumulate duplicate indexes toward MySQL's 64-key limit, so use it deliberately.

**Three FK bugs found this way**, all the same shape — a column declared `INTEGER`/`UUID` against a key of a different type:
- `conversation.hostId`, `conversation.userId`, `message.senderId` — `UUID` against `users.id`, which is a Firebase uid `STRING`.
- `offerUsage.offerId` — `INTEGER` against `offers.id` (`UUID`). This was the one aborting every boot's alter-sync. Its `userId` (`INTEGER` vs uid string) and `bookingId` (`INTEGER` vs booking UUID) were wrong too, they just had no FK to expose them.

**And two live bugs in the same code path, which meant applying ANY offer to a booking crashed:** `bookingService.initiateBooking` called `OfferUsage.create` referencing `bookingUniqueId` some 26 lines *before* that variable's `let` declaration — a temporal-dead-zone `ReferenceError` on every discounted booking — and passed `offer_id`/`user_id`/`booking_id`, which the model does not declare, so Sequelize would have dropped them and written nulls into `NOT NULL` columns. The row is now written after the booking exists, with camelCase keys and `booking.id`.

**Two more schema bugs surfaced by the rebuild**, both of which had made the full sync impossible:
- `conversation.hostId`, `conversation.userId` and `message.senderId` were declared `UUID` while their associations target `User`, whose PK is a Firebase uid `STRING`. MySQL rejected the foreign key (*"Referencing column 'hostId' and referenced column 'id' are incompatible"*), which aborted the sync — **after** those two tables had already been CREATEd with `char(36)` columns and no FK. A later plain `sync()` then reports them present and leaves the wrong types in place, so `scripts/repairChatTables.js` drops and rebuilds those two (refusing if either holds rows).
- **`protectionplans` and `membershiptypes` were seeded by nothing.** Without an ACTIVE protection plan (`endDate: null`, `startDate <= booking start`) `initiateBooking` throws, so a fresh database is not bookable at all. `addDefaultProtectionPlan` / `addDefaultMembershipType` now run at boot alongside the settings/cities/brands seeders, and their amounts are deliberately round placeholders for an admin to replace.

## Clean-database reset (development)
`scripts/freshStart.js` — wipe, then restore the bootstrap super admin.

```
railway run node scripts/freshStart.js --dry-run
railway run node scripts/freshStart.js --confirm --keep-config
```

**A wipe now removes every user and admin for good** — there is no Firebase pull to bring them back. Users re-register through the OTP flow; admins must be re-created in the panel by the bootstrap super admin, which the script's last step guarantees still exists. `scripts/resetDatabase.js` does the wipe alone if you want the steps separately.

Both refuse to run without `--confirm`, and the guard is checked **before** connecting so a mistaken invocation says why rather than failing on an unrelated connection error. Truncation runs with `FOREIGN_KEY_CHECKS = 0` (restored in `finally`) — ordering ~60 tables by dependency is fragile and one new association would break it.

### `--keep-config` — usually what you want
Preserves `cities`, `brands`, `models`, `settings`, `platformSettings`, `protectionplans`, `membershiptypes`, `rolePermissions`. **Without it, and with seeding off, the app boots looking fine but has no cities (nothing is bookable) and no fee settings (every fee reads as zero).** Both scripts warn about this.

### Boot seeding is now optional
`SEED_DEFAULTS=false` skips `addDefaultSettings` / `addDefaultCities` / `addDefaultBrands` / `addDefaultProtectionPlan` / `addDefaultMembershipType`. They are idempotent `findOrCreate`s, so they never overwrite an edit — but they **do re-insert anything deleted**, which is why a wiped database quietly refills with the default city and brand list on the next restart. That is the flag to set if the wipe must stick.
