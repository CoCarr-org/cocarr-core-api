#!/usr/bin/env node
// Creates this service's SCHEMA if it does not exist. Nothing else.
//
//   railway run node scripts/ensureDatabase.js --dry-run
//   railway run node scripts/ensureDatabase.js --confirm
//
// Topology: ONE MySQL instance, ONE SCHEMA PER SERVICE. Each service owns its
// own schema and never touches another's — see docs/DATABASE.md.
//
// WHY THIS IS A SCRIPT AND NOT BOOT BEHAVIOUR.
//
// Creating the schema automatically at startup would turn a TYPO into a silent
// disaster: point DB_NAME at `cocarr_iamm`, and instead of failing loudly the
// service would create an empty schema, sync a full set of tables into it and
// come up perfectly healthy with no data. Every list is empty, nothing errors,
// and the real database is sitting untouched next to it. That is a far worse
// outcome than a refusal, and it is close to what already happened once.
//
// So creating a schema is always a deliberate act with `--confirm`.
//
// SAFETY
// - CREATE DATABASE IF NOT EXISTS only. It never drops, never alters, and does
//   nothing at all when the schema is already there.
// - It creates NO TABLES. Run the schema step afterwards (this service:
//   scripts/syncTables.js) and then the seed.
// - It prints the other schemas on the instance first. If your data is sitting
//   in one of them under a different name, the fix is to correct DB_NAME —
//   NOT to create a new empty schema beside it.
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || !args.includes('--confirm');

const { DB_HOST, DB_USER, DB_PASS, DB_NAME } = process.env;
const DB_PORT = process.env.DB_PORT || 3306;

// Only ever interpolated into `CREATE DATABASE`, so it must be a plain
// identifier — never a client-supplied value, but cheap to assert.
const VALID_NAME = /^[A-Za-z0-9_]+$/;

(async () => {
  const missing = ['DB_HOST', 'DB_USER', 'DB_NAME'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (!VALID_NAME.test(DB_NAME)) {
    console.error(`DB_NAME '${DB_NAME}' is not a plain identifier — refusing.`);
    process.exit(1);
  }

  let conn;
  try {
    // Connect with NO database selected — that is the whole point; you cannot
    // create a schema from inside the schema that does not exist.
    conn = await mysql.createConnection({
      host: DB_HOST, port: Number(DB_PORT), user: DB_USER, password: DB_PASS,
    });
  } catch (error) {
    console.error(`Could not connect to ${DB_HOST}:${DB_PORT} — ${error.message}`);
    process.exit(1);
  }

  try {
    const [rows] = await conn.query('SHOW DATABASES');
    const names = rows.map((r) => Object.values(r)[0]);
    const system = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);
    const theirs = names.filter((n) => !system.has(n));

    console.log(`Schemas on ${DB_HOST}: ${theirs.join(', ') || '(none)'}\n`);

    if (names.includes(DB_NAME)) {
      const [[{ n }]] = await conn.query(
        'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?', [DB_NAME],
      );
      console.log(`'${DB_NAME}' already exists with ${n} table(s). Nothing to do.`);
      if (n === 0) console.log('It is EMPTY — run the schema step next.');
      process.exit(0);
    }

    // The warning that matters. A populated schema under another name means
    // DB_NAME is wrong, and creating a new one strands the real data.
    if (theirs.length) {
      console.log(`'${DB_NAME}' does NOT exist.`);
      console.log('Before creating it, check none of the schemas above is this service\'s data');
      console.log('under a different name — if it is, fix DB_NAME instead of creating a new one.\n');
    }

    if (dryRun) {
      console.log(`WOULD create schema '${DB_NAME}' (re-run with --confirm).`);
      process.exit(0);
    }

    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`CREATED empty schema '${DB_NAME}'.`);
    console.log('It has no tables yet. Next:');
    console.log('  node scripts/syncTables.js --dry-run   then without the flag');
    console.log('  node scripts/seedTaxonomy.js --confirm');
    process.exit(0);
  } catch (error) {
    console.error(`Failed: ${error.sqlMessage || error.message}`);
    process.exit(1);
  } finally {
    await conn.end().catch(() => {});
  }
})();
