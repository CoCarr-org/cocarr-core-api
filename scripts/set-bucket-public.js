#!/usr/bin/env node
/**
 * One-off: allow public (anonymous) reads of objects in the storage bucket, so
 * uploaded profile/car photos can be shown directly via their URL.
 *
 * Uploads currently succeed but reading the object returns 403, because the
 * provider stores objects privately (the presigned POST's `acl: public-read`
 * is accepted but not honoured).
 *
 * Run against Railway (env already set there):
 *   railway run node scripts/set-bucket-public.js
 *
 * Or locally:
 *   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
 *   S3_ENDPOINT=https://t3.storageapi.dev S3_BUCKET=wrapped-lockerbox-9ybz-nh \
 *   node scripts/set-bucket-public.js
 */
const {
  S3Client, PutBucketPolicyCommand, GetBucketPolicyCommand,
} = require('@aws-sdk/client-s3');

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

const policy = {
  Version: '2012-10-17',
  Statement: [
    {
      Sid: 'PublicReadObjects',
      Effect: 'Allow',
      Principal: '*',
      Action: ['s3:GetObject'],
      Resource: [`arn:aws:s3:::${Bucket}/*`],
    },
  ],
};

(async () => {
  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  console.log(`Applying public-read policy to "${Bucket}" at ${endpoint}`);
  await client.send(new PutBucketPolicyCommand({
    Bucket,
    Policy: JSON.stringify(policy),
  }));

  console.log('Policy applied. Verifying…');
  const current = await client.send(new GetBucketPolicyCommand({ Bucket }));
  console.log(current.Policy);
})().catch((err) => {
  console.error('Failed to set bucket policy:', err?.name, '-', err?.message);
  console.error(
    '\nIf this says NotImplemented/AccessDenied, the provider does not support ' +
    'bucket policies over the API — enable public access in its dashboard, or ' +
    'switch to serving images through the backend instead.'
  );
  process.exit(1);
});
