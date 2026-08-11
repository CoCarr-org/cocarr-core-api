#!/usr/bin/env node
// Compares a LIVE database against the schema this codebase's models describe.
//
//   node scripts/diffSchema.js                 # compare DB_NAME against the models
//   node scripts/diffSchema.js --against other # compare DB_NAME against another schema
//
// WHY THIS EXISTS, AND WHY IT MATTERS BEFORE THE BASELINE IS TRUSTED.
//
// The baseline migration creates each table ONLY IF ABSENT. That is what makes
// it safe to run against every environment — but it also means it never looks
// at a table that already exists. If a deployed database has drifted from the
// models, the baseline records "schema is at baseline" and the drift becomes
// permanent and invisible.
//
// Drift is not hypothetical here. db.sync({alter:true}) DROPS columns no longer
// declared on a model, and this schema has had 19 columns removed from `users`
// and 5 from `vehicles` in past migrations. Whether production matches the
// models today is a question only a comparison can answer.
//
// So: run this against a RESTORED COPY OF PRODUCTION before merging the
// baseline. Anything it reports is a decision to make deliberately — either the
// models are wrong, or production needs a migration to catch up.
//
// It is READ-ONLY. It creates a scratch schema to materialise the models, and
// drops it again.
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const againstIdx = args.indexOf('--against');
const AGAINST = againstIdx >= 0 ? args[againstIdx + 1] : null;

const { DB_HOST, DB_USER, DB_PASS, DB_NAME } = process.env;
const DB_PORT = Number(process.env.DB_PORT || 3306);
const SCRATCH = `__diff_models_${process.pid}`;

const normalise = (ddl) => ddl
  .replace(/ AUTO_INCREMENT=\d+/g, '')
  // Constraint names are auto-generated and differ per database; comparing them
  // reports noise, not drift.
  .replace(/CONSTRAINT `[^`]+`/g, 'CONSTRAINT `_`')
  .trim();

async function tablesOf(conn, schema) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [schema],
  );
  return rows.map((r) => r.t).filter((t) => t !== 'schemaMigrations');
}

async function ddlOf(conn, schema, table) {
  const [[row]] = await conn.query(`SHOW CREATE TABLE \`${schema}\`.\`${table}\``);
  return normalise(row['Create Table']);
}

// Column-level detail, because "this table differs" is not actionable.
async function columnsOf(conn, schema, table) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME n, COLUMN_TYPE t, IS_NULLABLE nul, COLUMN_DEFAULT d
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [schema, table],
  );
  return new Map(rows.map((r) => [r.n, `${r.t} ${r.nul === 'YES' ? 'NULL' : 'NOT NULL'}`]));
}

(async () => {
  if (!DB_HOST || !DB_NAME) {
    console.error('Set DB_HOST, DB_NAME, DB_USER, DB_PASS.');
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS, multipleStatements: false,
  });

  let reference = AGAINST;
  try {
    if (!reference) {
      // Materialise what the MODELS describe, in a throwaway schema.
      await conn.query(`CREATE DATABASE \`${SCRATCH}\``);
      reference = SCRATCH;
      const modelsDir = path.join(__dirname, '../src/models');
      // Every model file explicitly — the require chain reaches only about half
      // of them, which is how tables have gone missing before.
      fs.readdirSync(modelsDir)
        .filter((f) => f.endsWith('.js') && !['index.js', 'association.js'].includes(f))
        .forEach((f) => require(path.join(modelsDir, f)));
      require(path.join(modelsDir, 'association'));
      const db = require('../src/configs/db');
      // Point the model layer at the scratch schema for the build only.
      db.config.database = SCRATCH;
      await db.query(`USE \`${SCRATCH}\``);
      await db.sync();
      await db.close();
      console.log(`Built the models' schema in ${SCRATCH}.\n`);
    }

    const [live, ref] = await Promise.all([tablesOf(conn, DB_NAME), tablesOf(conn, reference)]);
    const liveSet = new Set(live);
    const refSet = new Set(ref);

    const onlyLive = live.filter((t) => !refSet.has(t));
    const onlyRef = ref.filter((t) => !liveSet.has(t));
    const shared = live.filter((t) => refSet.has(t));

    console.log(`Comparing  ${DB_NAME}  <->  ${reference}\n`);

    if (onlyRef.length) {
      console.log(`MISSING from ${DB_NAME} (${onlyRef.length}) — the models expect these:`);
      onlyRef.forEach((t) => console.log(`  - ${t}`));
      console.log('');
    }
    if (onlyLive.length) {
      // Not necessarily wrong: could be a table the models no longer declare,
      // which alter-sync would NOT have dropped (it drops columns, not tables).
      console.log(`ONLY in ${DB_NAME} (${onlyLive.length}) — not described by any model:`);
      onlyLive.forEach((t) => console.log(`  + ${t}`));
      console.log('');
    }

    let differing = 0;
    for (const t of shared) {
      const [a, b] = await Promise.all([ddlOf(conn, DB_NAME, t), ddlOf(conn, reference, t)]);
      if (a === b) continue;
      differing += 1;
      const [ca, cb] = await Promise.all([columnsOf(conn, DB_NAME, t), columnsOf(conn, reference, t)]);
      console.log(`~ ${t}`);
      cb.forEach((def, col) => {
        if (!ca.has(col)) console.log(`    missing column: ${col}  (${def})`);
        else if (ca.get(col) !== def) console.log(`    ${col}: live=${ca.get(col)}  models=${def}`);
      });
      ca.forEach((def, col) => {
        if (!cb.has(col)) console.log(`    extra column:   ${col}  (${def})  — no model declares this`);
      });
    }

    const clean = !onlyRef.length && !onlyLive.length && !differing;
    console.log(clean
      ? `\nNo drift. ${shared.length} tables match.`
      : `\n${onlyRef.length} missing, ${onlyLive.length} extra, ${differing} differing (of ${shared.length} shared).`);
    console.log(clean
      ? 'Safe to baseline this environment.'
      : 'Reconcile these BEFORE trusting the baseline here — it skips tables that already exist,\n'
        + 'so anything above becomes permanent and invisible once the baseline is recorded.');
    process.exit(clean ? 0 : 1);
  } finally {
    if (!AGAINST) await conn.query(`DROP DATABASE IF EXISTS \`${SCRATCH}\``).catch(() => {});
    await conn.end().catch(() => {});
  }
})();
