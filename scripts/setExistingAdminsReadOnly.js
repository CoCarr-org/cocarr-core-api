/**
 * ONE-OFF: demote every existing admin to the read-only Analytics Viewer
 * role, except the bootstrap super admin.
 *
 * This is deliberately NOT run on boot — it's a one-time migration for the
 * cut-over to enforced RBAC. Running it on every deploy would re-demote
 * anyone who had since been legitimately promoted.
 *
 *   node scripts/setExistingAdminsReadOnly.js --dry-run   # show, change nothing
 *   node scripts/setExistingAdminsReadOnly.js             # apply
 *
 * Env lives on Railway: railway run node scripts/setExistingAdminsReadOnly.js --dry-run
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const DRY_RUN = process.argv.includes('--dry-run');

const REQUIRED = ['DB_NAME', 'DB_USER', 'DB_PASS'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[admins-readonly] Missing required env: ${missing.join(', ')}\n` +
    '            Run on Railway: railway run node scripts/setExistingAdminsReadOnly.js --dry-run');
  process.exit(1);
}

const db = require('../src/configs/db');
const Admin = require('../src/models/admin');
const { ADMIN_ROLES, ADMIN_ROLE_LABELS } = require('../src/utils/adminRoles');
const { BOOTSTRAP_EMAIL } = require('../src/services/bootstrapAdminService');

const READ_ONLY = ADMIN_ROLES.ANALYTICS_VIEWER;

(async () => {
  await db.authenticate();
  const admins = await Admin.findAll();
  console.log(`[admins-readonly] ${admins.length} admin(s) found${DRY_RUN ? ' (dry run)' : ''}.`);

  let changed = 0;
  let skipped = 0;

  for (const a of admins) {
    // Never touch the break-glass account — demoting it would defeat the
    // entire safety mechanism.
    if ((a.email || '').toLowerCase() === BOOTSTRAP_EMAIL) {
      console.log(`[admins-readonly] SKIP  ${a.email} — bootstrap super admin`);
      skipped += 1;
      continue;
    }
    if (a.role === READ_ONLY) {
      skipped += 1;
      continue;
    }
    console.log(`[admins-readonly] ${DRY_RUN ? 'WOULD SET' : 'SET'} ${a.email}: ${ADMIN_ROLE_LABELS[a.role] || a.role} -> ${ADMIN_ROLE_LABELS[READ_ONLY]}`);
    if (!DRY_RUN) await a.update({ role: READ_ONLY });
    changed += 1;
  }

  console.log(`[admins-readonly] done — ${changed} demoted, ${skipped} unchanged` +
    (DRY_RUN ? ' (dry run: nothing written)' : ''));
})()
  .catch((err) => { console.error('[admins-readonly] failed:', err); process.exitCode = 1; })
  .finally(async () => { await db.close().catch(() => {}); });
