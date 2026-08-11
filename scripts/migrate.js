#!/usr/bin/env node
// Migration CLI — the ONLY thing that changes this service's schema.
//
//   node scripts/migrate.js status      what is applied, what is pending
//   node scripts/migrate.js up          apply everything pending
//   node scripts/migrate.js down        roll back exactly ONE migration
//   node scripts/migrate.js pending     exit 1 if anything is pending (for CI)
//
// RUN THIS AS A RELEASE STEP, NOT AT BOOT. Two reasons, both of which bite in
// production and neither of which is obvious:
//
//   1. Replicas race. Two containers starting together would run the same
//      migration concurrently — MySQL DDL is not transactional, so you get a
//      half-applied change and no way to tell which won.
//   2. A failed migration must fail the DEPLOY, keeping the previous container
//      serving. A service that boots anyway is running new code against an old
//      schema, which is worse than being down: it looks healthy and writes to
//      columns that may not exist.
//
// On Railway that means a pre-deploy/release command; in CI, a job that runs
// before the new revision receives traffic.
const db = require('../src/configs/db');
const { migrateUp, buildMigrator, status } = require('../src/db/migrator');
const { preflight } = require('../src/configs/dbPreflight');

const cmd = process.argv[2] || 'status';

const log = {
  info: (m) => console.log(m),
  error: (m) => console.error(m),
};

(async () => {
  // Same classification the service uses at boot — so `migrate` fails with
  // "the schema does not exist, run ensureDatabase" rather than a driver error.
  const pre = await preflight(db, log);
  if (!pre.ok) process.exit(1);

  try {
    if (cmd === 'status' || cmd === 'pending') {
      const { executed, pending } = await status();
      console.log(`\nApplied (${executed.length}):`);
      executed.forEach((n) => console.log(`  ok       ${n}`));
      console.log(`\nPending (${pending.length}):`);
      pending.forEach((n) => console.log(`  PENDING  ${n}`));
      if (!pending.length) console.log('  (none — schema is up to date)');
      // `pending` is the CI gate: a build whose migrations have not been
      // applied to the target environment must not be promoted.
      process.exit(cmd === 'pending' && pending.length ? 1 : 0);
    }

    if (cmd === 'up') {
      const applied = await migrateUp({ log });
      console.log(applied.length ? `\nApplied ${applied.length}: ${applied.join(', ')}` : '\nNothing to apply.');
      process.exit(0);
    }

    if (cmd === 'down') {
      // ONE step, never `--all`. A pipeline that can roll back the whole
      // history in one command will eventually do so by accident.
      const umzug = buildMigrator({ log });
      const reverted = await umzug.down();
      console.log(reverted.length ? `Rolled back: ${reverted.map((m) => m.name).join(', ')}` : 'Nothing to roll back.');
      process.exit(0);
    }

    console.error(`Unknown command '${cmd}'. Use: status | up | down | pending`);
    process.exit(1);
  } catch (error) {
    console.error(`\nMigration failed: ${error?.parent?.sqlMessage || error.message}`);
    console.error('The schema is at the last successfully applied migration; nothing after it ran.');
    process.exit(1);
  } finally {
    await db.close().catch(() => {});
  }
})();
