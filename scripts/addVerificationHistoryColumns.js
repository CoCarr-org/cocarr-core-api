#!/usr/bin/env node
/**
 * Adds the resubmission-history columns to `users`.
 *
 *   node scripts/addVerificationHistoryColumns.js --dry-run
 *   node scripts/addVerificationHistoryColumns.js --confirm
 *
 * `verificationAttempts`, `previousRejectionReason`, `previousRejectedAt`.
 *
 * These are plain nullable columns with no index change, so `db.sync({alter:true})`
 * would normally add them on boot. This script exists because the boot alter is
 * all-or-nothing across every model — if it aborts for an unrelated reason (see
 * "db.sync failures are silent" in CLAUDE.md), these silently never appear, and
 * the symptom is `Unknown column 'previousRejectionReason'` on the admin review
 * screen rather than anything pointing at the real cause.
 *
 * Read-only unless --confirm. Safe to re-run; each column is checked first.
 */
require('dotenv').config();

const db = require('../src/configs/db');

const TABLE = 'users';
const COLUMNS = [
  // Counted at submission, not at rejection: it is the number of submissions a
  // reviewer has had to look at.
  ['verificationAttempts', 'INT NOT NULL DEFAULT 0'],
  // Survives a resubmission, unlike verificationRejectionReason which is the
  // CURRENT state and is cleared the moment the user edits their details.
  ['previousRejectionReason', 'TEXT NULL'],
  ['previousRejectedAt', 'DATETIME NULL'],
];

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const DRY = args.includes('--dry-run') || !CONFIRM;

async function main() {
  await db.authenticate();
  const dbName = db.config.database;
  console.log(`\n${DRY ? 'DRY RUN — nothing will be changed' : 'APPLYING CHANGES'}`);
  console.log(`database: ${dbName}\n`);

  const [existing] = await db.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    { replacements: [dbName, TABLE] },
  );
  const have = new Set(existing.map((c) => c.COLUMN_NAME));

  let added = 0;
  for (const [name, type] of COLUMNS) {
    if (have.has(name)) {
      console.log(`· ${name} — already present, skipping.`);
      continue;
    }
    const sql = `ALTER TABLE \`${TABLE}\` ADD COLUMN \`${name}\` ${type}`;
    if (DRY) {
      console.log(`· WOULD RUN: ${sql};`);
    } else {
      await db.query(sql);
      console.log(`· ${name} — ADDED.`);
    }
    added += 1;
  }

  // Existing rejected users have no history, because it was never recorded.
  // Backfilling `previousRejectionReason` from the current one is correct for
  // them: it IS the reason they were last rejected for, and copying it means a
  // reviewer sees the history for anyone who resubmits from here on rather than
  // only for rejections issued after this deploy.
  if (!DRY && added > 0) {
    const [res] = await db.query(
      `UPDATE \`${TABLE}\`
          SET previousRejectionReason = verificationRejectionReason,
              previousRejectedAt = verificationReviewedAt
        WHERE verificationStatus = 'rejected'
          AND verificationRejectionReason IS NOT NULL
          AND previousRejectionReason IS NULL`,
    );
    console.log(`\nBackfilled history for ${res?.affectedRows ?? 0} currently-rejected user(s).`);
  } else if (DRY) {
    const [[{ n }]] = await db.query(
      `SELECT COUNT(*) AS n FROM \`${TABLE}\`
        WHERE verificationStatus = 'rejected' AND verificationRejectionReason IS NOT NULL`,
    );
    console.log(`\nWOULD BACKFILL history for ${n} currently-rejected user(s).`);
  }

  console.log(DRY
    ? '\nNothing was changed. Re-run with --confirm to apply.\n'
    : '\nDone. Restart the API so Sequelize sees the new columns.\n');

  await db.close();
}

main().catch(async (error) => {
  console.error('\nFailed:', error.message);
  try { await db.close(); } catch { /* already closed */ }
  process.exit(1);
});
