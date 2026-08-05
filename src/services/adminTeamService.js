const { Op } = require('sequelize');
const AdminTeam = require('../models/adminTeam');
const AdminTeamLevel = require('../models/adminTeamLevel');
const AdminTeamPermission = require('../models/adminTeamPermission');
const Admin = require('../models/admin');
const { ADMIN_MODULE_LIST, ADMIN_MODULES } = require('../utils/adminPermissions');
const { ADMIN_ROLES } = require('../utils/adminRoles');

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const slugify = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Permission shorthands (grid values are module -> one of these).
const NONE = { canCreate: false, canRead: false, canUpdate: false, canDelete: false };
const R    = { canCreate: false, canRead: true,  canUpdate: false, canDelete: false };
const RU   = { canCreate: false, canRead: true,  canUpdate: true,  canDelete: false };
const CRUD = { canCreate: true,  canRead: true,  canUpdate: true,  canDelete: true };
const FULL_ACTIONS = { create: true, read: true, update: true, delete: true };

// Manager-level grid per seeded team. Lower levels are derived from these:
//   Specialist = Manager minus delete, Agent = read-only.
const TEAM_SEED = [
  {
    key: 'super-admin', name: 'Super Admin', legacyRole: ADMIN_ROLES.SUPER_ADMIN,
    description: 'Full access to everything, including teams, roles, security and settings.',
    grid: Object.fromEntries(ADMIN_MODULES.map((m) => [m, CRUD])),
  },
  {
    key: 'admin', name: 'Admin', legacyRole: ADMIN_ROLES.PLATFORM_ADMIN,
    description: 'Runs the platform day to day. No team/role, security or admin-account control.',
    grid: {
      dashboard: R, users: CRUD, hosts: CRUD, vehicles: CRUD, bookings: CRUD,
      payments: R, payouts: R, support: CRUD, cms: CRUD, marketing: CRUD,
      reports: R, auditLogs: R, settings: RU, adminAccounts: NONE, roles: NONE,
      security: NONE, systemHealth: R, integrations: R,
    },
  },
  {
    key: 'customer-support', name: 'Customer Support', legacyRole: ADMIN_ROLES.SUPPORT_EXECUTIVE,
    description: 'Helps customers and hosts: tickets, look-ups and limited updates.',
    grid: {
      dashboard: R, users: RU, hosts: R, vehicles: R, bookings: RU,
      payments: R, payouts: NONE, support: CRUD, cms: R, marketing: NONE,
      reports: R, auditLogs: NONE, settings: NONE, adminAccounts: NONE, roles: NONE,
      security: NONE, systemHealth: NONE, integrations: NONE,
    },
  },
  {
    key: 'operations', name: 'Operations', legacyRole: ADMIN_ROLES.OPERATIONS_MANAGER,
    description: 'Bookings, vehicle approvals, hosts, user verification, disputes and damage.',
    grid: {
      dashboard: R, users: CRUD, hosts: CRUD, vehicles: CRUD, bookings: CRUD,
      payments: R, payouts: R, support: CRUD, cms: R, marketing: R,
      reports: R, auditLogs: R, settings: NONE, adminAccounts: NONE, roles: NONE,
      security: NONE, systemHealth: NONE, integrations: NONE,
    },
  },
  {
    key: 'finance', name: 'Finance', legacyRole: ADMIN_ROLES.FINANCE_MANAGER,
    description: 'Payments, refunds, host payouts and settlements, plus financial reports.',
    grid: {
      dashboard: R, users: R, hosts: R, vehicles: R, bookings: R,
      payments: CRUD, payouts: CRUD, support: R, cms: NONE, marketing: R,
      reports: CRUD, auditLogs: R, settings: NONE, adminAccounts: NONE, roles: NONE,
      security: NONE, systemHealth: NONE, integrations: NONE,
    },
  },
  {
    key: 'marketing', name: 'Marketing', legacyRole: ADMIN_ROLES.MARKETING_MANAGER,
    description: 'Offers, memberships, campaigns, banners and content.',
    grid: {
      dashboard: R, users: R, hosts: NONE, vehicles: NONE, bookings: NONE,
      payments: NONE, payouts: NONE, support: NONE, cms: CRUD, marketing: CRUD,
      reports: R, auditLogs: NONE, settings: NONE, adminAccounts: NONE, roles: NONE,
      security: NONE, systemHealth: NONE, integrations: NONE,
    },
  },
  {
    key: 'developer', name: 'Developer', legacyRole: ADMIN_ROLES.DEVELOPER_DEVOPS,
    description: 'System health, integrations, security, feature flags and logs.',
    grid: {
      dashboard: R, users: NONE, hosts: NONE, vehicles: NONE, bookings: NONE,
      payments: NONE, payouts: NONE, support: NONE, cms: NONE, marketing: NONE,
      reports: R, auditLogs: R, settings: R, adminAccounts: NONE, roles: NONE,
      security: CRUD, systemHealth: CRUD, integrations: CRUD,
    },
  },
];

