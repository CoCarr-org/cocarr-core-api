#!/usr/bin/env node
/**
 * Migrate legacy COCARR-BACKEND customer data into this service's database.
 *
 *   node scripts/migrateLegacyUsers.js --dry-run
 *   node scripts/migrateLegacyUsers.js --confirm
 *   node scripts/migrateLegacyUsers.js --confirm --only=users,wallets
 *
 * Source (read ONLY):
 *   LEGACY_DB_HOST LEGACY_DB_PORT LEGACY_DB_USER LEGACY_DB_PASS LEGACY_DB_NAME
 * Destination is this service's own DB_* vars, so it runs where those resolve —
 * inside Railway, since the platform MySQL has no public proxy.
 *
 * WHY THIS IS A STRAIGHT COPY: cocarr-core-api IS the legacy backend. All 77
 * model files are byte-identical, so `users` here has the same columns, types
 * and semantics as `users` there. There is nothing to transform — inventing a
 * mapping would only create opportunities to get it wrong.
 *
 * COLUMNS ARE INTERSECTED AT RUNTIME, not hardcoded. The two schemas agree
 * today; if they ever drift, copying a column the destination does not have
 * fails the whole table, and hardcoding a list silently drops a column added
 * later. The intersection copies what both sides genuinely share and REPORTS
 * the difference rather than hiding it.
 *
 * ORDER IS LOAD-BEARING. Children follow parents so foreign keys resolve:
 * a wallet transaction whose wallet does not exist yet is rejected by MySQL,
 * and the failure would be per-row and confusing.
 *
 * IDEMPOTENT via INSERT IGNORE on the primary key. A re-run inserts nothing and
 * says so. It never UPDATES an existing row: the destination is authoritative
 * once data lives there, and silently overwriting local edits with stale legacy
 * values is a worse failure than a skipped row.
 */
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const DRY = !CONFIRM;
const onlyArg = args.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.split('=')[1].split(',').map((s) => s.trim()) : null;

