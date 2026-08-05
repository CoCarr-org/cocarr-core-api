const { v4: uuidv4 } = require('uuid');
const adminAuth = require('../helper/adminAuth');
const Admin = require('../models/admin');
const { ADMIN_ROLES } = require('../utils/adminRoles');

// The break-glass Super Administrator.
//
// This account is guaranteed to exist, be active, and hold SUPER_ADMIN on
// every single boot — on a brand-new instance, a restored backup, or after
// someone accidentally demotes or deactivates it. It is the reason RBAC
// enforcement can be turned on safely: however badly the permission matrix
// is misconfigured, this account can always get back in and fix it.
//
// Overridable with BOOTSTRAP_SUPER_ADMIN_EMAIL if the owning account ever
// changes — but there must always be exactly one, and it must be an address
// whose Firebase sign-in the operator controls.
const BOOTSTRAP_EMAIL = (process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || 'cocarrluxury23@gmail.com').toLowerCase();

// A KNOWN sign-in password for the bootstrap super admin — the PRIMARY way in.
//
// IMPORTANT: this must be set on the BACKEND service (where this code runs),
// not on the admin-panel service.
//
// When set, the account's Firebase password is set/enforced to this value on
// every boot, so the operator can sign in immediately with the email + this
// password — no email involved. Sending a set-password email is only a FALLBACK
// for when this is NOT configured. Firebase requires at least 6 characters.
const BOOTSTRAP_PASSWORD = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD || '';

async function findOrCreateFirebaseUser(log) {
  try {
    const existing = await adminAuth.getUserByEmail(BOOTSTRAP_EMAIL);
    log.log(`[bootstrap-admin]   Firebase account already exists (uid=${existing.uid}).`);
    return { user: existing, created: false };
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    log.log('[bootstrap-admin]   no Firebase account found — creating one…');
  }

  // No Firebase account in the admin project yet — create one. Use the
  // configured password when present so the account is immediately usable;
  // otherwise a random one, which then REQUIRES the set-password email fallback.
  const user = await adminAuth.createUser({
    email: BOOTSTRAP_EMAIL,
    emailVerified: true,
    password: BOOTSTRAP_PASSWORD || uuidv4(),
    displayName: 'Super Administrator',
  });
  log.warn(`[bootstrap-admin]   created Firebase account for ${BOOTSTRAP_EMAIL} (uid=${user.uid}).`);
  return { user, created: true };
}

/**
 * Idempotent. Safe to run on every boot.
 *
 * @param {object}  [opts]
 * @param {Console} [opts.log]
 * @param {boolean} [opts.reissueResetLink]  Only relevant when no
 *   BOOTSTRAP_SUPER_ADMIN_PASSWORD is configured: re-send the set-password
 *   email/link for an already-existing account. Also driven by
 *   BOOTSTRAP_REISSUE_RESET_LINK=true. Ignored when a password is configured,
 *   since that path already gives a known, working password.
 * @returns {Promise<{email:string, uid:string, action:string, passwordSet:boolean, emailSent:boolean, resetLink:string|null}>}
 */