// Legacy role integers with no direct team of their own → mapped onto the
// closest team when migrating existing admins.
const LEGACY_ROLE_TEAM = {
  [ADMIN_ROLES.KYC_COMPLIANCE]: 'operations',
  [ADMIN_ROLES.FLEET_MANAGER]: 'operations',
  [ADMIN_ROLES.ANALYTICS_VIEWER]: 'admin',
};

const dropDelete = (g) => ({ ...g, canDelete: false });
const readOnly = (g) => ({ canCreate: false, canRead: g.canRead, canUpdate: false, canDelete: false });

// Levels seeded for every team. Super Admin gets a single all-access level.
function levelsFor(teamKey, grid) {
  if (teamKey === 'super-admin') {
    return [{ key: 'administrator', name: 'Administrator', rank: 3, isDefault: true, transform: (g) => g }];
  }
  return [
    { key: 'manager', name: 'Manager', rank: 3, isDefault: true, transform: (g) => g },
    { key: 'specialist', name: 'Specialist', rank: 2, isDefault: false, transform: dropDelete },
    { key: 'agent', name: 'Agent', rank: 1, isDefault: false, transform: readOnly },
  ];
}

// ── Seeding (idempotent; safe every boot) ───────────────────────────────────
// findOrCreate never overwrites an edit, and permission rows are only seeded
// when a level has none yet — so a Super Admin's grid changes survive reboots.
async function seedAdminTeams({ log = console } = {}) {
  for (const t of TEAM_SEED) {
    const [team] = await AdminTeam.findOrCreate({
      where: { key: t.key },
      defaults: { name: t.name, description: t.description, isSystem: true, legacyRole: t.legacyRole, isActive: true },
    });
    // Keep the legacyRole link current even if the row predates this column.
    if (team.legacyRole !== t.legacyRole) await team.update({ legacyRole: t.legacyRole });

    for (const l of levelsFor(t.key, t.grid)) {
      const [level] = await AdminTeamLevel.findOrCreate({
        where: { teamId: team.id, key: l.key },
        defaults: { name: l.name, rank: l.rank, isDefault: l.isDefault },
      });
      const existing = await AdminTeamPermission.count({ where: { teamId: team.id, levelId: level.id } });
      if (existing === 0) {
        const grid = t.grid;
        const rows = ADMIN_MODULES.map((m) => ({
          teamId: team.id, levelId: level.id, module: m, ...l.transform(grid[m] || NONE),
        }));
        await AdminTeamPermission.bulkCreate(rows);
      }
    }
  }
  const migrated = await migrateAdminsToTeams();
  log.log(`[admin-teams] seeded ${TEAM_SEED.length} teams; migrated ${migrated} admin(s) onto a team.`);
}

