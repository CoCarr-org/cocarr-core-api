/**
 * Collapses the old verificationStatus values onto the new four-state model.
 *
 *   not_started ─┐
 *   in_progress ─┴─> incomplete
 *   verified ──────> active
 *
 * MUST run BEFORE the next boot's db.sync({alter:true}).
 *
 * The model no longer declares 'not_started', 'in_progress' or 'verified', so
 * alter-sync will try to narrow the ENUM. MySQL refuses to drop an ENUM value
 * that rows still hold — and because a failed alter-sync aborts the whole
 * pass, every model after `user` silently never gets its table (see the
 * "db.sync failures are silent" note in CLAUDE.md). Running this first is what
 * stops that.
 *
 * Uses raw SQL on purpose: the Sequelize model already has the NEW enum, so
 * reading or writing the old values through it would be rejected client-side
 * before the query was ever sent.
 *
 *   railway run node scripts/migrateVerificationStatus.js --dry-run
 *   railway run node scripts/migrateVerificationStatus.js --confirm
 */
require('dotenv').config();

const DRY_RUN = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');

if (!DRY_RUN && !CONFIRM) {
  console.error(
    'Refusing to run without a flag.\n' +
    '  --dry-run   show what would change\n' +
    '  --confirm   apply the change\n',
  );
  process.exit(1);
}

const db = require('../src/configs/db');

// old value -> new value
const MAPPING = {
  not_started: 'incomplete',
  in_progress: 'incomplete',
  verified: 'active',
};

(async () => {
  try {
    await db.authenticate();

    // Counted with a raw query for the same reason the update is raw.
    const [rows] = await db.query(
      'SELECT verificationStatus AS status, COUNT(*) AS n FROM users GROUP BY verificationStatus',
    );

    console.log('\nCurrent distribution:');
    if (!rows.length) console.log('  (no users)');
    for (const r of rows) {
      const target = MAPPING[r.status];
      console.log(`  ${String(r.status ?? 'NULL').padEnd(12)} ${String(r.n).padStart(6)}` +
        (target ? `  ->  ${target}` : '   (unchanged)'));
    }

    const needing = rows.filter((r) => MAPPING[r.status]);
    if (!needing.length) {
      console.log('\nNothing to migrate — no rows hold a retired value.\n');
      process.exit(0);
    }

    if (DRY_RUN) {
      const total = needing.reduce((sum, r) => sum + Number(r.n), 0);
      console.log(`\nDRY RUN — ${total} row(s) would be rewritten. Nothing changed.\n`);
      process.exit(0);
    }

    // Widen the column to plain VARCHAR first. Writing 'incomplete' into the
    // column while it is still the OLD ENUM would be rejected — the new value
    // is not one of its members. Leaving it as VARCHAR is fine: the next
    // alter-sync narrows it to the new ENUM, which now succeeds because no row
    // holds a retired value.
    await db.query('ALTER TABLE users MODIFY COLUMN verificationStatus VARCHAR(32)');

    let changed = 0;
    for (const [from, to] of Object.entries(MAPPING)) {
      const [, meta] = await db.query(
        'UPDATE users SET verificationStatus = :to WHERE verificationStatus = :from',
        { replacements: { to, from } },
      );
      const n = meta?.affectedRows ?? 0;
      if (n) console.log(`  ${from} -> ${to}: ${n} row(s)`);
      changed += n;
    }

    console.log(`\nDone — ${changed} row(s) migrated.`);
    console.log('The column is VARCHAR(32) for now; the next boot\'s alter-sync narrows it to the new ENUM.\n');
    process.exit(0);
  } catch (error) {
    console.error('\nMigration failed:', error?.parent?.sqlMessage || error.message);
    process.exit(1);
  }
})();
