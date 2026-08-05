#!/usr/bin/env node
// Daily refund eligibility, run by hand.
//
//   railway run node scripts/buildRefundList.js --dry-run
//   railway run node scripts/buildRefundList.js
//   railway run node scripts/buildRefundList.js --date=2026-08-01
//
// Creates review rows only — it never moves money.
const db = require('../src/configs/db');
require('../src/models/association');
const refundService = require('../src/services/refundService');

const dryRun = process.argv.includes('--dry-run');
const dateArg = process.argv.find((a) => a.startsWith('--date='));

(async () => {
  try {
    await db.authenticate();
    if (dryRun) console.log('DRY RUN — nothing written\n');

    const r = await refundService.buildRefundList({
      reference: dateArg ? dateArg.split('=')[1] : undefined,
      dryRun,
    });

    console.log(`Hold: ${r.holdDays} days · cutoff ${new Date(r.cutoff).toISOString()}\n`);
    console.log(`${dryRun ? 'Would add' : 'Added'}: ${r.created.length}`);
    r.created.forEach((c) => console.log(
      `  ${String(c.bookingId).padEnd(12)} ${c.type.padEnd(16)} ₹${c.refundAmount}`
      + (c.shortfall ? `  (rider owes ₹${c.shortfall})` : ''),
    ));

    if (r.blocked.length) {
      console.log(`\nHeld for open damage claims: ${r.blocked.length}`);
      r.blocked.forEach((b) => console.log(`  ${String(b.bookingId).padEnd(12)} ${b.reason}`));
    }
    if (r.skipped.length) {
      console.log(`\nSkipped: ${r.skipped.length}`);
      r.skipped.slice(0, 20).forEach((x) => console.log(`  ${String(x.bookingId).padEnd(12)} ${x.reason}`));
    }
    console.log(`\nTotal refundable: ₹${r.totalRefundable}`);
    process.exit(0);
  } catch (error) {
    console.error('Failed:', error?.parent?.sqlMessage || error.message);
    process.exit(1);
  }
})();
