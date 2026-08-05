#!/usr/bin/env node
// Drops the legacy referral columns from `users` after the backfill has been
// verified.
//
//   railway run node scripts/dropLegacyReferralColumns.js --dry-run
//   railway run node scripts/dropLegacyReferralColumns.js --confirm
//
// THIS IS IRREVERSIBLE. Dropping a column destroys the data in it. Take a
// database backup first, and run scripts/backfillReferralCodes.js beforehand.
//
// Refuses to run unless every user that has a code has a matching row in
// referral_codes — a partial backfill plus a drop is unrecoverable data loss.
// (referralCodeUsed is not gated: an orphaned code that never matched a
// referrer carries no reward and is safe to discard.)
const db = require('../src/configs/db');
require('../src/models/association');

const dryRun = process.argv.includes('--dry-run');
const confirmed = process.argv.includes('--confirm');

const TABLE = 'users';
const COLUMNS = ['referralCode', 'referralCodeUsed'];

(async () => {
  try {
    await db.authenticate();

    const [tables] = await db.query('SHOW TABLES');
    const have = new Set(tables.map((r) => Object.values(r)[0]));
    if (!have.has('referral_codes')) {
      console.error('BLOCKED: `referral_codes` does not exist — run the backfill first.');
      process.exit(1);
    }

    const [cols] = await db.query(`SHOW COLUMNS FROM \`${TABLE}\``);
    const present = new Set(cols.map((c) => c.Field));
    if (!present.has('referralCode') && !present.has('referralCodeUsed')) {
      console.log('Columns already dropped — nothing to do.');
      process.exit(0);
    }

    console.log('Verifying the backfill before dropping anything…\n');
    // Owners with a code but NO row in referral_codes.
    const [rows] = await db.query(`
      SELECT COUNT(*) AS missing FROM \`${TABLE}\` u
      WHERE u.referralCode IS NOT NULL AND u.referralCode <> ''
        AND NOT EXISTS (SELECT 1 FROM referral_codes rc WHERE rc.userId = u.id)
    `);
    const missing = Number(rows[0].missing);
    if (missing > 0) {
      console.error(`  BLOCKED  ${missing} user(s) have a code but no referral_codes row.`);
      console.error('\nRefusing to drop. Run scripts/backfillReferralCodes.js first, then re-check.');
      process.exit(1);
    }
    console.log('  ok       every code is backfilled into referral_codes');

    console.log(`\nColumns to drop: ${TABLE}.${COLUMNS.join(', ')}`);
    if (dryRun || !confirmed) {
      console.log(`\n${dryRun ? 'Dry run' : 'Not confirmed'} — nothing dropped.`);
      console.log('Take a database backup, then re-run with --confirm to drop these columns permanently.');
      process.exit(0);
    }

    console.log('\nDropping…');
    for (const column of COLUMNS) {
      if (!present.has(column)) { console.log(`  skip  ${TABLE}.${column} (already gone)`); continue; }
      try {
        await db.query(`ALTER TABLE \`${TABLE}\` DROP COLUMN \`${column}\``);
        console.log(`  DROPPED ${TABLE}.${column}`);
      } catch (error) {
        console.error(`  FAILED  ${TABLE}.${column}: ${error?.parent?.sqlMessage || error.message}`);
      }
    }

    console.log('\nDone. The columns are already removed from the User model, so');
    console.log('db.sync({alter:true}) will not re-add them on the next boot.');
    process.exit(0);
  } catch (error) {
    console.error('Failed:', error?.parent?.sqlMessage || error.message);
    process.exit(1);
  }
})();
