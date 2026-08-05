const RolePermission = require('../models/rolePermission');
const { ADMIN_ROLE_LABELS, ADMIN_ROLE_DESCRIPTIONS, ADMIN_ROLE_ORDER } = require('../utils/adminRoles');
const { ADMIN_MODULE_LIST, ADMIN_MODULES, ACTIONS, defaultsFor } = require('../utils/adminPermissions');
const { logActivity } = require('./activityLogService');

const FLAG = { create: 'canCreate', read: 'canRead', update: 'canUpdate', delete: 'canDelete' };

const rowToPerm = (row) => ({
  create: !!row.canCreate,
  read: !!row.canRead,
  update: !!row.canUpdate,
  delete: !!row.canDelete,
});

// Effective permissions for one (role, module): a stored row wins, otherwise
// the spec-seeded default applies.
async function getEffectivePermission(role, module) {
  const row = await RolePermission.findOne({ where: { role, module } });
  return row ? rowToPerm(row) : { ...defaultsFor(role, module) };
}

// Full matrix — every role x every module, always populated so the UI never
// has an undefined cell.
async function getPermissionMatrix() {
  const rows = await RolePermission.findAll();
  const stored = {};
  rows.forEach((r) => { stored[`${r.role}:${r.module}`] = rowToPerm(r); });

  const roles = ADMIN_ROLE_ORDER.map((role) => {
    const permissions = {};
    ADMIN_MODULES.forEach((module) => {
      permissions[module] = stored[`${role}:${module}`] || { ...defaultsFor(role, module) };
    });
    return {
      role,
      name: ADMIN_ROLE_LABELS[role],
      description: ADMIN_ROLE_DESCRIPTIONS[role],
      permissions,
    };
  });

  return { roles, modules: ADMIN_MODULE_LIST, actions: ACTIONS };
}

// `permissions`: [{role, module, create, read, update, delete}]. Upserts each
// cell and logs only what actually changed.
async function updatePermissionMatrix(permissions, actingAdmin) {
  const changes = [];

  for (const cell of permissions || []) {
    const { role, module } = cell;
    if (!ADMIN_MODULES.includes(module)) continue;
    if (!ADMIN_ROLE_ORDER.includes(Number(role))) continue;

    const next = {};
    ACTIONS.forEach((action) => { next[FLAG[action]] = !!cell[action]; });

    const existing = await RolePermission.findOne({ where: { role, module } });
    const before = existing ? rowToPerm(existing) : { ...defaultsFor(role, module) };
    const after = { create: next.canCreate, read: next.canRead, update: next.canUpdate, delete: next.canDelete };

    const diff = ACTIONS.filter((a) => before[a] !== after[a]);
    if (diff.length === 0) continue;

    if (existing) await existing.update(next);
    else await RolePermission.create({ role, module, ...next });

    changes.push({ role, module, changed: diff, from: before, to: after });
  }

  if (changes.length > 0) {
    await logActivity({
      adminId: actingAdmin?.id,
      adminName: actingAdmin?.name,
      action: 'update',
      entityType: 'Permission',
      entityId: null,
      changes: { cells: changes },
    });
  }

  return getPermissionMatrix();
}

module.exports = { getPermissionMatrix, updatePermissionMatrix, getEffectivePermission };
