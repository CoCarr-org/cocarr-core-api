// Which admin panel a request came from, and whether the caller may use it.
//
// MIRRORS `src/app/_helpers/panels.js` in COCARR-ADMIN. The two must agree on
// panel keys and tiers — the frontend copy decides what to *render*, this one
// decides what to *allow*, and only this one is enforcement.
//
// ── The hosts ──
//   root.cocarr.com    tier 0   super admin. Every module, every permission.
//   admin.cocarr.com   tier 1   every other team, one combined login.
//   ops. support. finance. growth. developer.
//                      tier 2   one team each. Declared here, dormant until a
//                               deployment gives them an origin.
//
// ── Access is TOP-DOWN and never upward ──
// Each team has a HOME panel — the tier it belongs to. A team may use its own
// panel and anything BELOW it, never anything above:
//
//   super admin (home root, tier 0)    → root, admin, and every module panel
//   finance     (home admin, tier 1)   → admin, and the finance module panel
//   finance     (home finance, tier 2) → finance only; admin is now above them
//
// The upward denial is absolute and is checked first, on its own. Everything
// after it is a sibling question, not a hierarchy one.
//
// ── Why the panel is checked on every request, not at sign-in ──
// Every panel uses the same Firebase admin project and the same API, so a token
// minted at admin.cocarr.com is a perfectly valid token at root.cocarr.com.
// There is nothing panel-specific about the credential, so a check at sign-in
// would be checked once and bypassed for the rest of the session. The login
// screen calls `/admin/me` and refuses there too, but that is for the person's
// sake — so they are told at the password box rather than after landing — and
// it is not what holds.
//
// ── This is a SECOND control, not the first ──
// The real boundary is `requirePermission` + `resolveAccess`: a Support user who
// reaches the root API still cannot approve anything, because their team's grid
// does not allow it. Panel binding stops them from *using* the root UI at all,
// which is defence-in-depth and blast radius. Do not mistake it for the access
// control — see docs/MULTI-PANEL-PLAN.md.

// Tier numbers ARE the hierarchy, and lower is more privileged — like a uid,
// where 0 is root. They are only ever compared, never displayed, so the gaps
// are free: a tier between admin and the module panels can be inserted later
// without renumbering anything.
const TIER = { ROOT: 0, ADMIN: 1, MODULE: 2 };

const PANELS = {
  // root.cocarr.com. Only super admins — and `resolveAccess` already grants
  // that team a full grid unconditionally, so "all modules and all permissions"
  // is a property of the team, not something this file confers.
  root: {
    key: 'root',
    label: 'Root',
    tier: TIER.ROOT,
    teams: ['super-admin'],
  },
  // admin.cocarr.com — one common login for every other team.
  admin: {
    key: 'admin',
    label: 'Admin',
    tier: TIER.ADMIN,
    teams: ['admin', 'customer-support', 'operations', 'finance', 'marketing', 'developer'],
  },

  // ── Per-module panels: declared now, dormant until deployed ──
  // Bringing ops.cocarr.com online is one entry in ADMIN_PANEL_ORIGINS. No code
  // changes: a panel is a tier and a team list here, and a module list on the
  // frontend.
  //
  // A team listed here is ALSO still on `admin` above, and that overlap is the
  // migration. While their home is `admin` they can use both hosts, because
  // tier 1 reaches down into tier 2. Moving their home (ADMIN_PANEL_HOMES) is
  // what makes the move final and takes `admin` away from them — a separate and
  // reversible step, so a bad cutover is one env var away from being undone.
  ops: { key: 'ops', label: 'Operations', tier: TIER.MODULE, teams: ['operations'] },
  support: { key: 'support', label: 'Support', tier: TIER.MODULE, teams: ['customer-support'] },
  finance: { key: 'finance', label: 'Finance', tier: TIER.MODULE, teams: ['finance'] },
  growth: { key: 'growth', label: 'Growth', tier: TIER.MODULE, teams: ['marketing'] },
  developer: { key: 'developer', label: 'Developer', tier: TIER.MODULE, teams: ['developer'] },
};

