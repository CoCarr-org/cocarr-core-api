/* eslint-disable no-console */
// DOES EVERY IMAGE THE DATABASE REFERENCES ACTUALLY EXIST IN THE BUCKET?
//
// Read-only. Run it after migrateBucketObjects.js and BEFORE deleting the
// legacy project — it is the difference between "the copy said it finished"
// and "every image on the platform resolves".
//
// A bucket-to-bucket copy can report success and still leave you broken, for
// reasons the copy cannot see: an object that was already missing in the legacy
// bucket, a row whose key was written malformed years ago, a key referencing a
// bucket that was never the one being copied. Those only surface as a broken
// image in front of a user. This asks the question from the DATABASE's side,
// which is the side that matters.
//
//   node scripts/verifyImageKeys.js            # verify against the configured bucket
//   node scripts/verifyImageKeys.js --sample 500
//   node scripts/verifyImageKeys.js --json report.json
//
// Uses the SAME extractKey logic as the image proxy, so a key that verifies
// here is a key the proxy will resolve — checking with different parsing would
// verify something nobody serves.

const fs = require('fs');
const { HeadObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const db = require('../src/configs/db');
// The proxy's OWN parser, imported rather than reimplemented. A second copy
// would drift, and then this would verify keys nobody serves — passing while
// the images are broken, which is the one outcome worse than failing.
const { extractKey: sharedExtractKey } = require('../src/utils/storageFolders');

const args = process.argv.slice(2);
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};
const SAMPLE = Number(argVal('--sample') || 0);
const JSON_OUT = argVal('--json');
const CONCURRENCY = Number(process.env.VERIFY_CONCURRENCY || 12);

// Every column that stores an object key or a proxied URL. Derived from the
// models rather than guessed; `multi` marks the comma-joined ones (damage
// photos and otherDocument.imageKeys are joined strings, not JSON arrays —
// splitting them is not optional).
const SOURCES = [
  { table: 'users', column: 'profilePhoto' },
  { table: 'hosts', column: 'profilePhoto' },
  { table: 'hosts', column: 'kycImage' },
  { table: 'kycDocuments', column: 'imageKey' },
  { table: 'kycDocuments', column: 'backImageKey' },
  { table: 'panCards', column: 'imageKey' },
  { table: 'drivingLicences', column: 'frontImageKey' },
  { table: 'drivingLicences', column: 'backImageKey' },
  { table: 'vehicleRcDocuments', column: 'imageKey' },
  { table: 'otherDocuments', column: 'imageKeys', multi: true },
  { table: 'images', column: 'url' },
  { table: 'damages', column: 'damageImage', multi: true },
  { table: 'bookings', column: 'startImage', multi: true },
  { table: 'bookings', column: 'endImage', multi: true },
  { table: 'bookings', column: 'startKmsImage' },
  { table: 'bookings', column: 'endKmsImage' },
  { table: 'bookings', column: 'startFuelImage' },
  { table: 'bookings', column: 'endFuelImage' },
];

// A stored value may be a bare legacy `<uuid>`, a `<folder>/<uuid>` key, a raw
// bucket URL, or an already-proxied `/image/<key>` URL built against any host.
// The shared parser reduces all of them to the key; this only strips the forms
// it should never be asked about (inline data and local blob previews, which
// are not bucket objects at all and would otherwise be reported as missing).
function extractKey(value) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.startsWith('data:') || v.startsWith('blob:')) return null;
  const key = sharedExtractKey(v);
  return key || null;
}

function bucketClient() {
  const pick = (...names) => names.map((n) => process.env[n]).find(Boolean);
  const bucket = pick('AWS_S3_BUCKET_NAME', 'S3_BUCKET', 'BUCKET_NAME', 'AWS_BUCKET', 'STORAGE_BUCKET');
  if (!bucket) throw new Error('No bucket configured (AWS_S3_BUCKET_NAME / S3_BUCKET / …).');
  const client = new S3Client({
    region: pick('AWS_REGION', 'AWS_DEFAULT_REGION', 'S3_REGION') || 'auto',
    endpoint: pick('S3_ENDPOINT', 'AWS_ENDPOINT_URL_S3', 'AWS_ENDPOINT_URL') || 'https://t3.storageapi.dev',
    forcePathStyle: true,
    credentials: {
      accessKeyId: pick('AWS_ACCESS_KEY_ID', 'S3_ACCESS_KEY_ID'),
      secretAccessKey: pick('AWS_SECRET_ACCESS_KEY', 'S3_SECRET_ACCESS_KEY'),
    },
  });
  return { client, bucket };
}

