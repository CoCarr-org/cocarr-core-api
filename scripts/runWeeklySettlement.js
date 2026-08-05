#!/usr/bin/env node
// Manual weekly settlement run.
//
//   railway run node scripts/runWeeklySettlement.js --dry-run
//   railway run node scripts/runWeeklySettlement.js
//
// Needs DB_* and PG_KEY/PG_SEC, so run it where those live. ALWAYS dry-run
// first: without the flag this moves real money.
const db = require('../src/configs/db');
require('../src/models/association');
const settlementService = require('../src/services/settlementService');

const dryRun = process.argv.includes('--dry-run');
const refArg = process.argv.find((a) => a.startsWith('--date='));
const reference = refArg ? new Date(refArg.split('=')[1]) : undefined;

(async () => {
  try {
    await db.authenticate();
    if (dryRun) console.log('DRY RUN — no records created, no money moved\n');

    const r = await settlementService.runWeeklySettlement({ reference, dryRun });

    console.log(`Period: ${r.period.periodStart.toISOString()} to ${r.period.periodEnd.toISOString()}`);
    console.log(`Hosts considered: ${r.hostsConsidered}\n`);

    for (const s of r.settlements) {
      console.log(`  ${String(s.hostName || s.hostId).padEnd(28)} ${String(s.status).padEnd(12)} `
        + `net ₹${s.netPayable} over ${s.bookingCount} booking(s)`
        + (s.heldBookingCount ? ` — ${s.heldBookingCount} held (₹${s.heldAmount})` : '')
        + (s.error ? `\n      error: ${s.error}` : ''));
    }
    if (r.skipped.length) {
      console.log('\nSkipped:');
      r.skipped.forEach((s) => console.log(`  ${String(s.hostName || s.hostId).padEnd(28)} ${s.reason}`));
    }
    console.log(`\nTotal net payable: ₹${r.totals.netPayable} across ${r.totals.bookings} bookings`);
    console.log(`Held pending damage/dispute: ₹${r.totals.held}`);
    process.exit(0);
  } catch (error) {
    console.error('Settlement run failed:', error.message);
    process.exit(1);
  }
})();
