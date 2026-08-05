#!/usr/bin/env node
// Copies the legacy referral columns off `users` into the decoupled referral
// tables:
//   users.referralCode      → referral_codes  (one row per owner)
//   users.referralCodeUsed  → referrals       (the "who referred me" link)
//
//   railway run node scripts/backfillReferralCodes.js --dry-run
//   railway run node scripts/backfillReferralCodes.js
//
// SAFE TO RE-RUN: a row is only created when it does not already exist, so a
// second run inserts nothing. It NEVER credits wallets and never touches the
// legacy columns — dropping those is a separate later step
// (scripts/dropLegacyReferralColumns.js), deliberately not automatic.
//
// Reads the legacy columns with raw SQL on purpose: they have been removed from
// the User model, so the ORM no longer knows about them.
const db = require('../src/configs/db');
require('../src/models/association');
const ReferralCode = require('../src/models/referralCode');
const Referral = require('../src/models/referral');

const dryRun = process.argv.includes('--dry-run');

(async () => {
  try {
    await db.authenticate();
    console.log(dryRun ? 'DRY RUN — nothing will be written\n' : 'Backfilling referral tables\n');

    // Guard: if the legacy columns are already gone, there is nothing to do.
    const [cols] = await db.query('SHOW COLUMNS FROM `users`');
    const have = new Set(cols.map((c) => c.Field));
    if (!have.has('referralCode') && !have.has('referralCodeUsed')) {
      console.log('Legacy columns already dropped — nothing to backfill.');
      process.exit(0);
    }

    // ── 1. Codes: users.referralCode → referral_codes ──
    const [owners] = await db.query(
      "SELECT id, referralCode, verificationStatus FROM `users` WHERE referralCode IS NOT NULL AND referralCode <> ''",
    );
    console.log(`Scanning ${owners.length} users with a code…`);
    let codesCreated = 0;
    let codesSkipped = 0;
    for (const u of owners) {
      const existing = await ReferralCode.findOne({ where: { userId: u.id } });
      if (existing) { codesSkipped += 1; continue; }
      // A code stays inactive unless its owner is already an active user.
      const active = u.verificationStatus === 'active';
      if (!dryRun) {
        await ReferralCode.create({
          userId: u.id,
          code: String(u.referralCode).trim().toUpperCase(),
          status: active ? 'active' : 'inactive',
          activatedAt: active ? new Date() : null,
        });
      }
      codesCreated += 1;
    }

    // ── 2. Links: users.referralCodeUsed → referrals ──
    // Map every existing code to its owner so we can resolve referralCodeUsed.
    const [codeRows] = await db.query(
      "SELECT id, referralCode FROM `users` WHERE referralCode IS NOT NULL AND referralCode <> ''",
    );
    const ownerByCode = new Map(
      codeRows.map((r) => [String(r.referralCode).trim().toUpperCase(), r.id]),
    );

    const [referred] = await db.query(
      "SELECT id, referralCodeUsed FROM `users` WHERE referralCodeUsed IS NOT NULL AND referralCodeUsed <> ''",
    );
    console.log(`Scanning ${referred.length} referred users…`);
    let linksCreated = 0;
    let linksSkipped = 0;
    let linksOrphaned = 0;
    for (const u of referred) {
      const code = String(u.referralCodeUsed).trim().toUpperCase();
      const referrerId = ownerByCode.get(code);
      if (!referrerId || referrerId === u.id) { linksOrphaned += 1; continue; }

      const existing = await Referral.findOne({ where: { refereeId: u.id } });
      if (existing) { linksSkipped += 1; continue; }
      if (!dryRun) {
        // These are legacy referrals from the old flow, which credited at
        // signup. Mark the sign-up stage done so activation does not re-credit.
        await Referral.create({
          referrerId, refereeId: u.id, referralCode: code,
          status: 'eligible', rewardStatus: 'partial', signupRewarded: true,
        });
      }
      linksCreated += 1;
    }

    console.log('\nSummary');
    console.log(`  referral_codes: created ${codesCreated}, skipped ${codesSkipped}`);
    console.log(`  referrals:      created ${linksCreated}, skipped ${linksSkipped}, orphaned(no matching code) ${linksOrphaned}`);
    if (dryRun) console.log('\nDry run — re-run without --dry-run to write.');
    process.exit(0);
  } catch (error) {
    console.error('Failed:', error?.parent?.sqlMessage || error.message);
    process.exit(1);
  }
})();