async function ensureBootstrapSuperAdmin({ log = console, reissueResetLink = false } = {}) {
  log.log('[bootstrap-admin] ── Ensuring super admin exists (runs on every deploy/boot) ──');

  // Step 1 — config check.
  log.log(`[bootstrap-admin] Step 1/5: checking configuration for ${BOOTSTRAP_EMAIL}`);
  if (!process.env.ADMIN_SERVICE_ACCOUNT) {
    log.warn('[bootstrap-admin] skipped — ADMIN_SERVICE_ACCOUNT not set, cannot reach the admin Firebase project.');
    return null;
  }
  log.log(`[bootstrap-admin]   BOOTSTRAP_SUPER_ADMIN_PASSWORD is ${BOOTSTRAP_PASSWORD ? 'SET (known-password sign-in)' : 'NOT set (will fall back to a set-password email)'}.`);

  const reissue = reissueResetLink || process.env.BOOTSTRAP_REISSUE_RESET_LINK === 'true';

  // Step 2 — Firebase account.
  log.log('[bootstrap-admin] Step 2/5: ensuring the Firebase (admin project) account');
  const { user, created } = await findOrCreateFirebaseUser(log);

  // Step 3 — password. This is the PRIMARY sign-in mechanism: whenever a
  // password is configured, set/enforce it (on a new account it was set at
  // creation; on an existing one we reset it), so login always works. A failure
  // here (e.g. the password is under 6 chars) is logged but does not abort the
  // rest of the bootstrap.
  log.log('[bootstrap-admin] Step 3/5: password');
  let passwordSet = false;
  if (BOOTSTRAP_PASSWORD) {
    try {
      if (!created) {
        await adminAuth.updateUser(user.uid, { password: BOOTSTRAP_PASSWORD });
      }
      passwordSet = true;
      log.warn(`[bootstrap-admin]   password ${created ? 'set' : 'reset'} to BOOTSTRAP_SUPER_ADMIN_PASSWORD — you can sign in now.`);
    } catch (error) {
      log.error('[bootstrap-admin]   FAILED to set password (must be at least 6 characters & meet Firebase rules):', error.message);
    }
  } else {
    log.log('[bootstrap-admin]   no password configured — will use the email fallback below.');
  }

  // Step 4 — admins table row.
  log.log('[bootstrap-admin] Step 4/5: ensuring the row in the admins table');
  // Match on uid first, then fall back to email — an older row may predate
  // this account being linked to its current Firebase uid.
  let admin = await Admin.findOne({ where: { uid: user.uid } });
  if (!admin) admin = await Admin.findOne({ where: { email: BOOTSTRAP_EMAIL } });

  let action;
  if (!admin) {
    log.log('[bootstrap-admin]   no admins row found — creating one as SUPER_ADMIN…');
    admin = await Admin.create({
      uid: user.uid,
      name: user.displayName || 'Super Administrator',
      email: BOOTSTRAP_EMAIL,
      // mobile is NOT NULL on the model; empty string rather than a fake number.
      mobile: '',
      role: ADMIN_ROLES.SUPER_ADMIN,
      isActive: true,
    });
    log.warn(`[bootstrap-admin]   created admins row (id=${admin.id}, role=SUPER_ADMIN, active).`);
    action = 'created';
  } else {
    log.log(`[bootstrap-admin]   admins row found (id=${admin.id}) — verifying uid/role/isActive…`);
    // Force the three fields that matter for access back to correct. Anything
    // else (name, mobile) is left as-is — this account is administered like
    // any other, and bootstrap only guarantees existence, role and isActive.
    const needsFix =
      admin.uid !== user.uid ||
      admin.role !== ADMIN_ROLES.SUPER_ADMIN ||
      admin.isActive !== true;

    if (needsFix) {
      const before = { uid: admin.uid, role: admin.role, isActive: admin.isActive };
      await admin.update({ uid: user.uid, role: ADMIN_ROLES.SUPER_ADMIN, isActive: true });
      log.warn(`[bootstrap-admin]   repaired ${BOOTSTRAP_EMAIL}: ${JSON.stringify(before)} -> role=${ADMIN_ROLES.SUPER_ADMIN}, isActive=true`);
      action = 'repaired';
    } else {
      log.log('[bootstrap-admin]   admins row already correct — nothing to change.');
      action = 'ok';
    }
  }

  // Step 5 — sign-in delivery. Known password wins; email is only the fallback.
  log.log('[bootstrap-admin] Step 5/5: sign-in');
  let resetLink = null;
  let emailSent = false;

  if (passwordSet) {
    log.log(`[bootstrap-admin]   sign in at the admin panel with ${BOOTSTRAP_EMAIL} and the configured password.`);
  } else if (BOOTSTRAP_PASSWORD) {
    // Configured, but Step 3 failed — emailing won't help; the operator must fix it.
    log.error('[bootstrap-admin]   password was configured but could not be set (see the error above). Fix BOOTSTRAP_SUPER_ADMIN_PASSWORD and redeploy.');
  } else if (created || reissue) {
    log.log(`[bootstrap-admin]   sending set-password email (${created ? 'first-time account' : 'reissue requested'})`);
    const { sendPasswordSetupEmail, generateResetLink } = require('./adminAuthService');
    try {
      resetLink = await sendPasswordSetupEmail(BOOTSTRAP_EMAIL, { firstTime: created });
      emailSent = true;
      log.warn(`[bootstrap-admin]   set-password email sent to ${BOOTSTRAP_EMAIL}.`);
    } catch (error) {
      log.error('[bootstrap-admin]   could not send set-password email:', error.message);
      try {
        resetLink = await generateResetLink(BOOTSTRAP_EMAIL);
        log.warn(`[bootstrap-admin]   fallback — set the password using this link (valid once, expires): ${resetLink}`);
      } catch (linkError) {
        log.error('[bootstrap-admin]   could not generate set-password link:', linkError.message);
      }
    }
    log.warn('[bootstrap-admin]   TIP: set BOOTSTRAP_SUPER_ADMIN_PASSWORD (on the BACKEND service) for reliable known-password sign-in instead of relying on email.');
  } else {
    log.log('[bootstrap-admin]   account already set up. Set BOOTSTRAP_SUPER_ADMIN_PASSWORD (backend) for a known password, or BOOTSTRAP_REISSUE_RESET_LINK=true to re-send a set-password email.');
  }

  log.log(`[bootstrap-admin] ✔ Done — ${BOOTSTRAP_EMAIL} is ${action} (uid=${user.uid}, role=SUPER_ADMIN, active${passwordSet ? ', password set' : ''}${emailSent ? ', set-password email sent' : ''}).`);
  return { email: BOOTSTRAP_EMAIL, uid: user.uid, action, passwordSet, emailSent, resetLink };
}

module.exports = { ensureBootstrapSuperAdmin, BOOTSTRAP_EMAIL };
