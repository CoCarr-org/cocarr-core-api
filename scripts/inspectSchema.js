/**
 * Read-only schema audit.
 *
 * Loads every model the app registers, then compares that set against the
 * tables actually present, and reports:
 *   - models with NO table          (the `railway.settlements` failure mode)
 *   - tables with no model          (leftovers)
 *   - row counts per existing table
 *   - the verificationStatus column's real type
 *
 * Changes nothing. Safe to run against anything.
 *
 *   railway run node scripts/inspectSchema.js
 */
require('dotenv').config();

const db = require('../src/configs/db');

// Registering the models is the whole point — requiring the association file
// pulls in the full graph the app uses at boot.
require('../src/models/association');

// Models that are only reachable through a service require chain at boot are
// listed explicitly, exactly as index.js does. A model that is not registered
// before db.sync runs simply never gets a table.
const EXTRA_MODELS = [
  'settlement', 'refundRequest', 'campaign',
  'kycDocument', 'panCard', 'drivingLicence', 'vehicleRcDocument', 'otherDocument',
  'hostPayoutAccount', 'hostPayoutLedger', 'activityLog', 'rolePermission',
  'ticket', 'ticketMessage', 'banner', 'faq', 'page', 'featureFlag',
  'apiKey', 'ipWhitelist', 'loginHistory', 'webhookLog', 'messageTemplate',
  'platformSetting', 'dispute',
];
for (const name of EXTRA_MODELS) {
  try { require(`../src/models/${name}`); }
  catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}

(async () => {
  try {
    await db.authenticate();
    const dbName = db.config.database;
    console.log(`\nDatabase: ${dbName}\n`);

    const [tableRows] = await db.query(
      'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = :db',
      { replacements: { db: dbName } },
    );
    const tables = new Set(tableRows.map((r) => r.t));

    const models = db.models;
    const modelNames = Object.keys(models).sort();

    const missing = [];
    const present = [];
    for (const name of modelNames) {
      const table = models[name].getTableName();
      const tableName = typeof table === 'string' ? table : table.tableName;
      (tables.has(tableName) ? present : missing).push({ name, tableName });
    }

    console.log(`Models registered: ${modelNames.length}`);
    console.log(`Tables present:    ${tables.size}\n`);

    if (missing.length) {
      console.log(`!! ${missing.length} MODEL(S) HAVE NO TABLE — these will throw on first query:`);
      for (const m of missing) console.log(`     ${m.name.padEnd(28)} -> ${m.tableName}`);
      console.log('\n   Fix: railway run node scripts/syncNewTables.js\n');
    } else {
      console.log('Every registered model has a table.\n');
    }

    const modelTables = new Set(present.map((p) => p.tableName));
    const orphans = [...tables].filter((t) => !modelTables.has(t) && t !== 'SequelizeMeta');
    if (orphans.length) {
      console.log(`Tables with no model (${orphans.length}): ${orphans.join(', ')}\n`);
    }

    // Row counts, so "empty database" can be confirmed rather than assumed.
    let total = 0;
    const nonEmpty = [];
    for (const t of [...tables].sort()) {
      const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      total += Number(n);
      if (Number(n) > 0) nonEmpty.push(`${t}=${n}`);
    }
    console.log(`Total rows across all tables: ${total}`);
    console.log(nonEmpty.length ? `Non-empty: ${nonEmpty.join(', ')}\n` : 'Every table is empty.\n');

    // The ENUM narrowing is the one migration that can abort a whole sync pass.
    if (tables.has('users')) {
      const [cols] = await db.query(
        `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = :db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'verificationStatus'`,
        { replacements: { db: dbName } },
      );
      console.log(cols.length
        ? `users.verificationStatus: ${cols[0].t}`
        : 'users.verificationStatus: column does not exist yet');
    }

    // Legacy inline document columns should be gone.
    if (tables.has('users')) {
      const [legacy] = await db.query(
        `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = :db AND TABLE_NAME = 'users'
            AND (COLUMN_NAME LIKE 'kyc%' OR COLUMN_NAME LIKE 'pan%' OR COLUMN_NAME LIKE 'license%')`,
        { replacements: { db: dbName } },
      );
      console.log(legacy.length
        ? `Legacy inline document columns still on users: ${legacy.map((r) => r.c).join(', ')}`
        : 'No legacy inline document columns on users.');
    }

    console.log('');
    process.exit(0);
  } catch (error) {
    console.error('\nInspection failed:', error?.parent?.sqlMessage || error.message);
    process.exit(1);
  }
})();