// Assign a team + default level to any admin that has a legacy `role` but no
// team yet. Never touches an admin who already has a team.
async function migrateAdminsToTeams() {
  const admins = await Admin.findAll({ where: { teamId: null } });
  if (!admins.length) return 0;

  const teams = await AdminTeam.findAll();
  const byKey = Object.fromEntries(teams.map((t) => [t.key, t]));
  const byLegacy = Object.fromEntries(teams.filter((t) => t.legacyRole != null).map((t) => [t.legacyRole, t]));
  const defaultLevelCache = {};
  const defaultLevel = async (teamId) => {
    if (defaultLevelCache[teamId] === undefined) {
      defaultLevelCache[teamId] =
        (await AdminTeamLevel.findOne({ where: { teamId, isDefault: true } })) ||
        (await AdminTeamLevel.findOne({ where: { teamId }, order: [['rank', 'DESC']] }));
    }
    return defaultLevelCache[teamId];
  };

  let count = 0;
  for (const admin of admins) {
    const team = byLegacy[admin.role] || byKey[LEGACY_ROLE_TEAM[admin.role]] || byKey.admin;
    if (!team) continue;
    const level = await defaultLevel(team.id);
    await admin.update({ teamId: team.id, teamLevelId: level ? level.id : null });
    count += 1;
  }
  return count;
}

// ── Read ─────────────────────────────────────────────────────────────────────
async function listTeams() {
  const [teams, levels, memberCounts] = await Promise.all([
    AdminTeam.findAll({ order: [['isSystem', 'DESC'], ['id', 'ASC']] }),
    AdminTeamLevel.findAll({ order: [['rank', 'DESC']] }),
    Admin.findAll({ attributes: ['teamId', [require('../configs/db').fn('COUNT', require('../configs/db').col('id')), 'count']], group: ['teamId'], raw: true }),
  ]);
  const counts = Object.fromEntries(memberCounts.map((r) => [r.teamId, Number(r.count)]));
  return teams.map((t) => ({
    id: t.id, key: t.key, name: t.name, description: t.description,
    isSystem: t.isSystem, isActive: t.isActive,
    memberCount: counts[t.id] || 0,
    levels: levels.filter((l) => l.teamId === t.id).map((l) => ({ id: l.id, key: l.key, name: l.name, rank: l.rank, isDefault: l.isDefault })),
  }));
}

function modules() {
  return ADMIN_MODULE_LIST;
}

// Full grid for one team: every level × every module.
async function getTeam(teamId) {
  const team = await AdminTeam.findByPk(teamId);
  if (!team) throw httpError(404, 'Team not found');
  const [levels, perms, memberCount] = await Promise.all([
    AdminTeamLevel.findAll({ where: { teamId }, order: [['rank', 'DESC']] }),
    findPermissions({ teamId }),
    Admin.count({ where: { teamId } }),
  ]);
  const asActions = (p) => ({
    create: p.canCreate, read: p.canRead, update: p.canUpdate, delete: p.canDelete,
  });

  // Module rows and submodule overrides are split apart, because the editor
  // shows them at two different levels and merging them here would mean the UI
  // could not tell an override from an inherited value — which is exactly the
  // distinction a Super Admin needs to see before changing anything.
  const permByLevel = {};
  const subByLevel = {};
  for (const p of perms) {
    if (p.submodule) {
      (subByLevel[p.levelId] = subByLevel[p.levelId] || {})[p.submodule] =
        { module: p.module, ...asActions(p) };
    } else {
      (permByLevel[p.levelId] = permByLevel[p.levelId] || {})[p.module] = asActions(p);
    }
  }
  return {
    id: team.id, key: team.key, name: team.name, description: team.description,
    isSystem: team.isSystem, isActive: team.isActive, memberCount,
    modules: ADMIN_MODULE_LIST,
    levels: levels.map((l) => ({
      id: l.id, key: l.key, name: l.name, rank: l.rank, isDefault: l.isDefault,
      permissions: ADMIN_MODULES.reduce((acc, m) => {
        acc[m] = permByLevel[l.id]?.[m] || { create: false, read: false, update: false, delete: false };
        return acc;
      }, {}),
      // Only the screens that actually deviate. Absent means "inherits the
      // module", which is the overwhelmingly common case — sending 58 inherited
      // entries per level would be mostly noise and would make a real override
      // hard to spot.
      submodules: subByLevel[l.id] || {},
    })),
  };
}

