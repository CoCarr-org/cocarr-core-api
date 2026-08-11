// Uploaded objects live in a private S3-compatible bucket, so the raw bucket
// URL returns 403 for clients. Rewrite stored URLs to the API's image proxy
// (GET /image/:key) so every response returns a URL clients can actually load.
//
// Set PUBLIC_API_URL to this service's public base (including /v1) — it defaults
// to the production API.
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || 'https://api.cocarr.com/v1').replace(/\/+$/, '');

// THE DEFAULT IS THE LEGACY MONOLITH, and on the platform it is the wrong
// answer. Every image URL this module emits is absolute and is what the admin
// panels and both apps put in an <img src>, so an unset PUBLIC_API_URL sends
// every client to `api.cocarr.com` — a different system from the gateway
// (`apis-dev.cocarr.com/v1/core`), and one that may no longer serve these
// objects at all. The symptom is broken images everywhere and a healthy-looking
// API, which is a long way from the cause.
//
// It stays a default rather than a hard requirement because the legacy
// deployment still uses it correctly, but say so on boot: this is one env var
// between working images and a panel full of holes.
if (!process.env.PUBLIC_API_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    `[publicUrl] PUBLIC_API_URL is not set — image URLs will be built against ${PUBLIC_API_URL} `
    + '(the LEGACY monolith). On the platform set it to this service\'s public base '
    + 'INCLUDING the gateway prefix, e.g. https://apis-dev.cocarr.com/v1/core',
  );
}

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

// A stored value that is ALREADY proxied, but against a different host, must be
// rebuilt — not returned as-is.
//
// This is what left the admin panels pointing at the retired deployment. The
// check used to be `raw.startsWith(PUBLIC_API_URL)`, so a value written when
// PUBLIC_API_URL was the legacy monolith (`https://api.cocarr.com/v1/image/...`)
// matched neither `isProxied` (wrong host) nor `isBucket` (the host is ours, not
// the bucket's) and fell through to "leave anything that isn't ours untouched".
// The API then handed clients an absolute URL to a host that no longer serves
// those objects — one broken image at a time, which reads as missing data
// rather than as a stale base URL.
//
// So: recognise ANY `/image/<key>` path as ours, whatever host it names, and
// rebuild it against the CURRENT PUBLIC_API_URL. `extractKey` must return a real
// object key for that to happen, which is what keeps a genuinely external URL
// that merely contains `/image/` (a CDN path, say) from being rewritten.
const KEY_RE = new RegExp(
  '^(?:[a-z-]+/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  'i',
);

const toPublicUrl = (raw) => {
  if (!raw || typeof raw !== 'string') return raw;

  const hostMatch = raw.match(/^https?:\/\/([^/]+)\//);
  const isBucket = !!hostMatch && hostMatch[1].endsWith('storageapi.dev');
  const looksProxied = raw.includes('/image/');

  // Leave anything that isn't ours (external/CDN images) untouched.
  if (!looksProxied && !isBucket) return raw;

  const path = raw.replace(/^https?:\/\/[^/]+\//, '').replace(/^v\d+\/image\//, '');
  const key = extractKey(path);
  // Only rewrite when what we pulled out is actually one of our object keys.
  // Without this, `looksProxied` would capture an unrelated URL that happens to
  // contain `/image/` and point it at our proxy, where it would 404.
  if (!key || (!isBucket && !KEY_RE.test(key))) return raw;
  return `${PUBLIC_API_URL}/image/${key}`;
};

module.exports = { toPublicUrl, PUBLIC_API_URL, extractKey };
