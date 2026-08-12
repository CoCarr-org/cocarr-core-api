// THE DEVELOPMENT BYPASS, AND THE ONE PLACE THAT DECIDES WHETHER IT IS ON.
//
// WHAT IT IS FOR. Aadhaar e-KYC and document OCR both go to Cashfree, and a
// development environment usually cannot reach it — the server IP is not on the
// provider's allowlist, and sandbox Aadhaar numbers do not receive a real OTP on
// anybody's phone. Without a way past that, nobody can test anything downstream
// of verification without holding a real Aadhaar card and the phone registered
// against it.
//
// WHAT IT IS NOT. It does not skip the uploads. A bypassed run still stores the
// same rows, in the same order, with the same shape — only the two calls that
// leave our network are answered locally. That is deliberate: a bypass that
// jumps the whole flow tests none of it, and the bugs live in the flow.
//
// ── THE FAIL-SAFE IS THE POINT OF THIS FILE ────────────────────────────────
//
// Every path that cannot positively establish "the flag is on" returns FALSE and
// the real provider is called. No row, no table, a database that will not answer,
// a typo in the key, a flag deleted from the ops portal — all of them mean the
// real flow, because the failure that matters is the silent one: verification
// quietly stops being verification and every user is waved through while the
// screens still say "verified".
//
// That is not hypothetical. `BYPASS_RC_VERIFY` and `BYPASS_AADHAAR_VERIFY` were
// hardcoded `true` in the mobile app's constants.js, so the SHIPPING app skipped
// both checks for every user, with nothing in any admin screen saying so. Moving
// the decision here — server-side, one key, visible and switchable in the ops
// portal, and off unless someone deliberately turned it on — is the whole reason
// this exists.
//
// ── Precedence ─────────────────────────────────────────────────────────────
//   1. VERIFICATION_PROVIDER_BYPASS=true|false   env, wins outright
//   2. the featureFlag row (ops portal)
//   3. OFF
//
// The env override is first so a local machine can work without touching shared
// state, and so an environment can pin the bypass OFF in a way the ops portal
// cannot override — set it to `false` in production and no admin can turn
// verification off by accident.
const FeatureFlag = require('../models/featureFlag');

const BYPASS_FLAG_KEY = 'verification.providerBypass';

// Kept here rather than in a seed script so the row's wording travels with the
// code that honours it — an ops admin toggling this needs to know what it does.
const BYPASS_FLAG_SEED = {
  key: BYPASS_FLAG_KEY,
  label: 'Bypass KYC & OCR provider calls',
  description:
    'DEVELOPMENT ONLY. Skips the Cashfree calls for Aadhaar OTP and document OCR '
    + 'so the flow can be tested without a real Aadhaar card. Documents must still '
    + 'be uploaded. Never enable on production — verification stops verifying.',
  isEnabled: false,
};

// Never throws, never returns undefined. See the fail-safe note above.
async function isProviderBypassEnabled() {
  const env = process.env.VERIFICATION_PROVIDER_BYPASS;
  if (env === 'true') return true;
  if (env === 'false') return false;

  try {
    const flag = await FeatureFlag.findOne({ where: { key: BYPASS_FLAG_KEY } });
    // `!!` matters: a missing row is null, and null must read as OFF rather than
    // as "unknown" — there is no third state a caller could do anything with.
    return !!flag?.isEnabled;
  } catch (error) {
    // A database that cannot answer is not permission to skip verification.
    console.error(
      `[verification] could not read ${BYPASS_FLAG_KEY} — using the real provider: ${error.message}`,
    );
    return false;
  }
}

// Creates the row if absent, and NEVER changes an existing one — an admin who
// turned this on for an afternoon must not have it flipped back by a redeploy,
// and one who turned it off must not have it flipped on.
async function ensureBypassFlag() {
  try {
    await FeatureFlag.findOrCreate({
      where: { key: BYPASS_FLAG_KEY },
      defaults: BYPASS_FLAG_SEED,
    });
  } catch (error) {
    // Seeding is a convenience; a failure here must not stop the service booting.
    console.error(`[verification] could not seed ${BYPASS_FLAG_KEY}: ${error.message}`);
  }
}

// One line, on every bypassed call, naming the user it applied to. A bypass that
// leaves no trace is indistinguishable afterwards from a verification that
// actually happened — and somebody WILL have to answer which it was.
function logBypass(what, userId) {
  console.warn(
    `[verification] PROVIDER BYPASS ACTIVE — ${what} was NOT checked with the provider `
    + `for user ${userId || 'unknown'}. This is a development setting.`,
  );
}

module.exports = {
  isProviderBypassEnabled,
  ensureBypassFlag,
  logBypass,
  BYPASS_FLAG_KEY,
  BYPASS_FLAG_SEED,
};