// ── Write (Super Admin) ───────────────────────────────────────────────────────
async function createTeam({ name, description, copyFromTeamId } = {}) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw httpError(400, 'Team name is required');
  let key = slugify(trimmed);
  if (!key) throw httpError(400, 'Team name must contain letters or numbers');
  if (await AdminTeam.findOne({ where: { key } })) key = `${key}-${Date.now().toString(36)}`;

  const team = await AdminTeam.create({ key, name: trimmed, description: description || null, isSystem: false, isActive: true });

  // Seed three levels. Copy grids from another team when asked, else start empty.
  let source = null;
  if (copyFromTeamId) {
    source = await AdminTeamPermission.findAll({ where: { teamId: copyFromTeamId } });
  }
  const sourceLevels = copyFromTeamId
    ? await AdminTeamLevel.findAll({ where: { teamId: copyFromTeamId }, order: [['rank', 'DESC']] })
    : [];

  const ladder = [
    { key: 'manager', name: 'Manager', rank: 3, isDefault: true, transform: (g) => g },
    { key: 'specialist', name: 'Specialist', rank: 2, isDefault: false, transform: dropDelete },
    { key: 'agent', name: 'Agent', rank: 1, isDefault: false, transform: readOnly },
  ];
  for (const l of ladder) {
    const level = await AdminTeamLevel.create({ teamId: team.id, key: l.key, name: l.name, rank: l.rank, isDefault: l.isDefault });
    // Build a base grid: from the matching source level if copying, else NONE.
    let base = Object.fromEntries(ADMIN_MODULES.map((m) => [m, NONE]));
    if (source && sourceLevels.length) {
      const match = sourceLevels.find((sl) => sl.rank === l.rank) || sourceLevels[0];
      for (const p of source.filter((p) => p.levelId === match.id)) {
        base[p.module] = { canCreate: p.canCreate, canRead: p.canRead, canUpdate: p.canUpdate, canDelete: p.canDelete };
      }
    }
    const rows = ADMIN_MODULES.map((m) => ({ teamId: team.id, levelId: level.id, module: m, ...(base[m] || NONE) }));
    await AdminTeamPermission.bulkCreate(rows);
  }
  return getTeam(team.id);
}

async function updateTeam(teamId, { name, description, isActive } = {}) {
  const team = await AdminTeam.findByPk(teamId);
  if (!team) throw httpError(404, 'Team not found');
  const patch = {};
  if (name !== undefined) { const t = String(name).trim(); if (!t) throw httpError(400, 'Team name cannot be empty'); patch.name = t; }
  if (description !== undefined) patch.description = description;
  if (isActive !== undefined) patch.isActive = !!isActive;
  await team.update(patch);
  return getTeam(teamId);
}

async function deleteTeam(teamId) {
  const team = await AdminTeam.findByPk(teamId);
  if (!team) throw httpError(404, 'Team not found');
  if (team.isSystem) throw httpError(400, 'Built-in teams cannot be deleted');
  const members = await Admin.count({ where: { teamId } });
  if (members > 0) throw httpError(400, `Move the ${members} member(s) to another team before deleting this one`);
  await AdminTeamPermission.destroy({ where: { teamId } });
  await AdminTeamLevel.destroy({ where: { teamId } });
  await team.destroy();
  return { success: true };
}

