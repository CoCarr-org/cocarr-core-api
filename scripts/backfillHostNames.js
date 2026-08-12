#!/usr/bin/env node
// Fills in the name (and contact details) every existing host row is missing.
//
//   railway run node scripts/backfillHostNames.js --dry-run
//   railway run node scripts/backfillHostNames.js --confirm
//
// WHY THERE IS ANYTHING TO BACKFILL. `createHost` copied `userInfo.name` into
// `hosts.name`, and `users.name` is NULL for anyone who signed up through the
// OTP flow — the onboarding wizard writes `firstName`/`lastName` and never
// touches `name` (see utils/userDisplayName.js). So essentially every host was
// created with a blank name, and the ops panel rendered "Unnamed host" about
// people whose name was in the user row the whole time. The same NULL reaches
// the vehicle, damage, settlement and bank-account screens.
//
// The code fix stops new hosts being created that way and keeps the copy in step
// afterwards (services/hostIdentityService.js + the User hook in
// models/association.js). This is the one-off for rows that already exist.
//
// SAFE TO RE-RUN, and safe on production:
//   - It only ever FILLS IN or CORRECTS from the user row. It never blanks a
//     value the host already holds from an empty user field — a host who typed
//     their details into the old become-a-host form keeps them.
//   - It writes nothing at all without --confirm.
//   - A host whose user genuinely has no name is left NULL and reported, because
//     "Unnamed host" is a true statement about them and inventing a placeholder
//     would hide the ones that need chasing.
const db = require('../src/configs/db');
require('../src/models/association');
const Host = require('../src/models/host');
const User = require('../src/models/user');
const { hostPatchFor } = require('../src/services/hostIdentityService');
const { DISPLAY_NAME_ATTRIBUTES } = require('../src/utils/userDisplayName');

const confirm = process.argv.includes('--confirm');
const dryRun = !confirm;

(async () => {
  try {
    await db.authenticate();
    console.log(dryRun
      ? 'DRY RUN — nothing will be written. Re-run with --confirm to apply.\n'
      : 'Backfilling host names from their user rows\n');

    const hosts = await Host.findAll({
      attributes: ['id', 'userId', 'name', 'email', 'contactNumber', 'countryCode'],
    });
    console.log(`Scanning ${hosts.length} hosts…\n`);

    // One query for every user, not one per host. `DISPLAY_NAME_ATTRIBUTES` is
    // the documented set the name resolver reads — selecting fewer would make it
    // silently fall through and produce a worse answer than no answer.
    const userIds = [...new Set(hosts.map((h) => h.userId).filter(Boolean))];
    const users = await User.findAll({
      where: { id: userIds },
      attributes: ['id', ...DISPLAY_NAME_ATTRIBUTES, 'countryCode'],
    });
    const byId = Object.fromEntries(users.map((u) => [u.id, u]));

    let updated = 0;
    let alreadyFine = 0;
    const orphaned = [];
    const stillNameless = [];

    for (const host of hosts) {
      const user = byId[host.userId];
      // A host row pointing at a user that no longer exists. Reported rather
      // than skipped in silence — it is a data problem worth someone seeing.
      if (!user) { orphaned.push(host.id); continue; }

      const patch = hostPatchFor(user, host);

      // Asked BEFORE the update, because `host.update` mutates the instance —
      // and asked on every path, not just the no-op one. A host can be patched
      // with a phone number and still come out of this without a name, which is
      // exactly the row someone needs to see.
      if (!(patch.name || host.name)) stillNameless.push({ hostId: host.id, userId: host.userId });

      if (!Object.keys(patch).length) {
        alreadyFine += 1;
        continue;
      }

      const summary = Object.entries(patch)
        .map(([field, value]) => `${field}: ${host[field] ?? '∅'} → ${value}`)
        .join(', ');
      console.log(`  ${dryRun ? 'would update' : 'updating'} ${host.id}  ${summary}`);
      if (!dryRun) await host.update(patch);
      updated += 1;
    }

    console.log(`\n${dryRun ? 'Would update' : 'Updated'}: ${updated}`);
    console.log(`Already in step with their user: ${alreadyFine}`);

    if (stillNameless.length) {
      console.log(`\nStill without a name (${stillNameless.length}) — their USER has no `
        + 'firstName/lastName/name either, so there is nothing to copy. These are the '
        + 'hosts who never completed onboarding:');
      stillNameless.forEach((h) => console.log(`  host ${h.hostId}  user ${h.userId}`));
    }

    if (orphaned.length) {
      console.log(`\nHost rows whose user is missing (${orphaned.length}): ${orphaned.join(', ')}`);
    }

    if (dryRun && updated) console.log('\nRe-run with --confirm to apply.');
    process.exit(0);
  } catch (error) {
    console.error(`\nBackfill failed: ${error?.parent?.sqlMessage || error.message}`);
    process.exit(1);
  } finally {
    await db.close().catch(() => {});
  }
})();
