#!/usr/bin/env node
// Finds users with more than one host row, and merges them onto one.
//
//   railway run node scripts/findDuplicateHosts.js --dry-run
//   railway run node scripts/findDuplicateHosts.js --confirm
//
// WHY THERE ARE DUPLICATES. `host.userId` has no unique constraint — it is
// commented out on the model — and `createHost` created a row every time it was
// called rather than returning the existing one. Becoming a host twice therefore
// produced two identities for one person, each with its own 30% commission row,
// and their cars split between them.
//
// WHAT THAT BROKE. Every lookup was a bare `Host.findOne({ where: { userId } })`
// with no ordering, which MySQL may answer with either row. The listing wizard
// attached a car to whichever row it resolved; the dashboard read whichever row
// IT resolved. When those differed the car existed, belonged to the user, and
// was invisible — the host added a car and it simply was not there, with the
// count agreeing they had none.
//
// The code no longer creates duplicates (createHost is idempotent) and the host
// car reads span every row a user has, so nothing is hidden even before this
// runs. This is the cleanup that makes the data match the model again, and it
// is what has to happen before a unique index can be added.
//
// SAFE TO RE-RUN. It picks the OLDEST row as canonical — same rule
// `resolveHost` applies, so the merge target is the row everything already
// resolves to — repoints the others' rows at it, and deletes only host rows it
// has emptied.
const db = require('../src/configs/db');
require('../src/models/association');
const Host = require('../src/models/host');
const Vehicle = require('../src/models/vehicle');
const HostPayoutAccount = require('../src/models/hostPayoutAccount');
const HostCommission = require('../src/models/hostCommission');

const confirm = process.argv.includes('--confirm');
const dryRun = !confirm;

// Everything keyed by hostId that has to follow the merge. Missing one leaves a
// row pointing at a host that no longer exists, which is worse than the
// duplicate — so the delete below refuses if anything is left behind.
const DEPENDENTS = [
  { model: Vehicle, label: 'vehicles' },
  { model: HostPayoutAccount, label: 'payout accounts' },
  { model: HostCommission, label: 'commissions' },
];

(async () => {
  try {
    await db.authenticate();
    console.log(dryRun
      ? 'DRY RUN — nothing will be written. Re-run with --confirm to apply.\n'
      : 'Merging duplicate host rows\n');

    const hosts = await Host.findAll({
      attributes: ['id', 'userId', 'createdAt', 'name'],
      order: [['createdAt', 'ASC']],
    });

    const byUser = new Map();
    for (const host of hosts) {
      if (!host.userId) continue;
      if (!byUser.has(host.userId)) byUser.set(host.userId, []);
      byUser.get(host.userId).push(host);
    }

    const duplicates = [...byUser.entries()].filter(([, rows]) => rows.length > 1);
    console.log(`${hosts.length} host row(s), ${byUser.size} user(s), ${duplicates.length} with duplicates.\n`);

    if (!duplicates.length) {
      console.log('Nothing to merge. `host.userId` could now carry a unique index safely —');
      console.log('see the note in src/models/host.js before adding one.');
      process.exit(0);
    }

    let moved = 0;
    let removed = 0;

    for (const [userId, rows] of duplicates) {
      // Oldest first (the query orders by createdAt), which is the same row
      // resolveHost returns — so the survivor is the one everything already
      // points at, and nothing has to be re-resolved afterwards.
      const [keep, ...extras] = rows;
      console.log(`user ${userId}: keeping ${keep.id}, merging ${extras.length}`);

      for (const extra of extras) {
        for (const { model, label } of DEPENDENTS) {
          const count = await model.count({ where: { hostId: extra.id } });
          if (!count) continue;
          console.log(`  ${dryRun ? 'would move' : 'moving'} ${count} ${label} from ${extra.id}`);
          if (!dryRun) await model.update({ hostId: keep.id }, { where: { hostId: extra.id } });
          moved += count;
        }

        if (dryRun) { removed += 1; continue; }

        // Re-count rather than trusting the moves above: a dependent this script
        // does not know about would otherwise be orphaned by the delete, and an
        // orphan is a worse problem than the duplicate it came from.
        const leftovers = [];
        for (const { model, label } of DEPENDENTS) {
          const count = await model.count({ where: { hostId: extra.id } });
          if (count) leftovers.push(`${count} ${label}`);
        }
        if (leftovers.length) {
          console.log(`  KEPT ${extra.id} — still referenced by ${leftovers.join(', ')}`);
          continue;
        }
        await Host.destroy({ where: { id: extra.id } });
        removed += 1;
      }
    }

    console.log(`\n${dryRun ? 'Would move' : 'Moved'}: ${moved} row(s)`);
    console.log(`${dryRun ? 'Would remove' : 'Removed'}: ${removed} duplicate host row(s)`);
    if (dryRun) console.log('\nRe-run with --confirm to apply.');
    process.exit(0);
  } catch (error) {
    console.error(`\nFailed: ${error?.parent?.sqlMessage || error.message}`);
    process.exit(1);
  } finally {
    await db.close().catch(() => {});
  }
})();
