/* eslint-disable no-console */
// COPY EVERY OBJECT FROM THE LEGACY BUCKET TO THE NEW ONE, KEY FOR KEY.
//
// The legacy bucket (`wrapped-lockerbox`) is a resource inside the LEGACY
// Railway project. Deleting that project deletes the bucket, and with it every
// profile photo, licence scan, vehicle photo and ride photo on the platform.
// The database rows were already migrated and they carry the object KEYS, so
// the objects have to arrive in the new bucket under the SAME keys or every one
// of those rows becomes a broken image.
//
//   THE KEY IS THE CONTRACT. Nothing here renames, re-folders or normalises a
//   key. `<folder>/<uuid>` and bare legacy `<uuid>` are both copied verbatim,
//   because both forms are referenced from DB rows and from URLs already handed
//   out. Tidying the layout during a migration is how you turn a copy into an
//   outage.
//
// Safe to re-run: an object already present in the destination with a matching
// size is skipped, so an interrupted run resumes rather than starting over.
//
//   node scripts/migrateBucketObjects.js --dry-run
//   node scripts/migrateBucketObjects.js --confirm
//   node scripts/migrateBucketObjects.js --confirm --overwrite   (force re-copy)
//
// Credentials — the SOURCE is the legacy bucket, the DESTINATION is the new one:
//   SRC_S3_ENDPOINT  SRC_S3_BUCKET  SRC_AWS_ACCESS_KEY_ID  SRC_AWS_SECRET_ACCESS_KEY  [SRC_S3_REGION]
//   DST_S3_ENDPOINT  DST_S3_BUCKET  DST_AWS_ACCESS_KEY_ID  DST_AWS_SECRET_ACCESS_KEY  [DST_S3_REGION]

const {
  S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, HeadObjectCommand,
} = require('@aws-sdk/client-s3');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const OVERWRITE = args.includes('--overwrite');
// Copies run concurrently; the ceiling is modest because the bottleneck is the
// provider's rate limit, not us, and a 429 storm is slower than going steady.
const CONCURRENCY = Number(process.env.COPY_CONCURRENCY || 8);

if (!DRY_RUN && !CONFIRM) {
  console.error('Refusing to run without --dry-run or --confirm.');
  process.exit(1);
}

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return v;
}

const SRC_BUCKET = need('SRC_S3_BUCKET');
const DST_BUCKET = need('DST_S3_BUCKET');

const client = (prefix) => new S3Client({
  region: process.env[`${prefix}_S3_REGION`] || 'auto',
  endpoint: need(`${prefix}_S3_ENDPOINT`),
  forcePathStyle: true,
  credentials: {
    accessKeyId: need(`${prefix}_AWS_ACCESS_KEY_ID`),
    secretAccessKey: need(`${prefix}_AWS_SECRET_ACCESS_KEY`),
  },
});

const src = client('SRC');
const dst = client('DST');

// Streamed rather than buffered: some ride and vehicle photos are several MB,
// and holding a whole page of them in memory at once is needless.
async function copyOne(key) {
  const got = await src.send(new GetObjectCommand({ Bucket: SRC_BUCKET, Key: key }));
  await dst.send(new PutObjectCommand({
    Bucket: DST_BUCKET,
    Key: key,
    Body: got.Body,
    ContentType: got.ContentType,
    ContentLength: got.ContentLength,
    // Metadata is carried over because it is cheap and its absence is only ever
    // discovered later, by something that needed it.
    Metadata: got.Metadata,
  }));
}

async function existsWithSameSize(key, size) {
  try {
    const head = await dst.send(new HeadObjectCommand({ Bucket: DST_BUCKET, Key: key }));
    return head.ContentLength === size;
  } catch {
    return false;
  }
}

async function run() {
  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}copying ${SRC_BUCKET} -> ${DST_BUCKET}`);

  const totals = {
    listed: 0, copied: 0, skipped: 0, failed: 0, bytes: 0,
  };
  const failures = [];
  let token;

  do {
    /* eslint-disable no-await-in-loop */
    const page = await src.send(new ListObjectsV2Command({
      Bucket: SRC_BUCKET, ContinuationToken: token,
    }));
    const objects = page.Contents || [];
    totals.listed += objects.length;

    // Fixed-size worker pool over this page.
    let cursor = 0;
    const worker = async () => {
      while (cursor < objects.length) {
        const obj = objects[cursor];
        cursor += 1;
        const { Key: key, Size: size } = obj;
        try {
          if (!OVERWRITE && await existsWithSameSize(key, size)) {
            totals.skipped += 1;
            continue;
          }
          if (!DRY_RUN) await copyOne(key);
          totals.copied += 1;
          totals.bytes += size || 0;
        } catch (e) {
          totals.failed += 1;
          // Kept, not just counted: "3 failed" is unactionable, and these are
          // the exact keys that will render as broken images.
          failures.push({ key, error: e.message });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    process.stdout.write(
      `\r  listed ${totals.listed}  copied ${totals.copied}  skipped ${totals.skipped}  failed ${totals.failed}`,
    );
  } while (token);

  console.log('\n');
  console.log(`  objects in source : ${totals.listed}`);
  console.log(`  copied            : ${totals.copied}${DRY_RUN ? ' (would copy)' : ''}`);
  console.log(`  already present   : ${totals.skipped}`);
  console.log(`  failed            : ${totals.failed}`);
  console.log(`  bytes transferred : ${(totals.bytes / 1024 / 1024).toFixed(1)} MB`);

  if (failures.length) {
    console.log('\nFAILED KEYS (these would be broken images):');
    failures.slice(0, 50).forEach((f) => console.log(`  ${f.key}  ${f.error}`));
    if (failures.length > 50) console.log(`  … and ${failures.length - 50} more`);
  }

  // Non-zero on any failure so a CI step or a shell `&&` chain cannot treat a
  // partial copy as done. A partial copy is the dangerous outcome here: it
  // looks finished and is missing exactly the objects nobody checked.
  process.exit(totals.failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('\nMigration aborted:', e.message);
  process.exit(1);
});
