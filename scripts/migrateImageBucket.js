/**
 * migrateImageBucket.js — copy every stored object from the LEGACY image bucket
 * to the NEW one, under the SAME key, so the migrated DB rows (which reference
 * `<folder>/<uuid>` or bare-`<uuid>` keys) resolve through the new environment's
 * `/image/:key` proxy exactly as they did on the legacy stack.
 *
 * It NEVER writes to the source, skips objects already present at the
 * destination (so it is safe to re-run and resumable after an interruption),
 * and preserves each object's ContentType.
 *
 *   Source  = CoCarr-Core / Development / COCARR-BACKEND  (legacy Tigris bucket)
 *   Dest    = cocarr / development / core                 (new Tigris bucket)
 *
 * CREDENTIALS ARE READ FROM THE ENVIRONMENT so no secret is ever pasted into a
 * chat, a repo, or an argv. Put them in a gitignored file and source it:
 *
 *   # migrate-buckets.env  (DO NOT COMMIT)
 *   export SRC_ENDPOINT=https://t3.storageapi.dev
 *   export SRC_REGION=auto
 *   export SRC_BUCKET=wrapped-lockerbox-9ybz-nh
 *   export SRC_ACCESS_KEY_ID=...
 *   export SRC_SECRET_ACCESS_KEY=...
 *   export DST_ENDPOINT=https://t3.storageapi.dev
 *   export DST_REGION=auto
 *   export DST_BUCKET=<new AWS_S3_BUCKET_NAME>
 *   export DST_ACCESS_KEY_ID=...
 *   export DST_SECRET_ACCESS_KEY=...
 *
 *   set -a; source migrate-buckets.env; set +a
 *   node scripts/migrateImageBucket.js --dry-run          # list what would copy
 *   node scripts/migrateImageBucket.js --confirm          # do it
 *   node scripts/migrateImageBucket.js --confirm --force  # also overwrite existing
 *
 * Flags:
 *   --dry-run           list source objects and the copy/skip decision, write nothing (default if neither given)
 *   --confirm           actually copy
 *   --force             overwrite objects that already exist at the destination
 *   --prefix=<p>        only objects whose key starts with <p> (e.g. --prefix=vehicle/)
 *   --concurrency=<n>   parallel copies (default 8)
 */

const {
  S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, HeadObjectCommand,
} = require('@aws-sdk/client-s3');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const CONFIRM = has('--confirm');
const DRY_RUN = has('--dry-run') || !CONFIRM;
const FORCE = has('--force');
const PREFIX = val('prefix', '');
const CONCURRENCY = Math.max(1, parseInt(val('concurrency', '8'), 10) || 8);

function requireEnv(...names) {
  const out = {};
  for (const n of names) {
    if (!process.env[n]) {
      console.error(`FATAL: missing required env var ${n}`);
      process.exit(1);
    }
    out[n] = process.env[n];
  }
  return out;
}

requireEnv(
  'SRC_BUCKET', 'SRC_ACCESS_KEY_ID', 'SRC_SECRET_ACCESS_KEY',
  'DST_BUCKET', 'DST_ACCESS_KEY_ID', 'DST_SECRET_ACCESS_KEY',
);

const DEFAULT_ENDPOINT = 'https://t3.storageapi.dev';

const src = new S3Client({
  region: process.env.SRC_REGION || 'auto',
  endpoint: process.env.SRC_ENDPOINT || DEFAULT_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.SRC_ACCESS_KEY_ID,
    secretAccessKey: process.env.SRC_SECRET_ACCESS_KEY,
  },
});
const dst = new S3Client({
  region: process.env.DST_REGION || 'auto',
  endpoint: process.env.DST_ENDPOINT || DEFAULT_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.DST_ACCESS_KEY_ID,
    secretAccessKey: process.env.DST_SECRET_ACCESS_KEY,
  },
});

const SRC_BUCKET = process.env.SRC_BUCKET;
const DST_BUCKET = process.env.DST_BUCKET;

async function listAll() {
  const keys = [];
  let token;
  do {
    const res = await src.send(new ListObjectsV2Command({
      Bucket: SRC_BUCKET,
      ContinuationToken: token,
      Prefix: PREFIX || undefined,
    }));
    for (const o of res.Contents || []) keys.push({ key: o.Key, size: o.Size });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function existsAtDest(key) {
  try {
    await dst.send(new HeadObjectCommand({ Bucket: DST_BUCKET, Key: key }));
    return true;
  } catch (e) {
    if (e && (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404)) return false;
    throw e;
  }
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

async function copyOne(key) {
  if (!FORCE && (await existsAtDest(key))) return 'skipped';
  if (DRY_RUN) return 'would-copy';
  const got = await src.send(new GetObjectCommand({ Bucket: SRC_BUCKET, Key: key }));
  const body = await streamToBuffer(got.Body);
  await dst.send(new PutObjectCommand({
    Bucket: DST_BUCKET,
    Key: key,
    Body: body,
    ContentType: got.ContentType || 'application/octet-stream',
  }));
  return 'copied';
}

async function run() {
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'COPY'}${FORCE ? ' + FORCE overwrite' : ''}`);
  console.log(`Source: ${SRC_BUCKET} @ ${process.env.SRC_ENDPOINT || DEFAULT_ENDPOINT}`);
  console.log(`Dest:   ${DST_BUCKET} @ ${process.env.DST_ENDPOINT || DEFAULT_ENDPOINT}`);
  if (PREFIX) console.log(`Prefix filter: ${PREFIX}`);
  console.log('Listing source objects…');

  const objects = await listAll();
  console.log(`Found ${objects.length} object(s) in source.\n`);

  const counts = { copied: 0, skipped: 0, 'would-copy': 0, failed: 0 };
  const failures = [];
  let i = 0;

  async function worker() {
    while (i < objects.length) {
      const idx = i++;
      const { key } = objects[idx];
      try {
        const result = await copyOne(key);
        counts[result] += 1;
        if (result !== 'skipped') console.log(`[${idx + 1}/${objects.length}] ${result}: ${key}`);
      } catch (e) {
        counts.failed += 1;
        failures.push({ key, error: e.message || String(e) });
        console.error(`[${idx + 1}/${objects.length}] FAILED: ${key} — ${e.message || e}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, objects.length || 1) }, worker));

  console.log('\n===== SUMMARY =====');
  console.log(`total source objects : ${objects.length}`);
  if (DRY_RUN) {
    console.log(`would copy           : ${counts['would-copy']}`);
    console.log(`already at dest       : ${counts.skipped}`);
  } else {
    console.log(`copied               : ${counts.copied}`);
    console.log(`skipped (existed)     : ${counts.skipped}`);
  }
  console.log(`failed               : ${counts.failed}`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ${f.key} — ${f.error}`);
    process.exit(2);
  }
}

run().catch((e) => {
  console.error('Migration aborted:', e);
  process.exit(1);
});
