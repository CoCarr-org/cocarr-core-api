#!/usr/bin/env node
// Wipes the database back to empty, then lets the Firebase syncs repopulate
// users and admins on the next boot.
//
//   railway run node scripts/resetDatabase.js --dry-run
//   railway run node scripts/resetDatabase.js --confirm
//   railway run node scripts/resetDatabase.js --confirm --keep-config
//
// THIS DESTROYS EVERY ROW. There is no undo. Intended for development only.
//
// --keep-config preserves the reference/config tables the app needs in order to
// function at all — cities, brands, models, settings, protection plans,
// membership types. Without cities nobody can book; without settings every fee
// reads as zero. Wiping those AND disabling the seeders leaves an app that
// looks fine and silently misprices everything.
const db = require('../src/configs/db');
require('../src/models/association');

const dryRun = process.argv.includes('--dry-run');
const confirmed = process.argv.includes('--confirm');
const keepConfig = process.argv.includes('--keep-config');

// Reference/config data — preserved by --keep-config.
const CONFIG_TABLES = new Set([
  'cities', 'brands', 'models', 'settings', 'platformSettings',
  'protectionplans', 'membershiptypes', 'rolePermissions',
]);

// Never truncated: these are recreated from Firebase on the next boot anyway,
// but listing them explicitly documents the intent.
const REPOPULATED_FROM_FIREBASE = new Set(['users', 'admins']);

(async () => {
  if (!confirmed && !dryRun) {
    console.error('Refusing to run without --confirm.');
    console.error('  --dry-run      show what would be emptied');
    console.error('  --confirm      empty the tables (DESTROYS ALL DATA)');
    console.error('  --keep-config  preserve cities / brands / settings');
    process.exit(1);
  }

  try {
    await db.authenticate();
    const [rows] = await db.query('SHOW TABLES');
    const tables = rows.map((r) => Object.values(r)[0]).sort();

    // Count first so the report is meaningful rather than a bare table list.
    const counts = {};
    for (const t of tables) {
      try {
        const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
        counts[t] = Number(n);
      } catch { counts[t] = null; }
    }

    const target = tables.filter((t) => !(keepConfig && CONFIG_TABLES.has(t)));
    const preserved = tables.filter((t) => keepConfig && CONFIG_TABLES.has(t));

    console.log(`${tables.length} tables, ${Object.values(counts).reduce((a, b) => a + (b || 0), 0)} rows total\n`);
    console.log('WILL BE EMPTIED:');
    target.forEach((t) => console.log(
      `  ${t.padEnd(28)} ${String(counts[t] ?? '?').padStart(7)} rows`
      + (REPOPULATED_FROM_FIREBASE.has(t) ? '   ← repopulated from Firebase on next boot' : ''),
    ));
    if (preserved.length) {
      console.log('\nPRESERVED (--keep-config):');
      preserved.forEach((t) => console.log(`  ${t.padEnd(28)} ${String(counts[t] ?? '?').padStart(7)} rows`));
    }

    if (dryRun || !confirmed) {
      console.log(`\n${dryRun ? 'Dry run' : 'Not confirmed'} — nothing deleted.`);
      console.log('Re-run with --confirm to empty these tables. THIS CANNOT BE UNDONE.');
      if (!keepConfig) {
        console.log('\n⚠️  Without --keep-config this also wipes cities, brands and settings.');
        console.log('   If the boot seeders are disabled (SEED_DEFAULTS=false) the app will come');
        console.log('   up with no cities (nothing bookable) and every fee reading zero.');
      }
      process.exit(0);
    }

    // FK checks off: truncating in dependency order across ~60 tables is
    // fragile and one new association would break it. Restored in `finally`
    // so a mid-run failure can't leave the connection with them disabled.
    console.log('\nEmptying…');
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    let cleared = 0;
    let failed = 0;
    try {
      for (const t of target) {
        try {
          await db.query(`TRUNCATE TABLE \`${t}\``);
          cleared += 1;
        } catch (error) {
          console.error(`  FAILED ${t}: ${error?.parent?.sqlMessage || error.message}`);
          failed += 1;
        }
      }
    } finally {
      await db.query('SET FOREIGN_KEY_CHECKS = 1');
    }

    console.log(`\nEmptied ${cleared} table(s)${failed ? `, ${failed} failed` : ''}.`);
    console.log('\nNext: restart the backend. On boot it will');
    console.log('  • pull users from the consumer Firebase project  → users');
    console.log('  • pull admins from the admin Firebase project    → admins (all role 1)');
    console.log('  • promote the bootstrap account to super admin   (runs after admin sync)');
    process.exit(failed ? 1 : 0);
  } catch (error) {
    console.error('Reset failed:',
      error?.parent?.sqlMessage || error?.message || error?.name || String(error));
    process.exit(1);
  }
})();
