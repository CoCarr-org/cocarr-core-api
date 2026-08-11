// Run under `railway run --service core` AFTER the MIGP_* reference probes are
// set. Resolves embedded-vault's credentials (injected here by Railway) and
// rewrites the DST_ block of migrate-buckets.env. Prints only non-secret values.
const fs = require('fs');

const outFile = process.argv[2];
if (!outFile) { console.error('usage: node _writeDst.js <migrate-buckets.env>'); process.exit(1); }

const pick = (...names) => {
  for (const n of names) {
    const v = process.env[n];
    if (v && !v.includes('${{')) return v; // skip unresolved references
  }
  return undefined;
};

const access = pick('MIGP_ACCESS');
const secret = pick('MIGP_SECRET');
const bucket = pick('MIGP_BUCKET_A', 'MIGP_BUCKET_B');
const endpoint = pick('MIGP_ENDPOINT_A', 'MIGP_ENDPOINT_B') || 'https://t3.storageapi.dev';
const region = pick('MIGP_REGION') || 'auto';

const missing = [];
if (!bucket) missing.push('bucket name');
if (!access) missing.push('access key');
if (!secret) missing.push('secret key');
if (missing.length) {
  console.error(`FATAL: could not resolve from embedded-vault: ${missing.join(', ')}.`);
  console.error('The bucket may expose different variable names — check its Variables tab.');
  process.exit(1);
}

let existing = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
existing = existing.split('\n').filter((l) => !/^export DST_/.test(l)).join('\n').replace(/\n+$/, '');

const q = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;
const dstBlock = [
  '', '# DST = embedded-vault (resolved from Railway)',
  `export DST_ENDPOINT=${q(endpoint)}`,
  `export DST_REGION=${q(region)}`,
  `export DST_BUCKET=${q(bucket)}`,
  `export DST_ACCESS_KEY_ID=${q(access)}`,
  `export DST_SECRET_ACCESS_KEY=${q(secret)}`,
  '',
].join('\n');

fs.writeFileSync(outFile, `${existing}\n${dstBlock}`);
console.log(`DST resolved -> bucket=${bucket}  region=${region}  endpoint=${endpoint}`);
