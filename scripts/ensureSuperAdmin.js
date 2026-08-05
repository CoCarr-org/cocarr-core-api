/**
 * Runs the same bootstrap that happens on every boot, on demand — use it to
 * repair access without waiting for a redeploy.
 *
 *   railway run node scripts/ensureSuperAdmin.js
 *
 * Pass --reset-password (alias --reissue-link) for the recovery route when the
 * account exists but can't be signed in to:
 *   - with BOOTSTRAP_SUPER_ADMIN_PASSWORD set, it RESETS the Firebase password
 *     to that value so you can sign in immediately (the reliable path);
 *   - without it, it re-sends / prints a fresh set-password link.
 *
 *   BOOTSTRAP_SUPER_ADMIN_PASSWORD='Chosen#Pass1' \
 *     railway run node scripts/ensureSuperAdmin.js --reset-password
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const reissueResetLink = process.argv.slice(2).some(
  (a) => a === '--reset-password' || a === '--reissue-link',
);

const REQUIRED = ['ADMIN_SERVICE_ACCOUNT', 'DB_NAME', 'DB_USER', 'DB_PASS'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[bootstrap-admin] Missing required env: ${missing.join(', ')}\n` +
    '            Run on Railway: railway run node scripts/ensureSuperAdmin.js');
  process.exit(1);
}

const db = require('../src/configs/db');
const { ensureBootstrapSuperAdmin } = require('../src/services/bootstrapAdminService');

(async () => {
  await db.authenticate();
  const result = await ensureBootstrapSuperAdmin({ reissueResetLink });
  console.log('[bootstrap-admin] result:', JSON.stringify(result, null, 2));
  if (reissueResetLink) {
    if (result && result.passwordSet) {
      console.log(
        `\n[bootstrap-admin] The password for ${result.email} is now set to BOOTSTRAP_SUPER_ADMIN_PASSWORD.\n` +
        '            Sign in with that email + password at the admin panel.',
      );
    } else if (result && result.emailSent) {
      console.log(
        `\n[bootstrap-admin] A set-password link was emailed to ${result.email}.` +
        (result.resetLink ? `\n${result.resetLink}` : '') +
        '\n            Open it, set the password, then sign in at the admin panel. Single-use, expires.',
      );
    } else if (result && result.resetLink) {
      // Email couldn't be sent (e.g. SendGrid outage) — the link is the way in.
      console.log(
        `\n[bootstrap-admin] Email could not be sent; open this link to set the password instead:\n${result.resetLink}\n` +
        '            The link is single-use and expires — set the password promptly.',
      );
    } else {
      console.warn('[bootstrap-admin] Neither an email nor a link could be produced (see errors above).');
    }
  }
})()
  .catch((err) => { console.error('[bootstrap-admin] failed:', err); process.exitCode = 1; })
  .finally(async () => { await db.close().catch(() => {}); });