// Parents before children.
//
// `referral_campaigns` is here because referrals carry a campaignId FK. It was
// missing on the first run, and INSERT IGNORE turned the resulting foreign-key
// failures into silence: both referral rows vanished while the script reported
// success. A parent table left out of this list does not error — it quietly
// loses its children, which is the worst way for a migration to be wrong.
const TABLES = [
  // ── configuration and master data ────────────────────────────────────────
  // First, and not only because they have no dependencies: without cities
  // nothing is bookable and without the fee settings every fee reads as zero,
  // so a database with users and no configuration looks healthy and behaves
  // like a broken product.
  'cities',
  'brands',
  'models',
  'settings',
  'platformSettings',
  'protectionplans',
  'membershiptypes',
  'vehicleplans',
  'offers',

  // ── people ───────────────────────────────────────────────────────────────
  'users',
  'kycDocuments',
  'panCards',
  'drivingLicences',
  'hosts',
  'hostCommissions',

  // ── wallet and referrals ─────────────────────────────────────────────────
  // referral_campaigns before referrals (campaignId FK), and every referral
  // parent before wallettransactions, which points back at all of it.
  'wallets',
  'referral_campaigns',
  'referral_codes',
  'referrals',
  'referral_rewards',
  'wallettransactions',
];

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing ${k}`); process.exit(1); }
  return v;
};

const columnsOf = async (conn, schema, table) => {
  const [rows] = await conn.execute(
    'SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name=? ORDER BY ordinal_position',
    [schema, table],
  );
  // mysql2 casing varies by server version.
  return rows.map((r) => r.column_name ?? r.COLUMN_NAME);
};

// JSON columns come back from the driver as JS OBJECTS, and mysql2 expands a
// plain object in a placeholder into `key = value` pairs — its shorthand for
// building a SET clause. Bound into an INSERT that produces broken SQL, which is
// exactly how the first real run died on `users.nameMatchResult`:
//
//   ... `mismatches` = , `comparisons` = '[o' ...
//
// Dates and Buffers are objects too and the driver handles both correctly, so
// they must NOT be stringified: a Date would land as ISO text in a DATETIME
// column and a Buffer would be corrupted. Only plain objects and arrays.
const bindable = (v) => {
  if (v === null || v === undefined) return v;
  if (v instanceof Date || Buffer.isBuffer(v)) return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
};

// The primary key, so a row that failed to insert can be looked up afterwards
// and classified as duplicate or rejected. A table with a composite or absent
// PK simply skips that classification rather than guessing.
const primaryKeyOf = async (conn, schema, table) => {
  const [rows] = await conn.execute(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_key='PRI'",
    [schema, table],
  );
  if (rows.length !== 1) return null;
  return rows[0].column_name ?? rows[0].COLUMN_NAME;
};

const tableExists = async (conn, schema, table) => {
  const [rows] = await conn.execute(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=? AND table_name=?',
    [schema, table],
  );
  return Number(rows[0].n) > 0;
};

(async () => {
  console.log(DRY ? '=== DRY RUN — nothing is written ===' : '=== MIGRATING (--confirm) ===');

  const src = await mysql.createConnection({
    host: need('LEGACY_DB_HOST'),
    port: parseInt(process.env.LEGACY_DB_PORT || '3306', 10),
    user: need('LEGACY_DB_USER'),
    password: process.env.LEGACY_DB_PASS || '',
    database: need('LEGACY_DB_NAME'),
  });
  const dst = await mysql.createConnection({
    host: need('DB_HOST'),
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: need('DB_USER'),
    password: process.env.DB_PASS || '',
    database: need('DB_NAME'),
  });

  const srcSchema = process.env.LEGACY_DB_NAME;
  const dstSchema = process.env.DB_NAME;
  console.log(`source: ${process.env.LEGACY_DB_HOST}/${srcSchema}`);
  console.log(`target: ${process.env.DB_HOST}/${dstSchema}\n`);

  const totals = { copied: 0, skipped: 0, rejected: 0, tables: 0 };

  for (const table of TABLES) {
    if (ONLY && !ONLY.includes(table)) continue;

    /* eslint-disable no-await-in-loop */
    if (!await tableExists(src, srcSchema, table)) { console.log(`- ${table}: not in source, skipped`); continue; }
    if (!await tableExists(dst, dstSchema, table)) { console.log(`! ${table}: NOT IN TARGET — skipped`); continue; }

    const sCols = await columnsOf(src, srcSchema, table);
    const dCols = await columnsOf(dst, dstSchema, table);
    const shared = sCols.filter((c) => dCols.includes(c));
    const droppedFromSource = sCols.filter((c) => !dCols.includes(c));
    const onlyInTarget = dCols.filter((c) => !sCols.includes(c));

    const pk = await primaryKeyOf(dst, dstSchema, table);
    const [rows] = await src.query(`SELECT ${shared.map((c) => `\`${c}\``).join(', ')} FROM \`${table}\``);
    const [[{ n: already }]] = await dst.query(`SELECT COUNT(*) AS n FROM \`${table}\``);

    console.log(`${table}: ${rows.length} in source, ${already} already in target, ${shared.length} shared columns`);
    if (droppedFromSource.length) console.log(`    source-only columns NOT copied: ${droppedFromSource.join(', ')}`);
    if (onlyInTarget.length) console.log(`    target-only columns left at default: ${onlyInTarget.join(', ')}`);

    if (rows.length === 0) { totals.tables++; continue; }

    if (DRY) {
      console.log(`    WOULD INSERT up to ${rows.length} rows`);
      totals.copied += rows.length; totals.tables++;
      continue;
    }

    // One multi-row INSERT IGNORE per table: a row already present is left
    // exactly as it is, which is what makes a re-run safe.
    const placeholders = `(${shared.map(() => '?').join(', ')})`;
    let inserted = 0;
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const values = chunk.flatMap((r) => shared.map((c) => bindable(r[c])));
      const [res] = await dst.query(
        `INSERT IGNORE INTO \`${table}\` (${shared.map((c) => `\`${c}\``).join(', ')}) VALUES ${chunk.map(() => placeholders).join(', ')}`,
        values,
      );
      inserted += res.affectedRows;
    }

    // A row that did not insert is NOT necessarily a duplicate. INSERT IGNORE
    // downgrades foreign-key violations to warnings and drops the row, so
    // reporting every miss as "alreadyPresent" hides real data loss — exactly
    // what happened to `referrals` on the first run: 2 in source, 0 in target,
    // 0 inserted, reported as though they were already there.
    //
    // So the misses are checked individually: a source id now present in the
    // target was a duplicate; one still absent was REJECTED. The second is
    // reported loudly, because silence is how a migration lies.
    const notInserted = rows.length - inserted;
    let duplicates = 0;
    let rejectedIds = [];
    if (notInserted > 0 && pk) {
      const ids = rows.map((r) => r[pk]);
      const [present] = await dst.query(
        `SELECT \`${pk}\` AS id FROM \`${table}\` WHERE \`${pk}\` IN (${ids.map(() => '?').join(',')})`,
        ids,
      );
      const presentIds = new Set(present.map((r) => String(r.id)));
      duplicates = ids.filter((i) => presentIds.has(String(i))).length - inserted;
      rejectedIds = ids.filter((i) => !presentIds.has(String(i)));
    }

    console.log(`    inserted=${inserted} alreadyPresent=${Math.max(0, duplicates)} rejected=${rejectedIds.length}`);
    if (rejectedIds.length) {
      console.log(`    !! ${rejectedIds.length} row(s) REJECTED and NOT migrated: ${rejectedIds.slice(0, 5).join(', ')}`
        + (rejectedIds.length > 5 ? ' …' : ''));
      console.log('       Usually a foreign key whose parent table is missing from TABLES above.');
      totals.rejected += rejectedIds.length;
    }
    totals.copied += inserted;
    totals.skipped += Math.max(0, duplicates);
    totals.tables++;
    /* eslint-enable no-await-in-loop */
  }

  console.log('\n---');
  console.log(`tables=${totals.tables} rowsInserted=${totals.copied} rowsAlreadyPresent=${totals.skipped} rowsREJECTED=${totals.rejected}`);
  if (totals.rejected > 0) {
    console.log('\n!! Some rows were rejected and are NOT in the target. Fix the cause and re-run.');
    // Nothing here; the exit code is set at the end. Setting process.exitCode
    // here would be silently overridden by the explicit process.exit() below.
  }
  if (DRY) console.log('DRY RUN complete — re-run with --confirm to apply.');

  await src.end();
  await dst.end();
  // NON-ZERO WHEN ROWS WERE REJECTED. Run as a pre-deploy hook, exit 0 is what
  // Railway reads as "the migration worked" — so exiting 0 after losing rows
  // would turn data loss into a green deploy.
  process.exit(totals.rejected > 0 ? 1 : 0);
})().catch((e) => { console.error('MIGRATION FAILED:', e.message); process.exit(1); });
