#!/usr/bin/env node
/**
 * Adds `adminTeamPermissions.submodule` and swaps its unique index.
 *
 *   node scripts/addSubmodulePermissionColumn.js --dry-run
 *   node scripts/addSubmodulePermissionColumn.js --confirm
 *
 * ── Why this exists rather than relying on db.sync({alter:true}) ──
 * The boot-time alter adds a plain new column happily enough, but this change
 * also REPLACES a unique index — `(teamId, levelId, module)` becomes
 * `(teamId, levelId, module, submodule)`. Sequelize's alter does not reliably
 * drop the superseded one: it tries to ADD the new index while the old one is
 * still there, and on MySQL that either fails outright or quietly accumulates a
 * duplicate. A failed index change aborts the whole sync pass, and every model
 * after it never gets its table or its new columns — which is precisely how
 * this repo has lost tables before (see "db.sync failures are silent" in
 * CLAUDE.md).
 *
 * The symptom that sends people here is `Unknown column 'submodule'` on any
 * Teams & Access read, because the model declares a column the table lacks.
 *
 * Safe to re-run: every step checks first and skips if already done. It only
 * ever touches this one table.
 */
require('dotenv').config();

const db = require('../src/configs/db');

const TABLE = 'adminTeamPermissions';
const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const DRY = args.includes('--dry-run') || !CONFIRM;

const q = (sql, opts) => db.query(sql, opts);

async function main() {
  await db.authenticate();
  const dbName = db.config.database;
  console.log(`\n${DRY ? 'DRY RUN — nothing will be changed' : 'APPLYING CHANGES'}`);
  console.log(`database: ${dbName}\n`);

  // ── Does the table exist at all? ──
  const [tables] = await q(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    { replacements: [dbName, TABLE] },
  );
  if (!tables.length) {
    console.log(`✗ Table \`${TABLE}\` does not exist.`);
    console.log('  It is created by db.sync on boot, or by scripts/syncNewTables.js.');
    console.log('  Run that first — there is nothing here to alter.\n');
    await db.close();
    process.exit(1);
  }

  // ── 1. The column ──
  const [cols] = await q(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    { replacements: [dbName, TABLE, 'submodule'] },
  );

  if (cols.length) {
    console.log('1. `submodule` column — already present, skipping.');
  } else if (DRY) {
    console.log(`1. WOULD ADD: ALTER TABLE \`${TABLE}\` ADD COLUMN \`submodule\` VARCHAR(255) NULL;`);
  } else {
    // NULL-able with no default, so every existing row becomes a module-level
    // row — which is exactly what they already were.
    await q(`ALTER TABLE \`${TABLE}\` ADD COLUMN \`submodule\` VARCHAR(255) NULL`);
    console.log('1. `submodule` column — ADDED.');
  }

  // ── 2. The unique index ──
  // Find any unique index over exactly (teamId, levelId, module) so it can be
  // replaced. Matched by its COLUMNS rather than by name, because Sequelize
  // auto-names these and the name differs between environments.
  const [idx] = await q(
    `SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND NON_UNIQUE = 0
      GROUP BY INDEX_NAME`,
    { replacements: [dbName, TABLE] },
  );

  const OLD = 'teamId,levelId,module';
  const NEW = 'teamId,levelId,module,submodule';
  const stale = idx.filter((i) => i.cols === OLD);
  const correct = idx.find((i) => i.cols === NEW);

  console.log(`\n   existing unique indexes: ${idx.length ? idx.map((i) => `${i.INDEX_NAME}(${i.cols})`).join(', ') : 'none'}`);

  if (correct) {
    console.log(`2. Unique index on (${NEW}) — already present as \`${correct.INDEX_NAME}\`.`);
  } else if (DRY) {
    console.log(`2. WOULD ADD: unique index on (${NEW}).`);
  } else {
    await q(`ALTER TABLE \`${TABLE}\` ADD UNIQUE INDEX \`atp_team_level_module_sub\` (\`teamId\`,\`levelId\`,\`module\`,\`submodule\`)`);
    console.log(`2. Unique index on (${NEW}) — ADDED.`);
  }

  // Dropped only AFTER the replacement exists, so the table is never
  // momentarily without a uniqueness guarantee on those three columns.
  if (stale.length) {
    if (DRY) {
      console.log(`3. WOULD DROP superseded index(es): ${stale.map((i) => i.INDEX_NAME).join(', ')}`);
      console.log('   (the old 3-column unique key now blocks legitimate rows: a module row');
      console.log('    and its per-screen overrides share the same first three columns)');
    } else {
      for (const i of stale) {
        await q(`ALTER TABLE \`${TABLE}\` DROP INDEX \`${i.INDEX_NAME}\``);
        console.log(`3. Dropped superseded index \`${i.INDEX_NAME}\`.`);
      }
    }
  } else {
    console.log('3. No superseded 3-column unique index to drop.');
  }

  // ── 4. Report ──
  const [[{ total }]] = await q(`SELECT COUNT(*) AS total FROM \`${TABLE}\``);
  console.log(`\n${TABLE}: ${total} permission row(s).`);

  if (DRY) {
    console.log('\nNothing was changed. Re-run with --confirm to apply.\n');
  } else {
    console.log('\nDone. Restart the API so Sequelize sees the new column.\n');
  }

  await db.close();
}

main().catch(async (error) => {
  console.error('\nFailed:', error.message);
  if (/Duplicate key name/i.test(error.message)) {
    console.error('The index already exists under a different name — inspect with:');
    console.error(`  SHOW INDEX FROM ${TABLE};`);
  }
  try { await db.close(); } catch { /* already closed */ }
  process.exit(1);
});
