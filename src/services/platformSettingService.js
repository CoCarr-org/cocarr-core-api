const PlatformSetting = require('../models/platformSetting');
const { PLATFORM_SETTING_DEFAULTS } = require('../utils/platformSettingDefaults');
const { CustomError } = require('../middlewares/error');
const { logActivity } = require('./activityLogService');

// Reads a group, creating any rows defined in the defaults that don't exist
// yet. Lazy seeding means adding a key to the defaults file is enough — no
// migration, no boot-time seeding pass.
async function getGroup(group) {
  const defaults = PLATFORM_SETTING_DEFAULTS[group];
  if (!defaults) throw new CustomError(`Unknown settings group: ${group}`, 404);

  const existing = await PlatformSetting.findAll({ where: { group } });
  const byKey = {};
  existing.forEach((r) => { byKey[r.key] = r; });

  const missing = defaults.filter((d) => !byKey[d.key]);
  if (missing.length) {
    const created = await PlatformSetting.bulkCreate(missing.map((d) => ({ ...d, group })));
    created.forEach((r) => { byKey[r.key] = r; });
  }

  // Return in the order declared in the defaults file, not insertion order.
  return { group, settings: defaults.map((d) => byKey[d.key]).filter(Boolean) };
}

async function updateGroup(group, values, actingAdmin) {
  const defaults = PLATFORM_SETTING_DEFAULTS[group];
  if (!defaults) throw new CustomError(`Unknown settings group: ${group}`, 404);

  await getGroup(group); // ensure rows exist before updating
  const rows = await PlatformSetting.findAll({ where: { group } });
  const changes = {};

  for (const row of rows) {
    if (values[row.key] === undefined) continue;
    const next = String(values[row.key]);
    if (row.value === next) continue;
    changes[row.key] = { from: row.value, to: next };
    await row.update({ value: next });
  }

  if (Object.keys(changes).length) {
    await logActivity({
      adminId: actingAdmin?.id,
      adminName: actingAdmin?.name,
      action: 'update',
      entityType: `Settings:${group}`,
      entityId: group,
      changes,
    });
  }

  return getGroup(group);
}

module.exports = { getGroup, updateGroup };
