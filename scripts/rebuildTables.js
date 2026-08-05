/**
 * Drops and recreates named tables from their models.
 *
 *   railway run node scripts/rebuildTables.js offerUsages --dry-run
 *   railway run node scripts/rebuildTables.js offerUsages --confirm
 *   railway run node scripts/rebuildTables.js conversations messages --confirm
 *
 * REFUSES IF ANY NAMED TABLE HAS ROWS. This only exists for tables whose
 * COLUMN TYPES are wrong, which `alter:true` cannot always fix in place —
 * MySQL will not change a column that a foreign key depends on, so the alter
 * fails, and because a failed alter aborts the whole sync pass every model
 * after it silently misses its columns too.
 *
 * Dropping and recreating sidesteps that, but only because the table is empty.
 * With data, alter the column by hand after dropping the FK.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const tables = args.filter((a) => !a.startsWith('--'));

if (!tables.length || (!DRY_RUN && !CONFIRM)) {
  console.error(
    'Usage: node scripts/rebuildTables.js <table> [<table>…] --dry-run|--confirm\n',
  );
  process.exit(1);
}

const db = require('../src/configs/db');

const MODEL_DIR = path.join(__dirname, '..', 'src', 'models');
for (const f of fs.readdirSync(MODEL_DIR).filter((x) => x.endsWith('.js') && x !== 'association.js')) {
  require(path.join(MODEL_DIR, f));
}
require(path.join(MODEL_DIR, 'association.js'));

const modelForTable = (table) => Object.values(db.models).find((m) => {
  const t = m.getTableName();
  return (typeof t === 'string' ? t : t.tableName) === table;
});

(async () => {
  try {
    await db.authenticate();
    console.log('');

    const targets = [];
    for (const table of tables) {
      const model = modelForTable(table);
      if (!model) {
        console.error(`No model maps to table "${table}".`);
        process.exit(1);
      }
      const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
      console.log(`${table}: ${n} row(s)`);
      if (Number(n) > 0) {
        console.error(`\nREFUSING — ${table} contains data. Rebuilding would destroy it.`);
        process.exit(1);
      }
      targets.push({ table, model });
    }

    if (DRY_RUN) {
      console.log(`\nDRY RUN — would drop and recreate: ${tables.join(', ')}\n`);
      process.exit(0);
    }

    // FK checks off for the drop — another table may reference these, and the
    // point of the exercise is that those constraints are currently wrong.
    // Restored in `finally` so a failure cannot leave them disabled.
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const { table } of targets) {
        await db.query(`DROP TABLE IF EXISTS \`${table}\``);
        console.log(`   dropped ${table}`);
      }
      for (const { table, model } of targets) {
        await model.sync();
        console.log(`   created ${table}`);
      }
    } finally {
      await db.query('SET FOREIGN_KEY_CHECKS = 1');
    }

    console.log('');
    for (const { table } of targets) {
      const [c] = await db.query(
        `SELECT COLUMN_NAME AS n, COLUMN_TYPE AS t FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = :db AND TABLE_NAME = :table ORDER BY ORDINAL_POSITION`,
        { replacements: { db: db.config.database, table } },
      );
      console.log(`${table}: ${c.map((x) => `${x.n} ${x.t}`).join(', ')}`);
    }
    console.log('');
    process.exit(0);
  } catch (error) {
    console.error('\nFAILED:', error?.parent?.sqlMessage || error.message);
    process.exit(1);
  }
})();
