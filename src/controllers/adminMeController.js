const teamService = require('../services/adminTeamService');
const { getEffectivePermission } = require('../services/permissionService');
const { ADMIN_MODULES } = require('../utils/adminPermissions');
const { ADMIN_ROLE_LABELS } = require('../utils/adminRoles');

// GET /admin/me — who am I, and what may I do?
//
// The panel needs this to render at all: which nav groups to show, which buttons
// to show, and which team name and icon to put under the logo. Before it existed
// the client knew nothing about the signed-in admin, so it rendered every menu
// item for everybody and people discovered their access by collecting 403s.
//
// ── It MUST agree with requirePermission, always ──
// Both read `resolveAccess`, and this endpoint reproduces the middleware's one
// remaining fallback (the legacy role matrix, for an admin with no team yet)
// rather than computing a grid of its own. Two implementations of "what may this
// person do?" drift, and the drift is invisible in both directions: hide
// something the server allows and the panel looks broken; show something it
// denies and every click is a 403.
async function me(req, res) {
  try {
    const admin = req.admin;
    if (!admin) {
      // Matches the middleware, which now denies this case rather than allowing
      // it. Answered as 403 with a usable message instead of an empty profile,
      // because an empty profile renders as a blank panel with no explanation.
      return res.status(403).json({
        error: 'Your admin account is not set up. Ask a Super Admin to create it.',
      });
    }

    const access = await teamService.resolveAccess(admin);

    // `legacy` means this admin predates the team migration and the middleware
    // is still judging them by the old role matrix. Build the same grid here so
    // the panel shows exactly what the server will honour — otherwise they see
    // an empty sidebar while their requests succeed.
    let permissions = access.permissions;
    if (access.source === 'legacy') {
      const entries = await Promise.all(
        ADMIN_MODULES.map(async (m) => [m, await getEffectivePermission(admin.role, m)]),
      );
      permissions = Object.fromEntries(entries);
    }

    return res.status(200).json({
      id: admin.id,
      name: admin.name,
      email: admin.email,
      mobile: admin.mobile || null,
      team: access.team,
      level: access.level,
      permissions,
      // Per-screen overrides, keyed by nav route. Only the screens that deviate
      // from their module are present; absent means "inherits".
      submodules: access.submodules || {},
      // How the grid above was arrived at. The panel uses it for one thing —
      // warning a `legacy` admin that they are not on a team yet — but it is
      // also what makes a support conversation about access tractable.
      source: access.source,
      // Legacy role, reported for display only. Nothing should branch on it:
      // it is the column that used to silently outrank the team system.
      legacyRole: admin.role || null,
      legacyRoleLabel: ADMIN_ROLE_LABELS[admin.role] || null,
      // In dry-run the server allows everything and only logs. The panel needs
      // to know, or it would gate strictly against a server that isn't gating at
      // all — and dry-run would stop being a safe way to debug a lockout.
      enforced: require('../middlewares/permissionMiddleware').RBAC_ENFORCE,
    });
  } catch (error) {
    console.error('[admin/me]', error);
    return res.status(500).json({ error: 'Could not load your profile' });
  }
}

module.exports = { me };
