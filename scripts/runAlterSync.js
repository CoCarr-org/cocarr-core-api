/**
 * Runs exactly the `db.sync({alter:true})` that index.js runs at boot, with
 * every model registered, and reports whether it completes.
 *
 *   railway run node scripts/runAlterSync.js --dry-run
 *   railway run node scripts/runAlterSync.js --confirm
 *
 * This is the direct way to prove a boot will now succeed rather than aborting
 * partway and silently leaving models without their columns.
 *
 * `alter:true` DOES DROP COLUMNS that are no longer declared on a model — that
 * is how the legacy inline document columns (kycNumber, licenseNumber, …) get
 * removed. Any data in them is lost. That is intended here; do not run this
 * against a database whose inline document data has not been backfilled into
 * the document tables.
 *
 * Also worth knowing: repeated `alter:true` runs accumulate duplicate indexes
 * on MySQL until a table trips the 64-key limit. Use this deliberately, not
 * habitually.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');

if (!DRY_RUN && !CONFIRM) {
  console.error('Refusing to run without --dry-run or --confirm\n');
  process.exit(1);
}

const db = require('../src/configs/db');

const MODEL_DIR = path.join(__dirname, '..', 'src', 'models');
for (const f of fs.readdirSync(MODEL_DIR).filter((x) => x.endsWith('.js') && x !== 'association.js')) {
  require(path.join(MODEL_DIR, f));
}
require(path.join(MODEL_DIR, 'association.js'));

const cols = async (table) => {
  const [r] = await db.query(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = :db AND TABLE_NAME = :table`,
    { replacements: { db: db.config.database, table } },
  );
  return new Set(r.map((x) => x.c));
};

(async () => {
  try {
    await db.authenticate();
    console.log(`\nDatabase: ${db.config.database}`);
    console.log(`Models registered: ${Object.keys(db.models).length}\n`);

    // Report what the alter will do to `users`, the table that has actually
    // been losing columns.
    const before = await cols('users');
    const declared = new Set(Object.keys(db.models.user.rawAttributes));
    const willAdd = [...declared].filter((c) => !before.has(c));
    const willDrop = [...before].filter((c) => !declared.has(c));

    console.log(`users: ${before.size} column(s) now`);
    if (willAdd.length) console.log(`  + add:  ${willAdd.join(', ')}`);
    if (willDrop.length) console.log(`  - DROP: ${willDrop.join(', ')}   (data in these is lost)`);
    if (!willAdd.length && !willDrop.length) console.log('  already matches the model');

    if (DRY_RUN) {
      console.log('\nDRY RUN — no sync performed.\n');
      process.exit(0);
    }

    console.log('\nRunning db.sync({alter:true})…');
    const started = Date.now();
    await db.sync({ alter: true });
    console.log(`   completed in ${Math.round((Date.now() - started) / 1000)}s — no abort.\n`);

    const after = await cols('users');
    const stillMissing = [...declared].filter((c) => !after.has(c));
    const stillLegacy = [...after].filter((c) => !declared.has(c));

    console.log(`users: ${after.size} column(s) now`);
    console.log(stillMissing.length
      ? `  FAIL  still missing: ${stillMissing.join(', ')}`
      : '  ok    every declared column is present');
    console.log(stillLegacy.length
      ? `  warn  undeclared columns remain: ${stillLegacy.join(', ')}`
      : '  ok    no undeclared columns remain');

    console.log('');
    process.exit(stillMissing.length ? 1 : 0);
  } catch (error) {
    console.error('\nALTER SYNC FAILED:', error?.parent?.sqlMessage || error.message);
    console.error('This is the same failure the server hits at boot — every model after');
    console.error('the failure point silently never gets its table or new columns.\n');
    process.exit(1);
  }
})();
