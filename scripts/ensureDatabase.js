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
//
// ...EXCEPT IN `--bootstrap`, WHICH IS THE SAME ACT MADE SAFE TO AUTOMATE.
//
// The manual gate exists to stop ONE thing: a typo in DB_NAME silently creating
// an empty schema beside the real data. That risk disappears if the name is not
// a free variable — so `--bootstrap` creates the schema only when DB_NAME
// matches the name PINNED IN THIS REPO (package.json -> config.expectedDbName),
// and only where the environment has opted in with ALLOW_SCHEMA_BOOTSTRAP=true.
//
// WHY IT IS NEEDED AT ALL. The MySQL service creates exactly one schema on a
// fresh volume — whatever MYSQL_DATABASE names (on this project: `cocarr_iam`).
// Every other service's schema was created by hand and is declared nowhere, so
// a volume reset, a restored backup, or a brand-new environment comes up
// missing them. `cocarr_workspace` disappeared exactly this way and its deploy
// could not recover on its own; `cocarr_core` has the same exposure.
//
// IT IS OPT-IN PER ENVIRONMENT. Where real data lives, a missing schema means
// something has gone badly wrong and the deploy SHOULD stop — recreating it
// empty and letting migrations rebuild the tables yields a healthy-looking
// service with no data that nobody notices until they go looking for a row.
const mysql = require('mysql2/promise');
const pkg = require('../package.json');

const args = process.argv.slice(2);
const bootstrap = args.includes('--bootstrap');
const dryRun = !bootstrap && (args.includes('--dry-run') || !args.includes('--confirm'));

// The name this service is supposed to use, committed and reviewable. An env
// var that disagrees with it is a misconfiguration, not an instruction.
const EXPECTED_DB_NAME = pkg.config?.expectedDbName || null;

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

  // Every refusal exits 0: this runs FIRST in a `&&` pre-deploy chain, and a
  // non-zero here would fail the deploy with "bootstrap not enabled", which is
  // not the problem. `migrate:up`'s preflight is what classifies the real
  // failure into an actionable message.
  if (bootstrap) {
    if (String(process.env.ALLOW_SCHEMA_BOOTSTRAP) !== 'true') {
      console.log('[bootstrap] ALLOW_SCHEMA_BOOTSTRAP is not true — not creating anything.');
      process.exit(0);
    }
    if (!EXPECTED_DB_NAME) {
      console.log('[bootstrap] No config.expectedDbName in package.json — refusing to guess a schema name.');
      process.exit(0);
    }
    if (DB_NAME !== EXPECTED_DB_NAME) {
      console.error(`[bootstrap] REFUSING: DB_NAME='${DB_NAME}' but this service expects '${EXPECTED_DB_NAME}'.`);
      console.error('[bootstrap] Fix the environment variable — do not create a schema under the wrong name.');
      process.exit(0);
    }
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
    // Non-zero here would stop the `&&` chain before migrate:up, whose preflight
    // classifies the failure properly. Let it report.
    process.exit(bootstrap ? 0 : 1);
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
    if (bootstrap) {
      // Loud on purpose. An automated create is the one outcome nobody watches,
      // and "the schema was missing and we made a new empty one" is something
      // whoever reads this log later needs to be able to find.
      console.log(`[bootstrap] '${DB_NAME}' did not exist and was created EMPTY. Migrations will build it from zero.`);
      console.log('[bootstrap] If this schema was expected to hold data, that data is gone — investigate.');
    }
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