async function collectKeys() {
  const refs = new Map(); // key -> [{table, column, id}]
  let unparsable = 0;

  for (const s of SOURCES) {
    let rows;
    try {
      /* eslint-disable no-await-in-loop */
      [rows] = await db.query(
        `SELECT id, \`${s.column}\` AS v FROM \`${s.table}\` WHERE \`${s.column}\` IS NOT NULL AND \`${s.column}\` <> ''`,
      );
    } catch (e) {
      // A table or column that does not exist in this environment is reported,
      // not fatal — the schema differs between environments and a hard failure
      // here would stop the check that matters.
      console.log(`  (skipped ${s.table}.${s.column}: ${e.original?.code || e.message})`);
      continue;
    }
    for (const row of rows) {
      const values = s.multi ? String(row.v).split(',') : [row.v];
      for (const raw of values) {
        const key = extractKey(raw);
        if (!key) { unparsable += 1; continue; }
        if (!refs.has(key)) refs.set(key, []);
        refs.get(key).push({ table: s.table, column: s.column, id: row.id });
      }
    }
    console.log(`  ${s.table}.${s.column}: ${rows.length} rows`);
  }
  return { refs, unparsable };
}

async function run() {
  const { client, bucket } = bucketClient();
  console.log(`Verifying image keys against bucket: ${bucket}\n`);

  const { refs, unparsable } = await collectKeys();
  let keys = [...refs.keys()];
  console.log(`\nDistinct keys referenced: ${keys.length}`);
  if (unparsable) console.log(`Values that parsed to no key: ${unparsable}`);

  if (SAMPLE && SAMPLE < keys.length) {
    // Deterministic stride, not Math.random: a sample you cannot reproduce is
    // useless for confirming a fix.
    const stride = Math.ceil(keys.length / SAMPLE);
    keys = keys.filter((_, i) => i % stride === 0);
    console.log(`Sampling every ${stride}th key -> ${keys.length} checks`);
  }

  const missing = [];
  let checked = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < keys.length) {
      const key = keys[cursor];
      cursor += 1;
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      } catch (e) {
        missing.push({ key, referencedBy: refs.get(key), reason: e.name || e.message });
      }
      checked += 1;
      if (checked % 100 === 0) process.stdout.write(`\r  checked ${checked}/${keys.length}  missing ${missing.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write(`\r  checked ${checked}/${keys.length}  missing ${missing.length}\n`);

  console.log(`\n  present : ${checked - missing.length}`);
  console.log(`  MISSING : ${missing.length}`);

  if (missing.length) {
    console.log('\nMissing objects (each is a broken image):');
    missing.slice(0, 30).forEach((m) => {
      const where = m.referencedBy.slice(0, 2)
        .map((r) => `${r.table}.${r.column}#${r.id}`).join(', ');
      console.log(`  ${m.key}  <- ${where}${m.referencedBy.length > 2 ? ` (+${m.referencedBy.length - 2})` : ''}`);
    });
    if (missing.length > 30) console.log(`  … and ${missing.length - 30} more`);
  }

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ checked, missing }, null, 2));
    console.log(`\nFull report written to ${JSON_OUT}`);
  }

  await db.close();
  // Non-zero when anything is missing, so this can gate the decision to delete
  // the legacy project.
  process.exit(missing.length > 0 ? 1 : 0);
}

run().catch(async (e) => {
  console.error('\nVerification aborted:', e.message);
  try { await db.close(); } catch { /* already closed */ }
  process.exit(1);
});
