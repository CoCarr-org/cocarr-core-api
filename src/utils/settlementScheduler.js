const cron = require('node-cron');
const settlementService = require('../services/settlementService');

// Weekly host settlement job.
//
// Runs Monday morning and settles the week that just ended (Mon 00:00 to
// Sun 23:59:59). Distinct from payoutScheduler, which runs hourly and only
// builds per-booking ledger rows — this one groups those rows per host and
// actually moves the money.
//
// Timezone is pinned rather than inherited from the host: on a UTC server an
// unpinned "Monday 06:00" fires at 11:30 IST Monday and, worse, the window
// boundaries would be computed against a different day. SETTLEMENT_TIMEZONE
// overrides it if the business ever moves.
const SCHEDULE = process.env.SETTLEMENT_CRON || '0 6 * * 1'; // Monday 06:00
const TIMEZONE = process.env.SETTLEMENT_TIMEZONE || 'Asia/Kolkata';

// Off by default. Turning this on starts moving real money on a timer, which
// should be a deliberate act after a dry run has been reviewed — not something
// that begins the moment this code deploys.
const ENABLED = process.env.SETTLEMENT_CRON_ENABLED === 'true';

let instance = null;

const initializeSettlementScheduler = () => {
  if (!ENABLED) {
    console.log(`⏸️  Weekly settlement job is OFF (set SETTLEMENT_CRON_ENABLED=true to enable). Schedule would be "${SCHEDULE}" ${TIMEZONE}`);
    return null;
  }
  if (!cron.validate(SCHEDULE)) {
    console.error(`❌ Invalid SETTLEMENT_CRON "${SCHEDULE}" — weekly settlement not scheduled`);
    return null;
  }

  instance = cron.schedule(SCHEDULE, async () => {
    const startedAt = new Date();
    console.log('💸 Weekly settlement run starting…');
    try {
      const result = await settlementService.runWeeklySettlement({});
      const submitted = result.settlements.filter((s) => s.status === 'submitted').length;
      const failed = result.settlements.filter((s) => s.status === 'failed').length;
      console.log(
        `✅ Settlement run finished in ${Math.round((Date.now() - startedAt) / 1000)}s — `
        + `${submitted} submitted, ${failed} failed, ${result.skipped.length} skipped, `
        + `₹${result.totals.netPayable} across ${result.totals.bookings} bookings`,
      );
      if (failed > 0) {
        console.error('⚠️  Failed settlements need attention in Finance › Settlements');
      }
    } catch (error) {
      // Never let a settlement failure take the process down.
      console.error('❌ Weekly settlement run failed:', error.message, error.stack);
    }
  }, { timezone: TIMEZONE });

  console.log(`✨ Weekly settlement job scheduled — "${SCHEDULE}" (${TIMEZONE})`);
  return instance;
};

const stopSettlementScheduler = () => {
  if (instance) {
    instance.stop();
    console.log('⏹️  Weekly settlement job stopped');
  }
};

const getSettlementSchedulerStatus = () => ({
  enabled: ENABLED,
  running: !!instance,
  schedule: SCHEDULE,
  timezone: TIMEZONE,
});

module.exports = { initializeSettlementScheduler, stopSettlementScheduler, getSettlementSchedulerStatus };
