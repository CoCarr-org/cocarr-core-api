// Uploaded objects live in a private S3-compatible bucket, so the raw bucket
// URL returns 403 for clients. Rewrite stored URLs to the API's image proxy
// (GET /image/:key) so every response returns a URL clients can actually load.
//
// Set PUBLIC_API_URL to this service's public base (including /v1) — it defaults
// to the production API.
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || 'https://api.cocarr.com/v1').replace(/\/+$/, '');

// Object keys are UUIDs. Historically the clients built the stored URL as
// `presignedUrl + key`, but the presigned URL is `<endpoint>/<bucket>` with NO
// trailing slash — producing `<endpoint>/<bucket><uuid>`. Using the whole path
// as the key therefore 404s, which is why stored images stopped rendering.
// Always prefer the trailing UUID when one is present: that repairs the existing
// records without a data migration.

// Keys may be `<folder>/<uuid>` (current) or a bare `<uuid>` (everything
// uploaded before folders existed). storageFolders.extractKey handles both —
// do not reimplement it here, or foldered keys get their prefix stripped and
// the proxy 404s.
const { extractKey } = require('./storageFolders');

const toPublicUrl = (raw) => {
  if (!raw || typeof raw !== 'string') return raw;

  const isProxied = raw.includes('/image/') && raw.startsWith(PUBLIC_API_URL);
  const hostMatch = raw.match(/^https?:\/\/([^/]+)\//);
  const isBucket = !!hostMatch && hostMatch[1].endsWith('storageapi.dev');

  // Leave anything that isn't ours (external/CDN images) untouched.
  if (!isProxied && !isBucket) return raw;

  const path = raw.replace(/^https?:\/\/[^/]+\//, '').replace(/^v\d+\/image\//, '');
  const key = extractKey(path);
  return key ? `${PUBLIC_API_URL}/image/${key}` : raw;
};

module.exports = { toPublicUrl, PUBLIC_API_URL, extractKey };
