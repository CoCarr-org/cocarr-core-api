#!/usr/bin/env node
// Wipe the database, then repopulate users and admins from Firebase.
//
//   railway run node scripts/freshStart.js --dry-run
//   railway run node scripts/freshStart.js --confirm
//   railway run node scripts/freshStart.js --confirm --keep-config
//
// DESTROYS EVERY ROW. Development only.
//
// Exists as one script because the ORDER matters and is easy to get wrong:
// admin sync inserts everyone at the basic role, and the bootstrap step then
// promotes the one super admin. Run bootstrap first and the sync has nothing
// to promote; skip it entirely and nobody can administer the panel.
const db = require('../src/configs/db');
require('../src/models/association');

const dryRun = process.argv.includes('--dry-run');
const confirmed = process.argv.includes('--confirm');
const keepConfig = process.argv.includes('--keep-config');

const CONFIG_TABLES = new Set([
  'cities', 'brands', 'models', 'settings', 'platformSettings',
  'protectionplans', 'membershiptypes', 'rolePermissions',
]);

const step = (n, label) => console.log(`\n[${n}] ${label}`);

(async () => {
  // Guard first — before any connection — so a mistaken invocation says why it
  // stopped instead of failing on an unrelated connection error.
  if (!confirmed && !dryRun) {
    console.error('Refusing to run without --confirm.');
    console.error('  --dry-run      preview without changing anything');
    console.error('  --confirm      wipe and repopulate (DESTROYS ALL DATA)');
    console.error('  --keep-config  preserve cities / brands / settings');
    process.exit(1);
  }

  try {
    await db.authenticate();

    // ── 1. Wipe ──
    step(1, dryRun ? 'Would empty the database' : 'Emptying the database');
    const [rows] = await db.query('SHOW TABLES');
    const tables = rows.map((r) => Object.values(r)[0]).sort();
    const target = tables.filter((t) => !(keepConfig && CONFIG_TABLES.has(t)));

    let totalRows = 0;
    for (const t of target) {
      try {
        const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
        totalRows += Number(n);
      } catch { /* table unreadable, ignore for the count */ }
    }
    console.log(`    ${target.length} tables, ~${totalRows} rows`
      + (keepConfig ? `  (${tables.length - target.length} config tables preserved)` : ''));

    if (!dryRun) {
      // FK checks off — truncating ~60 tables in dependency order is fragile
      // and one new association would break it. Restored in `finally` so a
      // failure mid-run can't leave the connection with them disabled.
      await db.query('SET FOREIGN_KEY_CHECKS = 0');
      try {
        for (const t of target) {
          try { await db.query(`TRUNCATE TABLE \`${t}\``); }
          catch (e) { console.error(`    FAILED ${t}: ${e?.parent?.sqlMessage || e.message}`); }
        }
      } finally {
        await db.query('SET FOREIGN_KEY_CHECKS = 1');
      }
      console.log('    emptied');
    }

    // ── 2. Bootstrap super admin ──
    step(2, 'Promoting the bootstrap super admin');
    if (dryRun) {
      const { BOOTSTRAP_EMAIL } = require('../src/services/bootstrapAdminService');
      console.log(`    would ensure ${BOOTSTRAP_EMAIL} exists and holds role 2`);
    } else {
      const { ensureBootstrapSuperAdmin, BOOTSTRAP_EMAIL } = require('../src/services/bootstrapAdminService');
      await ensureBootstrapSuperAdmin();
      console.log(`    ${BOOTSTRAP_EMAIL} is super admin (role 2)`);
    }

    // ── 5. Verify the role assignment actually landed ──
    // On a wiped database every admin is a fresh insert at role 1, so this is
    // always clean. It matters when the script is run WITHOUT --confirm-wipe
    // on an existing database: those admins keep whatever role they had, which
    // is not what "assign basic role to everyone" implies.
    if (!dryRun) {
      step(3, 'Checking roles');
      const Admin = require('../src/models/admin');
      const { BOOTSTRAP_EMAIL } = require('../src/services/bootstrapAdminService');
      const admins = await Admin.findAll({ attributes: ['id', 'name', 'email', 'role'] });
      const odd = admins.filter(
        (a) => a.role !== 1 && String(a.email || '').toLowerCase() !== BOOTSTRAP_EMAIL,
      );
      console.log(`    ${admins.length} admin(s): `
        + `${admins.filter((a) => a.role === 1).length} basic, `
        + `${admins.filter((a) => a.role === 2).length} super`);
      if (odd.length) {
        console.log('    ⚠️  not on the basic role and not the bootstrap account:');
        odd.forEach((a) => console.log(`       ${a.email || a.id} → role ${a.role}`));
        console.log('       (expected on an existing database — a wipe makes every admin a fresh insert)');
      }
    }

    console.log(`\n${dryRun ? 'DRY RUN — nothing was changed.' : 'Done.'}`);
    if (!dryRun && !keepConfig && process.env.SEED_DEFAULTS === 'false') {
      console.log('\n⚠️  Config tables were wiped and SEED_DEFAULTS=false, so there are now');
      console.log('   no cities (nothing is bookable) and no fee settings (every fee reads zero).');
      console.log('   Add them from the admin panel, or unset SEED_DEFAULTS and restart once.');
    }
    process.exit(0);
  } catch (error) {
    console.error('\nFresh start failed:',
      error?.parent?.sqlMessage || error?.message || error?.name || String(error));
    process.exit(1);
  }
})();
