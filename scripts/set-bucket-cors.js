#!/usr/bin/env node
/**
 * One-off: apply a CORS policy to the object-storage bucket so browsers can
 * POST directly to the presigned upload URL.
 *
 * Reads the same env vars the backend uses (AWS_* / S3_* / BUCKET_* aliases).
 *
 * Run against Railway (env already set there):
 *   railway run node scripts/set-bucket-cors.js
 *
 * Or locally:
 *   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
 *   S3_ENDPOINT=https://t3.storageapi.dev S3_BUCKET=wrapped-lockerbox-9ybz-nh \
 *   node scripts/set-bucket-cors.js
 *
 * Extra origins can be appended:
 *   node scripts/set-bucket-cors.js https://my-preview.up.railway.app
 */
const { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } = require('@aws-sdk/client-s3');

const pickEnv = (...names) => {
  for (const n of names) if (process.env[n]) return process.env[n];
  return undefined;
};

const accessKeyId = pickEnv(
  'AWS_ACCESS_KEY_ID', 'S3_ACCESS_KEY_ID', 'S3_ACCESS_KEY',
  'BUCKET_ACCESS_KEY_ID', 'BUCKET_ACCESS_KEY', 'STORAGE_ACCESS_KEY_ID'
);
const secretAccessKey = pickEnv(
  'AWS_SECRET_ACCESS_KEY', 'S3_SECRET_ACCESS_KEY', 'S3_SECRET_KEY',
  'BUCKET_SECRET_ACCESS_KEY', 'BUCKET_SECRET_KEY', 'STORAGE_SECRET_ACCESS_KEY'
);
const Bucket = pickEnv('S3_BUCKET', 'BUCKET_NAME', 'AWS_BUCKET', 'STORAGE_BUCKET') || 'wrapped-lockerbox-9ybz-nh';
const endpoint = pickEnv('S3_ENDPOINT', 'BUCKET_ENDPOINT', 'AWS_ENDPOINT_URL_S3') || 'https://t3.storageapi.dev';
const region = pickEnv('AWS_REGION', 'S3_REGION', 'BUCKET_REGION') || 'auto';

if (!accessKeyId || !secretAccessKey) {
  console.error('Missing storage credentials. Set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (or the S3_/BUCKET_ equivalents).');
  process.exit(1);
}

const origins = [
  'https://www.cocarr.com',
  'https://cocarr.com',
  'http://localhost:5173',
  'http://localhost:3000',
  ...process.argv.slice(2),
];

(async () => {
  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  console.log(`Applying CORS to bucket "${Bucket}" at ${endpoint}`);
  console.log('Allowed origins:', origins.join(', '));

  await client.send(new PutBucketCorsCommand({
    Bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: origins,
          AllowedMethods: ['POST', 'PUT', 'GET', 'HEAD'],
          AllowedHeaders: ['*'],
          ExposeHeaders: ['ETag', 'Location'],
          MaxAgeSeconds: 3000,
        },
      ],
    },
  }));

  console.log('CORS applied. Verifying…');
  const current = await client.send(new GetBucketCorsCommand({ Bucket }));
  console.log(JSON.stringify(current.CORSRules, null, 2));
})().catch((err) => {
  console.error('Failed to set CORS:', err?.name, err?.message);
  process.exit(1);
});