async function addLevel(teamId, { name } = {}) {
  const team = await AdminTeam.findByPk(teamId);
  if (!team) throw httpError(404, 'Team not found');
  const trimmed = String(name || '').trim();
  if (!trimmed) throw httpError(400, 'Level name is required');
  let key = slugify(trimmed);
  if (await AdminTeamLevel.findOne({ where: { teamId, key } })) key = `${key}-${Date.now().toString(36)}`;
  const top = await AdminTeamLevel.findOne({ where: { teamId }, order: [['rank', 'DESC']] });
  const level = await AdminTeamLevel.create({ teamId, key, name: trimmed, rank: (top ? top.rank : 0) + 1, isDefault: false });
  const rows = ADMIN_MODULES.map((m) => ({ teamId, levelId: level.id, module: m, ...NONE }));
  await AdminTeamPermission.bulkCreate(rows);
  return getTeam(teamId);
}

async function updateLevel(teamId, levelId, { name, isDefault } = {}) {
  const level = await AdminTeamLevel.findOne({ where: { id: levelId, teamId } });
  if (!level) throw httpError(404, 'Level not found');
  const patch = {};
  if (name !== undefined) { const t = String(name).trim(); if (!t) throw httpError(400, 'Level name cannot be empty'); patch.name = t; }
  if (isDefault) {
    await AdminTeamLevel.update({ isDefault: false }, { where: { teamId } });
    patch.isDefault = true;
  }
  await level.update(patch);
  return getTeam(teamId);
}

async function deleteLevel(teamId, levelId) {
  const level = await AdminTeamLevel.findOne({ where: { id: levelId, teamId } });
  if (!level) throw httpError(404, 'Level not found');
  const count = await AdminTeamLevel.count({ where: { teamId } });
  if (count <= 1) throw httpError(400, 'A team must keep at least one level');
  const members = await Admin.count({ where: { teamId, teamLevelId: levelId } });
  if (members > 0) throw httpError(400, `Move the ${members} member(s) off this level first`);
  await AdminTeamPermission.destroy({ where: { teamId, levelId } });
  await level.destroy();
  if (level.isDefault) {
    const next = await AdminTeamLevel.findOne({ where: { teamId }, order: [['rank', 'DESC']] });
    if (next) await next.update({ isDefault: true });
  }
  return getTeam(teamId);
}

