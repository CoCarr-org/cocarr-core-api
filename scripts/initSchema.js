/**
 * Creates the full schema from the models, then seeds config and the bootstrap
 * super admin. For a database that has no tables at all.
 *
 *   railway run node scripts/initSchema.js --dry-run
 *   railway run node scripts/initSchema.js --confirm
 *
 * Why this exists rather than "just boot the app":
 *
 * `index.js` runs `db.sync({alter:true})`, and which models are REGISTERED by
 * the time it runs depends on which service requires happen to have pulled them
 * in. That indirection is exactly how `railway.settlements` went missing before
 * — a model nothing had required yet simply never got a table, and the server
 * came up healthy until something queried it.
 *
 * This script removes the guesswork: it requires EVERY file in src/models, so
 * registration cannot depend on a require chain. `association.js` is required
 * last, since it wires relations between models that must already be defined.
 *
 * Uses plain `db.sync()` — no `alter`, no `force`. On an empty database that is
 * all that is needed, and it will never drop a column or reindex a table that
 * already exists. Sequelize orders the CREATEs by association so foreign keys
 * resolve.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');

if (!DRY_RUN && !CONFIRM) {
  console.error(
    'Refusing to run without a flag.\n' +
    '  --dry-run   report what is missing, change nothing\n' +
    '  --confirm   create missing tables, then seed config + bootstrap admin\n',
  );
  process.exit(1);
}

const db = require('../src/configs/db');

// ── Register every model, unconditionally ──────────────────────────────────
const MODEL_DIR = path.join(__dirname, '..', 'src', 'models');
const files = fs.readdirSync(MODEL_DIR)
  .filter((f) => f.endsWith('.js') && f !== 'association.js')
  .sort();

const failed = [];
for (const file of files) {
  try { require(path.join(MODEL_DIR, file)); }
  catch (error) { failed.push(`${file}: ${error.message}`); }
}

// Relations last — they reference models that must already be defined.
try { require(path.join(MODEL_DIR, 'association.js')); }
catch (error) { failed.push(`association.js: ${error.message}`); }

(async () => {
  try {
    await db.authenticate();
    const dbName = db.config.database;

    if (failed.length) {
      console.log(`\n!! ${failed.length} model file(s) failed to load:`);
      for (const f of failed) console.log(`     ${f}`);
      console.log('   Their tables cannot be created until this is fixed.\n');
    }

    const listTables = async () => {
      const [rows] = await db.query(
        'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = :db',
        { replacements: { db: dbName } },
      );
      return new Set(rows.map((r) => r.t));
    };

    const before = await listTables();
    const models = db.models;
    const names = Object.keys(models).sort();

    const tableOf = (m) => {
      const t = models[m].getTableName();
      return typeof t === 'string' ? t : t.tableName;
    };

    const missing = names.filter((n) => !before.has(tableOf(n)));

    console.log(`\nDatabase: ${dbName}`);
    console.log(`Models registered: ${names.length}`);
    console.log(`Tables present:    ${before.size}`);
    console.log(`Missing tables:    ${missing.length}\n`);

    if (missing.length) {
      for (const n of missing) console.log(`   + ${tableOf(n)}`);
      console.log('');
    }

    if (DRY_RUN) {
      console.log('DRY RUN — nothing was created.\n');
      process.exit(0);
    }

    if (missing.length) {
      console.log('Creating tables…');
      await db.sync();
      const after = await listTables();
      const created = [...after].filter((t) => !before.has(t));
      console.log(`   ${created.length} table(s) created.`);

      const stillMissing = names.filter((n) => !after.has(tableOf(n)));
      if (stillMissing.length) {
        console.log(`\n!! ${stillMissing.length} model(s) STILL have no table:`);
        for (const n of stillMissing) console.log(`     ${n} -> ${tableOf(n)}`);
        process.exit(1);
      }
      console.log('   Every registered model now has a table.\n');
    } else {
      console.log('Schema already complete — nothing to create.\n');
    }

    // ── Seed the config the app cannot work without ──────────────────────
    // Without cities nothing is bookable; without settings every fee reads as
    // zero. Both seeders are idempotent findOrCreate, so re-running is safe.
    if (process.env.SEED_DEFAULTS === 'false') {
      console.log('Seeding skipped (SEED_DEFAULTS=false).');
      console.log('   Careful: with no cities nothing is bookable and every fee reads as zero.\n');
    } else {
      const steps = [
        ['Default settings', () => require('../src/services/settingsService').addDefaultSettings()],
        ['Default cities', () => require('../src/services/cityService').addDefaultCities()],
        ['Default brands', () => require('../src/services/brandService').addDefaultBrands()],
        // Not covered by the boot seeders historically, but both are config and
        // nothing else creates them. Without an active protection plan
        // `initiateBooking` throws, so a fresh database is not bookable at all.
        ['Default protection plan', () => require('../src/services/protectionPlanService').addDefaultProtectionPlan()],
        ['Default membership type', () => require('../src/services/membershipTypeService').addDefaultMembershipType()],
      ];
      for (const [label, fn] of steps) {
        try { await fn(); console.log(`   ${label}: ok`); }
        catch (error) { console.error(`   ${label}: FAILED — ${error?.parent?.sqlMessage || error.message}`); }
      }
      console.log('');
    }

    // ── The break-glass admin ────────────────────────────────────────────
    // Without this nobody can administer the panel, and with the Firebase
    // sync gone there is nothing else that would create an admin row.
    try {
      const { ensureBootstrapSuperAdmin, BOOTSTRAP_EMAIL } = require('../src/services/bootstrapAdminService');
      await ensureBootstrapSuperAdmin();
      console.log(`Bootstrap super admin: ${BOOTSTRAP_EMAIL} (role 2)\n`);
    } catch (error) {
      console.error(`Bootstrap super admin FAILED — ${error?.parent?.sqlMessage || error.message}`);
      console.error('   The panel may be unadministrable until this succeeds.\n');
    }

    // ── Final report ─────────────────────────────────────────────────────
    const final = await listTables();
    let total = 0;
    const nonEmpty = [];
    for (const t of [...final].sort()) {
      const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      total += Number(n);
      if (Number(n) > 0) nonEmpty.push(`${t}=${n}`);
    }
    console.log(`Tables: ${final.size}   Rows: ${total}`);
    console.log(nonEmpty.length ? `Seeded: ${nonEmpty.join(', ')}\n` : 'All tables empty.\n');

    process.exit(0);
  } catch (error) {
    console.error('\nFAILED:', error?.parent?.sqlMessage || error.message);
    process.exit(1);
  }
})();
