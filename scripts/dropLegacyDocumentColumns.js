#!/usr/bin/env node
// Drops the inline document columns from `users` and `vehicles` after the
// backfill has been verified.
//
//   railway run node scripts/dropLegacyDocumentColumns.js --dry-run
//   railway run node scripts/dropLegacyDocumentColumns.js --confirm
//
// THIS IS IRREVERSIBLE. Dropping a column destroys the data in it. Take a
// database backup first.
//
// Refuses to run unless every owner that has data in an inline column also has
// a corresponding row in the new table — that check is the whole point, since
// a partial backfill plus a drop is unrecoverable data loss.
const db = require('../src/configs/db');
require('../src/models/association');

const dryRun = process.argv.includes('--dry-run');
const confirmed = process.argv.includes('--confirm');

const PLAN = [
  {
    table: 'users',
    columns: ['kycNumber', 'kycRef', 'kycName', 'kycImage', 'kycVerified',
              'panNumber', 'panName', 'panImage', 'panVerified',
              'panProviderStatus', 'panProviderName', 'panProviderCheckedAt',
              'panNameMatch', 'panNameMismatchReason',
              'licenseNumber', 'licenseName', 'licenseFrontImage', 'licenseBackImage', 'licenseVerified'],
    // Each inline column must be covered by a row in the new table.
    checks: [
      { label: 'Aadhaar/KYC', inline: "kycNumber IS NOT NULL OR kycImage IS NOT NULL",
        table: 'kycDocuments', join: 'userId' },
      { label: 'PAN', inline: "panNumber IS NOT NULL OR panImage IS NOT NULL",
        table: 'panCards', join: 'userId' },
      { label: 'Licence', inline: "licenseNumber IS NOT NULL OR licenseFrontImage IS NOT NULL",
        table: 'drivingLicences', join: 'userId' },
    ],
  },
  {
    table: 'vehicles',
    columns: ['vehicleRcNumber', 'vehicleRcImage', 'vehicleRcVerified',
              'rcVerified', 'rcVerificationId'],
    checks: [
      { label: 'Vehicle RC', inline: "vehicleRcNumber IS NOT NULL OR vehicleRcImage IS NOT NULL",
        table: 'vehicleRcDocuments', join: 'vehicleId' },
    ],
  },
];

(async () => {
  try {
    await db.authenticate();

    const [tables] = await db.query('SHOW TABLES');
    const have = new Set(tables.map((r) => Object.values(r)[0]));

    console.log('Verifying the backfill before dropping anything…\n');
    let blocked = false;

    for (const group of PLAN) {
      for (const check of group.checks) {
        if (!have.has(check.table)) {
          console.error(`  BLOCKED  ${check.label}: table \`${check.table}\` does not exist — run the backfill first`);
          blocked = true;
          continue;
        }
        // Owners with inline data but NO row in the new table.
        const [rows] = await db.query(`
          SELECT COUNT(*) AS missing FROM \`${group.table}\` t
          WHERE (${check.inline})
            AND NOT EXISTS (
              SELECT 1 FROM \`${check.table}\` d WHERE d.\`${check.join}\` = t.id
            )
        `);
        const missing = Number(rows[0].missing);
        if (missing > 0) {
          console.error(`  BLOCKED  ${check.label}: ${missing} row(s) have inline data but no document record`);
          blocked = true;
        } else {
          console.log(`  ok       ${check.label}: fully backfilled`);
        }
      }
    }

    if (blocked) {
      console.error('\nRefusing to drop. Run scripts/backfillDocumentTables.js first, then re-check.');
      process.exit(1);
    }

    console.log('\nColumns to drop:');
    for (const g of PLAN) console.log(`  ${g.table}: ${g.columns.join(', ')}`);

    if (dryRun || !confirmed) {
      console.log(`\n${dryRun ? 'Dry run' : 'Not confirmed'} — nothing dropped.`);
      console.log('Take a database backup, then re-run with --confirm to drop these columns permanently.');
      process.exit(0);
    }

    console.log('\nDropping…');
    for (const group of PLAN) {
      const [cols] = await db.query(`SHOW COLUMNS FROM \`${group.table}\``);
      const present = new Set(cols.map((c) => c.Field));
      for (const column of group.columns) {
        if (!present.has(column)) { console.log(`  skip  ${group.table}.${column} (already gone)`); continue; }
        try {
          await db.query(`ALTER TABLE \`${group.table}\` DROP COLUMN \`${column}\``);
          console.log(`  DROPPED ${group.table}.${column}`);
        } catch (error) {
          console.error(`  FAILED  ${group.table}.${column}: ${error?.parent?.sqlMessage || error.message}`);
        }
      }
    }

    console.log('\nDone. NOTE: index.js runs db.sync({alter:true}), which will try to');
    console.log('re-add any column still declared on a model — remove them from the');
    console.log('model files too, or they will come back empty on the next boot.');
    process.exit(0);
  } catch (error) {
    console.error('Failed:', error?.parent?.sqlMessage || error.message);
    process.exit(1);
  }
})();