// Save one level's grid. `permissions` is { module: {create,read,update,delete} }.
// Writes a level's grid.
//
//   permissions: { users: {create,read,update,delete}, ... }          module level
//   submodules:  { '/dashboard/users/verification': {module, ...} }   per screen
//
// A submodule entry with `inherit: true` (or simply omitted) DELETES its
// override, so a Super Admin can go back to "same as the module" — without
// that, the only way to undo a narrowing would be to tick every box back and
// the row would linger, silently overriding a later change to the module grid.
async function setLevelPermissions(teamId, levelId, permissions = {}, submodules = null) {
  const level = await AdminTeamLevel.findOne({ where: { id: levelId, teamId } });
  if (!level) throw httpError(404, 'Level not found');

  // Super admin's grid is FIXED, and refusing to write it is the honest half of
  // that. `resolveAccess` returns a full grid for `super-admin` unconditionally
  // and never reads these rows — so before this, the editor accepted changes,
  // saved them, showed them back, and they did nothing. Someone tightening super
  // admin's access would have believed they had.
  //
  // Storing them and ignoring them is the worst of both: it looks like a
  // configuration that holds, and the only way to discover it does not is to
  // rely on it. A 400 naming the reason is a worse UI and a true one.
  //
  // This is also what makes root safe to leave unconditional. The alternative —
  // honouring the grid — means a Super Admin can revoke their own team's access
  // and lock every super admin out of the panel, recoverable only through the
  // bootstrap break-glass. Root's authority should not be editable from inside
  // root.
  const team = await AdminTeam.findByPk(teamId);
  if (team && team.key === 'super-admin') {
    throw httpError(
      400,
      'Super Admin permissions are fixed and cannot be edited. This team always has full '
      + 'access to every module; the grid is not consulted for it. To limit what someone can '
      + 'do, move them to a different team.',
    );
  }

  for (const module of ADMIN_MODULES) {
    const p = permissions[module] || {};
    const values = {
      canCreate: !!p.create, canRead: !!p.read, canUpdate: !!p.update, canDelete: !!p.delete,
    };
    // The `submodule: null` clause is what makes this address the module row
    // specifically. On a database that has not had the column added yet it
    // throws, so fall back to the old three-key lookup — the table has only
    // module rows there anyway.
    let row; let created;
    try {
      [row, created] = await AdminTeamPermission.findOrCreate({
        where: { teamId, levelId, module, submodule: null }, defaults: values,
      });
    } catch (error) {
      if (!/Unknown column .*submodule/i.test(error.message || '')) throw error;
      [row, created] = await AdminTeamPermission.findOrCreate({
        where: { teamId, levelId, module }, defaults: values,
      });
    }
    if (!created) await row.update(values);
  }

  // `null` means "the caller did not send submodules at all" — leave existing
  // overrides alone. An empty OBJECT means "no overrides", which clears them.
  // Conflating the two would make any client that predates this feature wipe
  // every override the moment it saved a module grid.
  // Per-screen overrides need the column. Rejected with a clear message rather
  // than a raw SQL error, so the panel can tell an admin what to run instead of
  // showing them "Unknown column 'submodule'".
  if (submodules && typeof submodules === 'object' && Object.keys(submodules).length) {
    const [cols] = await AdminTeamPermission.sequelize.query(
      "SHOW COLUMNS FROM adminTeamPermissions LIKE 'submodule'",
    );
    if (!cols.length) {
      throw httpError(503,
        'Per-screen permissions are not available yet — the database is missing the '
        + '`submodule` column. Run: node scripts/addSubmodulePermissionColumn.js --confirm');
    }
  }

  if (submodules && typeof submodules === 'object') {
    const keep = [];
    for (const [key, cfg] of Object.entries(submodules)) {
      if (!cfg || cfg.inherit) continue;
      if (!cfg.module || !ADMIN_MODULES.includes(cfg.module)) {
        throw httpError(400, `Unknown module "${cfg.module}" for ${key}`);
      }
      const values = {
        module: cfg.module,
        canCreate: !!cfg.create, canRead: !!cfg.read, canUpdate: !!cfg.update, canDelete: !!cfg.delete,
      };
      const [row, created] = await AdminTeamPermission.findOrCreate({
        where: { teamId, levelId, submodule: key }, defaults: values,
      });
      if (!created) await row.update(values);
      keep.push(key);
    }
    // Anything not resent is an override the admin removed.
    await AdminTeamPermission.destroy({
      where: {
        teamId, levelId,
        submodule: { [Op.ne]: null, [Op.notIn]: keep.length ? keep : ['__none__'] },
      },
    });
  }

  return getTeam(teamId);
}

// ── Enforcement resolver ───────────────────────────────────────────────────────
//
// `resolveAccess(admin)` is the ONE answer to "what may this person do?", and it
// is TOTAL: it always returns a `{source, team, level, permissions}` shape and
// never null. Every caller — `requirePermission`, `GET /admin/me`, the portal's
// nav filter — reads this, so the UI and the enforcement can never disagree.
//
// WHY IT REPLACED `resolvePermission`. That function returned `null` on five
// different paths and the middleware treated all of them the same way: fall back
// to the legacy role matrix. Only ONE of them ("this admin has no team yet") is
// legitimately a legacy case. The others were denials — and turning a denial into
// a legacy grant meant **deactivating a team did not remove its members'
// access**; it quietly reverted them to whatever their old `role` integer
// allowed. The one control a Super Admin would reach for to cut off a team did
// almost nothing.
//
// So `source` is now explicit and the legacy matrix applies to exactly one case:
//
//   'bootstrap' — the break-glass account. Always everything.
//   'team'      — resolved from team + level. An all-false grid IS a deny, and
//                 is returned as one rather than falling through to anything.
//   'legacy'    — ONLY when the admin row exists and `teamId` is null, i.e. the
//                 boot migration has not reached them. Temporary by nature.
//   'none'      — explicit deny: no admin row, inactive/deleted team, or a team
//                 with no levels. Never falls back.
const NO_ACTIONS = { create: false, read: false, update: false, delete: false };