// The two panels were called `console` and `portal` before the root./admin.
// naming. Accepted so an environment already carrying the old names keeps
// working through a deploy rather than failing closed on a variable nobody
// thought to update.
const ALIASES = { console: 'root', portal: 'admin' };

const canonical = (key) => {
  if (!key) return null;
  if (PANELS[key]) return key;
  return ALIASES[key] || null;
};

// ── Configuration ──────────────────────────────────────────────────────────
//
// OFF BY DEFAULT, deliberately. Most panel hosts do not exist yet, and a check
// that defaulted to on would reject every request from the single admin panel
// running today the moment this merges. It arms itself only once told what the
// panels are.
//
//   ADMIN_PANEL_ORIGINS=root=https://root.cocarr.com,admin=https://admin.cocarr.com
//   ADMIN_PANEL_KEYS=root=<secret>,admin=<secret>          (optional, stronger)
//   ADMIN_PANEL_HOMES=operations=ops,finance=finance       (the cutover switch)
//
// With ORIGINS alone the panel is inferred from the browser's `Origin` header.
// That stops casual cross-panel use — someone opening root.cocarr.com and
// signing in — but not a determined caller with curl, who can send any Origin
// they like. With KEYS each deployment carries a secret a browser on another
// origin cannot forge, which is the version worth having.
const parsePairs = (raw, { mapKey, mapValue }) => String(raw || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .reduce((acc, pair) => {
    const i = pair.indexOf('=');
    if (i < 1) return acc;
    const key = mapKey(pair.slice(0, i).trim());
    const value = mapValue(pair.slice(i + 1).trim());
    if (key && value) acc[key] = value;
    return acc;
  }, {});

const asIs = (v) => v || null;

const PANEL_ORIGINS = parsePairs(process.env.ADMIN_PANEL_ORIGINS, {
  mapKey: canonical, mapValue: asIs,
});
const PANEL_KEYS = parsePairs(process.env.ADMIN_PANEL_KEYS, {
  mapKey: canonical, mapValue: asIs,
});

const isConfigured = () =>
  Object.keys(PANEL_ORIGINS).length > 0 || Object.keys(PANEL_KEYS).length > 0;

// A panel is LIVE once it has somewhere to be reached at. Declared-but-not-
// deployed is the normal state for all five per-module panels.
const isLive = (panelKey) => !!(PANEL_ORIGINS[panelKey] || PANEL_KEYS[panelKey]);

// ── Home panels ────────────────────────────────────────────────────────────
//
// Keyed by TEAM, because a team has exactly one home — that format makes a team
// with two homes unrepresentable rather than something to validate.
//
//   ADMIN_PANEL_HOMES=operations=ops,customer-support=support
//
// Moving a home is the half of a cutover that bites: it takes the admin panel
// away from that team. So it REFUSES to apply against a panel that is not live,
// and says why. Otherwise a typo, or setting the home before deploying the
// host, strands a whole team with a home they cannot reach and an admin panel
// that now denies them — a total lockout for everyone on that team, produced by
// one env var and no error anywhere.
const HOME_OVERRIDES = (() => {
  const raw = parsePairs(process.env.ADMIN_PANEL_HOMES, {
    mapKey: (k) => k || null,
    mapValue: canonical,
  });
  return Object.entries(raw).reduce((acc, [teamKey, panelKey]) => {
    if (!isLive(panelKey)) {
      console.warn(
        `[panel] IGNORING home '${teamKey}=${panelKey}': the ${panelKey} panel has no origin or `
        + 'key configured, so moving them there would leave them nowhere to sign in. Add '
        + `${panelKey} to ADMIN_PANEL_ORIGINS first.`,
      );
      return acc;
    }
    if (!PANELS[panelKey].teams.includes(teamKey)) {
      console.warn(
        `[panel] IGNORING home '${teamKey}=${panelKey}': the ${panelKey} panel does not list team `
        + `'${teamKey}'. Add it to that panel's teams first, in this file AND the admin repo copy.`,
      );
      return acc;
    }
    acc[teamKey] = panelKey;
    return acc;
  }, {});
})();

// Where does this team belong? Super admin at the top; everyone else on the
// combined admin panel until an env var moves them down to their own.
const homePanelOf = (teamKey) => HOME_OVERRIDES[teamKey]
  || (teamKey === 'super-admin' ? 'root' : 'admin');

// Which panel is this request claiming to be from?
//
// The KEY wins when configured: it is the only one of the two that a browser on
// a different origin cannot produce. `Origin` is the zero-config fallback.
// Returns null when we cannot tell, which callers treat as "do not block".
const panelOf = (req) => {
  const headerKey = req.get('x-cocarr-panel-key');
  if (headerKey) {
    const match = Object.keys(PANEL_KEYS).find((k) => PANEL_KEYS[k] === headerKey);
    if (match) return match;
    // A key was sent and matched nothing. That is a misconfiguration or an
    // attempt, and either way must not silently fall through to the weaker
    // Origin check — that would make sending a key strictly worse than sending
    // none at all.
    return 'unknown';
  }

  const origin = req.get('origin');
  if (origin) {
    const match = Object.keys(PANEL_ORIGINS)
      .find((k) => PANEL_ORIGINS[k].split('|').some((o) => o.trim() === origin));
    if (match) return match;
    return isConfigured() ? 'unknown' : null;
  }

  // No Origin header — a server-to-server call, curl, or a native app. Browsers
  // always send it for cross-origin requests, so its absence is not itself
  // suspicious; the permission grid is what protects these.
  return null;
};

// "…and sign in at X instead". A denial that does not say where to go sends the
// person to support for an answer they could have been given here.
const redirectHint = (teamKey) => {
  const home = PANELS[homePanelOf(teamKey)];
  const origin = PANEL_ORIGINS[home.key];
  return origin
    ? `Your team signs in at the ${home.label} panel (${origin.split('|')[0].trim()}).`
    : `Your team signs in at the ${home.label} panel.`;
};

/**
 * May this admin use the panel this request came from?
 *
 * @returns {{allowed: boolean, panel: string|null, reason: string|null}}
 */
const check = (req, teamKey) => {
  if (!isConfigured()) return { allowed: true, panel: null, reason: null };

  const panel = panelOf(req);
  if (panel === null) return { allowed: true, panel: null, reason: null };

  if (panel === 'unknown') {
    return { allowed: false, panel: null, reason: 'This admin panel is not recognised.' };
  }

  // No team yet (not migrated) — let the permission grid decide. Bouncing them
  // here would lock out exactly the accounts that predate the team system.
  if (!teamKey) return { allowed: true, panel, reason: null };

  const def = PANELS[panel];
  const home = PANELS[homePanelOf(teamKey)];

  // THE rule. Access runs downward only: a team uses its own tier and anything
  // below, never anything above. Checked first and alone, because it is the one
  // denial that must not be reachable past any other branch in this function.
  if (home.tier > def.tier) {
    return {
      allowed: false,
      panel,
      reason: `The ${def.label} panel is above your team's access level. ${redirectHint(teamKey)}`,
    };
  }

  // Root reaches everything beneath it, including panels that do not list it.
  if (home.tier === TIER.ROOT) return { allowed: true, panel, reason: null };

  // Below root, a panel at or under your tier still has to be YOURS. This is a
  // sibling question rather than a hierarchy one: it is what stops Finance
  // wandering onto the Operations portal, where the whole menu would render and
  // then every call behind it would be refused by the permission grid.
  if (!def.teams.includes(teamKey)) {
    return {
      allowed: false,
      panel,
      reason: `The ${def.label} panel is not for your team. ${redirectHint(teamKey)}`,
    };
  }

  return { allowed: true, panel, reason: null };
};

module.exports = {
  PANELS, TIER, check, panelOf, isConfigured, isLive, homePanelOf,
};
