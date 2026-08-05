/**
 * Read-only. Confirms the live schema matches what the app expects on the
 * points that have actually broken before.
 *
 *   railway run node scripts/verifySchema.js
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../src/configs/db');

const MODEL_DIR = path.join(__dirname, '..', 'src', 'models');
for (const f of fs.readdirSync(MODEL_DIR).filter((x) => x.endsWith('.js') && x !== 'association.js')) {
  require(path.join(MODEL_DIR, f));
}
require(path.join(MODEL_DIR, 'association.js'));

// Columns that reference users.id must be varchar, not char(36). A mismatch
// here is what aborted the schema sync.
const USER_FK_CHECKS = [
  ['conversations', 'hostId'],
  ['conversations', 'userId'],
  ['messages', 'senderId'],
  ['bookings', 'userId'],
  ['wallets', 'userId'],
  ['hosts', 'userId'],
  ['kycDocuments', 'userId'],
  ['panCards', 'userId'],
  ['drivingLicences', 'userId'],
];

// Tables the app queries on paths that used to 500 with "doesn't exist".
const CRITICAL = [
  'users', 'admins', 'settings', 'cities', 'brands', 'bookings', 'vehicles',
  'settlements', 'hostPayoutLedgers', 'hostPayoutAccounts', 'refundRequests',
  'kycDocuments', 'panCards', 'drivingLicences', 'vehicleRcDocuments',
  'otherDocuments', 'campaigns', 'damages', 'disputes', 'protectionplans',
  'membershiptypes', 'rolePermissions', 'activityLogs',
];

(async () => {
  let problems = 0;
  try {
    await db.authenticate();
    const dbName = db.config.database;
    console.log(`\nDatabase: ${dbName}\n`);

    const [rows] = await db.query(
      'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = :db',
      { replacements: { db: dbName } },
    );
    const tables = new Set(rows.map((r) => r.t));

    // 1. Every registered model has a table.
    const names = Object.keys(db.models).sort();
    const tableOf = (m) => {
      const t = db.models[m].getTableName();
      return typeof t === 'string' ? t : t.tableName;
    };
    const missing = names.filter((n) => !tables.has(tableOf(n)));
    console.log(`Models: ${names.length}   Tables: ${tables.size}`);
    if (missing.length) {
      problems += missing.length;
      console.log(`  FAIL  ${missing.length} model(s) with no table: ${missing.map(tableOf).join(', ')}`);
    } else {
      console.log('  ok    every registered model has a table');
    }

    // 2. Critical tables specifically.
    const absent = CRITICAL.filter((t) => !tables.has(t));
    if (absent.length) {
      problems += absent.length;
      console.log(`  FAIL  critical tables absent: ${absent.join(', ')}`);
    } else {
      console.log(`  ok    all ${CRITICAL.length} critical tables present`);
    }

    // 3. users.id type, and every column that references it.
    const colType = async (table, column) => {
      const [r] = await db.query(
        `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = :db AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
        { replacements: { db: dbName, table, column } },
      );
      return r.length ? r[0].t : null;
    };

    const userIdType = await colType('users', 'id');
    console.log(`\nusers.id = ${userIdType}`);
    for (const [table, column] of USER_FK_CHECKS) {
      if (!tables.has(table)) { console.log(`  skip  ${table}.${column} (no table)`); continue; }
      const t = await colType(table, column);
      const ok = t && t.startsWith('varchar');
      if (!ok) problems += 1;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${table}.${column} = ${t}`);
    }

    // 4. The verificationStatus ENUM must hold the new four-state vocabulary.
    const vs = await colType('users', 'verificationStatus');
    console.log(`\nusers.verificationStatus = ${vs}`);
    const expected = ['incomplete', 'pending', 'active', 'rejected', 'suspended'];
    const retired = ['not_started', 'in_progress', 'verified'];
    const missingVals = expected.filter((v) => !String(vs).includes(`'${v}'`));
    const retiredVals = retired.filter((v) => new RegExp(`'${v}'`).test(String(vs)));
    if (missingVals.length) { problems += 1; console.log(`  FAIL  missing values: ${missingVals.join(', ')}`); }
    else console.log('  ok    all four states present');
    if (retiredVals.length) console.log(`  warn  retired values still declared: ${retiredVals.join(', ')}`);

    // 5. Legacy inline document columns should be gone from users and vehicles.
    for (const [table, like] of [['users', "'kyc%','pan%','license%'"], ['vehicles', "'vehicleRc%','rcVerif%'"]]) {
      if (!tables.has(table)) continue;
      const [legacy] = await db.query(
        `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = :db AND TABLE_NAME = '${table}'
            AND (${like.split(',').map((p) => `COLUMN_NAME LIKE ${p}`).join(' OR ')})`,
        { replacements: { db: dbName } },
      );
      console.log(legacy.length
        ? `\n  warn  ${table} still has legacy columns: ${legacy.map((r) => r.c).join(', ')}`
        : `\n  ok    ${table} has no legacy document columns`);
    }

    // 6. Config the app cannot function without.
    console.log('');
    for (const [table, why] of [
      ['cities', 'nothing is bookable without at least one'],
      ['settings', 'every fee reads as zero without these'],
      ['admins', 'nobody can administer the panel'],
    ]) {
      const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
      const ok = Number(n) > 0;
      if (!ok) problems += 1;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${table} = ${n} row(s)${ok ? '' : ` — ${why}`}`);
    }

    console.log(problems ? `\n${problems} PROBLEM(S) FOUND\n` : '\nAll checks passed.\n');
    process.exit(problems ? 1 : 0);
  } catch (error) {
    console.error('\nVerification failed:', error?.parent?.sqlMessage || error.message);
    process.exit(1);
  }
})();