const BOOTSTRAP_EMAIL = (process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL
  || 'cocarrluxury23@gmail.com').toLowerCase();

// Every module the platform knows about, granted or denied wholesale. Used to
// build a complete grid for the bootstrap/super-admin/deny cases so callers
// never have to special-case a partial map.
const gridOf = (actions) => Object.fromEntries(ADMIN_MODULES.map((m) => [m, { ...actions }]));

// Reads permission rows, surviving a database that has not had the `submodule`
// column added yet.
//
// The model declares the column, so Sequelize selects it — and against an
// un-migrated table MySQL answers `Unknown column 'submodule'`, which takes out
// /admin/me and Teams & Access completely. A whole panel down because one
// optional column is missing is a far worse outcome than per-screen overrides
// being temporarily unavailable, so this falls back to reading the module
// columns only and says loudly what to run.
//
// Delete this once every environment has the column.
let warnedMissingSubmodule = false;
async function findPermissions(where) {
  try {
    return await AdminTeamPermission.findAll({ where });
  } catch (error) {
    if (!/Unknown column .*submodule/i.test(error.message || '')) throw error;
    if (!warnedMissingSubmodule) {
      warnedMissingSubmodule = true;
      console.error(
        '[admin-teams] `adminTeamPermissions.submodule` is missing from the database. '
        + 'Per-screen permissions are DISABLED until it is added. Run: '
        + 'node scripts/addSubmodulePermissionColumn.js --confirm',
      );
    }
    const [rows] = await AdminTeamPermission.sequelize.query(
      'SELECT id, teamId, levelId, module, canCreate, canRead, canUpdate, canDelete '
      + 'FROM adminTeamPermissions WHERE teamId = :teamId'
      + (where.levelId ? ' AND levelId = :levelId' : ''),
      { replacements: where },
    );
    // Shaped like model instances for the callers, with submodule always null
    // so everything reads as a module-level row.
    return rows.map((r) => ({ ...r, submodule: null }));
  }
}

