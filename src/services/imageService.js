
const express = require('express');
const fs = require('fs').promises;
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { S3Client } = require('@aws-sdk/client-s3');
const { CustomError } = require('../middlewares/error');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
const { PUBLIC_API_URL } = require('../utils/publicUrl');
const { v4 } = require('uuid');
const { normaliseFolder } = require('../utils/storageFolders');
const uploadImage = async(req) => {
  try {
    // Save the compressed or original image to the server
    await fs.writeFile(req.imagePath, req.compressedImageBuffer);

    return {
      message: req.isCompressed ? 'Image uploaded and compressed successfully' : 'Image uploaded successfully',
      imageName: req.imageName,
    };
  } catch (error) {
    console.error('Error saving image:', error);
    throw({ error: 'Internal Server Error' });
  }
}

// Picks the first env var that is set, from a list of candidate names.
const pickEnv = (...names) => {
  for (const n of names) {
    if (process.env[n]) return process.env[n];
  }
  return undefined;
};

// THE BUCKET NAME IS REQUIRED, and deliberately has no default any more.
//
// It used to fall back to the literal `wrapped-lockerbox-9ybz-nh` — the bucket
// living in the LEGACY Railway project. Once that project is retired the bucket
// goes with it, so the fallback would point every unconfigured deployment at
// storage that no longer exists. A default that silently reads the wrong bucket
// is worse than a refusal: images 404 one at a time, which reads as missing
// data rather than as missing configuration.
//
// `AWS_S3_BUCKET_NAME` is FIRST because that is the name Railway's own Tigris
// bucket injects when you attach one. The previous list did not include it, so
// attaching a bucket supplied working credentials and a bucket name nothing
// read — the one combination that looks configured and is not.
const BUCKET_VARS = [
  'AWS_S3_BUCKET_NAME', 'S3_BUCKET', 'BUCKET_NAME', 'AWS_BUCKET', 'STORAGE_BUCKET',
];

const getBucketName = () => {
  const bucket = pickEnv(...BUCKET_VARS);
  if (!bucket) {
    throw new Error(
      `Object storage bucket is not configured. Set one of ${BUCKET_VARS.join(', ')} `
      + 'on this service. Attaching a Railway bucket sets AWS_S3_BUCKET_NAME for you.',
    );
  }
  return bucket;
};

// Credentials must be passed explicitly: the AWS SDK's default provider chain
// only reads AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, so S3-compatible providers
// (Railway/Tigris buckets etc.) that expose differently-named vars would
// otherwise fail with CredentialsProviderError.
const buildS3Client = () => {
  const accessKeyId = pickEnv(
    'AWS_ACCESS_KEY_ID', 'S3_ACCESS_KEY_ID', 'S3_ACCESS_KEY',
    'BUCKET_ACCESS_KEY_ID', 'BUCKET_ACCESS_KEY', 'STORAGE_ACCESS_KEY_ID'
  );
  const secretAccessKey = pickEnv(
    'AWS_SECRET_ACCESS_KEY', 'S3_SECRET_ACCESS_KEY', 'S3_SECRET_KEY',
    'BUCKET_SECRET_ACCESS_KEY', 'BUCKET_SECRET_KEY', 'STORAGE_SECRET_ACCESS_KEY'
  );

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'Object storage credentials are not configured. Set AWS_ACCESS_KEY_ID and ' +
      'AWS_SECRET_ACCESS_KEY (or the S3_/BUCKET_ equivalents) on the backend service.'
    );
  }

  return new S3Client({
    // Railway's Tigris bucket injects AWS_DEFAULT_REGION and AWS_ENDPOINT_URL;
    // neither was read before, so an attached bucket silently used 'auto' and
    // the hardcoded Tigris endpoint. That happened to work while the bucket was
    // the legacy Tigris one and will not once it is a different provider.
    region: pickEnv('AWS_REGION', 'AWS_DEFAULT_REGION', 'S3_REGION', 'BUCKET_REGION') || 'auto',
    endpoint: pickEnv(
      'S3_ENDPOINT', 'AWS_ENDPOINT_URL_S3', 'AWS_ENDPOINT_URL', 'BUCKET_ENDPOINT',
    ) || 'https://t3.storageapi.dev',
    // Most S3-compatible providers require path-style addressing.
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
};

// Streams a stored object back to the caller. The bucket is private, so images
// are served through the API rather than linked directly.
const getObject = async (key) => {
  const client = buildS3Client();
  return client.send(new GetObjectCommand({ Bucket: getBucketName(), Key: key }));
};

// Stores a buffer directly (used server-side, e.g. the RC image captured during
// vehicle onboarding) and returns the proxied public URL for that object.
// `folder` sorts the object in the bucket — see utils/storageFolders.js.
const putObject = async (buffer, contentType = 'image/jpeg', folder) => {
  const client = buildS3Client();
  const key = `${normaliseFolder(folder)}/${v4()}`;
  await client.send(new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  // Served through the API proxy since the bucket is private.
  return `${PUBLIC_API_URL}/image/${key}`;
};

// `req.query.folder` decides where the upload lands. An unknown or absent
// folder falls back to `misc` rather than failing, so an older client that
// doesn't send one keeps working.
const getSignedUrl = async(req)=>
{
  try
  {
    let id = `${normaliseFolder(req?.query?.folder)}/${v4()}`;
      const client = buildS3Client();
      const { url, fields } = await createPresignedPost(client, {
        Bucket: getBucketName(),
        Key: id,
        Conditions: [
          { "acl": "public-read" },['content-length-range', 0, 24 * 1024 * 1024] // 5 MB max
        ],
        Fields: {
          success_action_status: '201',
          'Content-Type': 'image/jpg,image/png'
        },
        Expires: 3600
      })
      return {url,fields};
  } catch (error) {
      console.error('Error creating presigned upload URL:', error);
      throw new CustomError(error?.message || 'Failed to create upload URL', 400, 'ERROR_CREATING_URL')
  }
}


module.exports = {
  uploadImage,
  getSignedUrl,
  getObject,
  putObject
};
