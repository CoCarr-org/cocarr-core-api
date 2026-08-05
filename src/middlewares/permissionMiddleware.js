const { getEffectivePermission } = require('../services/permissionService');
const { ADMIN_ROLE_LABELS } = require('../utils/adminRoles');

// Gate an admin route on the Roles & Permissions matrix.
//
//   router.get('/vehicle', authenticateAdmin, requirePermission('vehicles','read'), ...)
//
// Must run AFTER authenticateAdmin, which is what sets `req.admin`.
//
// ── Enforcement is ON by default. ──
// It was opt-in while there was no guaranteed way back in. That risk is now
// covered by bootstrapAdminService, which restores BOOTSTRAP_SUPER_ADMIN_EMAIL
// to an active Super Administrator on every boot — so a misconfigured matrix
// can always be fixed by that account.
//
// Set RBAC_ENFORCE=false to fall back to dry-run (denials logged, requests
// allowed) if you need to debug a lockout without redeploying a code change.
const ENFORCE = process.env.RBAC_ENFORCE !== 'false';

// Belt-and-braces: the break-glass account is never denied, even if someone
// edits Super Administrator's own permissions to nothing in the matrix. This
// is the one hardcoded exception and it exists so the panel can never become
// permanently unadministrable.
const { BOOTSTRAP_EMAIL } = require('../services/bootstrapAdminService');

// `submodule` is optional and opt-in per route. Passing one means "check the
// override for this screen if the team has set one, otherwise the module grid".
//
// Routes are NOT being converted wholesale: an endpoint usually serves several
// screens, so mapping all ~300 of them is a judgement call each time and a bad
// guess silently narrows someone's access. Until a route opts in, sub-module
// permissions gate the UI only — which is a real improvement to what each team
// SEES, but is not by itself access control. See docs/MULTI-PANEL-PLAN.md.
function requirePermission(module, action, submodule = null) {
  return async (req, res, next) => {
    try {
      const admin = req.admin;

      // No `admins` row for this Firebase user. This used to ALLOW the request,
      // on the reasoning that the Firebase→DB sync might not have caught up —
      // but that bulk sync was removed, and rows are now created by
      // `createAdmin` alongside the Firebase user. A Firebase account with no
      // row is therefore not a transitional state: it is a mistake, or somebody
      // handed a login and nothing else. Either way it must not carry
      // platform-wide access, which is exactly what allowing it granted.
      //
      // Safe to deny because the break-glass below is checked on `admin.email`
      // from the token, not from a row — see authenticateAdmin.
      if (!admin) {
        console.warn(`[rbac] DENIED uid=${req.adminUid} -> ${action} on ${module} — no admin record`);
        if (!ENFORCE) return next();
        return res.status(403).json({
          error: 'Your admin account is not set up. Ask a Super Admin to create it.',
        });
      }

      // Break-glass: this account always passes. See BOOTSTRAP_EMAIL above.
      if ((admin.email || '').toLowerCase() === BOOTSTRAP_EMAIL) return next();

      // The team/level grid is authoritative. `resolvePermission` returns null
      // for exactly ONE reason now — this admin has no team yet, so the boot
      // migration has not reached them — and that is the only case the legacy
      // role matrix still covers. An inactive team, a missing level or an
      // all-false grid are denials and arrive as such; they no longer fall
      // through to a legacy grant.
      const teamService = require('../services/adminTeamService');
      let permission = await teamService.resolvePermission(admin, module, submodule);
      if (!permission) permission = await getEffectivePermission(admin.role, module);
      if (permission[action]) return next();

      const who = `${admin.name} (${ADMIN_ROLE_LABELS[admin.role] || `role ${admin.role}`})`;
      if (!ENFORCE) {
        console.warn(`[rbac:dry-run] would DENY ${who} -> ${action} on ${module} (${req.method} ${req.originalUrl}). Set RBAC_ENFORCE=true to enforce.`);
        return next();
      }

      console.warn(`[rbac] DENIED ${who} -> ${action} on ${module} (${req.method} ${req.originalUrl})`);
      return res.status(403).json({
        error: `Forbidden — your role (${ADMIN_ROLE_LABELS[admin.role] || admin.role}) does not have ${action} access to ${module}.`,
      });
    } catch (error) {
      // FAIL CLOSED. This used to allow the request on the reasoning that a
      // lookup failure must not 500 every admin call — but "the permission
      // check broke" is not a reason to perform an unchecked write. An admin
      // retrying a failed action is a far better outcome, and 503 says
      // truthfully that this is our fault and worth retrying.
      //
      // Dry-run still allows, so a lockout can be debugged without a deploy.
      console.error('[rbac] permission check FAILED, denying:', error);
      if (!ENFORCE) return next();
      return res.status(503).json({
        error: 'Could not verify your permissions just now. Please try again.',
      });
    }
  };
}

module.exports = { requirePermission, RBAC_ENFORCE: ENFORCE };