async function resolveAccess(admin) {
  // No admins row. Previously this meant "allow, the Firebase sync hasn't caught
  // up" — but there is no bulk sync any more (rows are created by createAdmin),
  // so a Firebase user without a row is not a transitional state. It is either a
  // mistake or somebody who was given a Firebase account and nothing else, and
  // neither should carry platform-wide access.
  if (!admin) {
    return { source: 'none', team: null, level: null, permissions: gridOf(NO_ACTIONS), submodules: {} };
  }

  // Break-glass. This is what makes denying the cases above safe: the bootstrap
  // account can always reach the panel and repair a broken permission grid.
  if ((admin.email || '').toLowerCase() === BOOTSTRAP_EMAIL) {
    return { source: 'bootstrap', team: null, level: null, permissions: gridOf(FULL_ACTIONS), submodules: {} };
  }

  // NOTE: there is deliberately NO `admin.role === SUPER_ADMIN` short-circuit
  // here. It used to run before any team lookup, so a stale `admins.role` column
  // outranked the team system entirely — move a super admin onto Operations and
  // they kept full access, with nothing in the Teams & Access UI to reveal it.
  // Super admin is now recognised by TEAM (below), which is the primitive the
  // whole model is built on. `migrateAdminsToTeams` puts every role-2 admin on
  // the super-admin team, so this loses nobody.

  if (!admin.teamId) {
    // The one legitimate legacy case: not yet migrated onto a team.
    return { source: 'legacy', team: null, level: null, permissions: null, submodules: {} };
  }

  const team = await AdminTeam.findByPk(admin.teamId);
  // Deleted or DEACTIVATED team → explicit deny. This is the behaviour change
  // that gives "deactivate team" its meaning.
  if (!team || !team.isActive) {
    return { source: 'none', team: null, level: null, permissions: gridOf(NO_ACTIONS), submodules: {} };
  }
  if (team.key === 'super-admin') {
    return {
      source: 'team',
      team: { id: team.id, key: team.key, name: team.name },
      level: null,
      permissions: gridOf(FULL_ACTIONS),
      // Super admin: no overrides, because the module grid already grants
      // everything and an override could only ever take something away.
      submodules: {},
    };
  }

  let level = admin.teamLevelId ? await AdminTeamLevel.findByPk(admin.teamLevelId) : null;
  // Their level was deleted, or they never had one — fall back to the team's
  // default level rather than denying outright, since that is a configuration
  // gap rather than a decision about this person.
  if (!level || level.teamId !== team.id) {
    level = await AdminTeamLevel.findOne({ where: { teamId: team.id, isDefault: true } })
      || await AdminTeamLevel.findOne({ where: { teamId: team.id }, order: [['rank', 'DESC']] });
  }
  // A team with no levels at all cannot express any permission. Deny.
  if (!level) {
    return {
      source: 'none',
      team: { id: team.id, key: team.key, name: team.name },
      level: null,
      permissions: gridOf(NO_ACTIONS),
      submodules: {},
    };
  }

  const rows = await findPermissions({ teamId: team.id, levelId: level.id });

  // Rows split two ways: `submodule === null` is the module-level grid, anything
  // else is an override for one screen inside it.
  const byModule = new Map(rows.filter((r) => !r.submodule).map((r) => [r.module, r]));
  const asActions = (p) => (p
    ? { create: p.canCreate, read: p.canRead, update: p.canUpdate, delete: p.canDelete }
    : { ...NO_ACTIONS });

  const permissions = Object.fromEntries(ADMIN_MODULES.map((m) => {
    // A missing row means "not granted" — the grid is a whitelist.
    return [m, asActions(byModule.get(m))];
  }));

  // Keyed by the submodule (a nav route), so a client can look one up directly
  // without knowing which module owns it.
  const submodules = Object.fromEntries(
    rows.filter((r) => r.submodule).map((r) => [r.submodule, { module: r.module, ...asActions(r) }]),
  );

  return {
    source: 'team',
    team: { id: team.id, key: team.key, name: team.name },
    level: { id: level.id, key: level.key, name: level.name, rank: level.rank },
    permissions,
    submodules,
  };
}

// Back-compat shim for `requirePermission`'s existing shape: returns the action
// grid for one module, or `null` to mean "use the legacy role matrix" — which
// now happens for exactly one reason (`source === 'legacy'`) instead of five.
//
// `submodule` is optional. When given and an override exists for it, the
// override WINS outright — it is not intersected with the module grid. That is
// deliberate: the point of a per-screen permission is to be able to grant one
// screen inside a module a team otherwise cannot open, and an intersection
// could only ever take access away, never add it.
async function resolvePermission(admin, module, submodule = null) {
  const access = await resolveAccess(admin);
  if (access.source === 'legacy') return null;
  if (submodule && access.submodules && access.submodules[submodule]) {
    const o = access.submodules[submodule];
    return { create: o.create, read: o.read, update: o.update, delete: o.delete };
  }
  return access.permissions[module] || { ...NO_ACTIONS };
}

module.exports = {
  seedAdminTeams, migrateAdminsToTeams,
  listTeams, getTeam, modules,
  createTeam, updateTeam, deleteTeam,
  addLevel, updateLevel, deleteLevel, setLevelPermissions,
  // resolveAccess is the one to use. resolvePermission is the per-module shim
  // requirePermission still calls; both go through the same resolution.
  resolveAccess, resolvePermission,
};
