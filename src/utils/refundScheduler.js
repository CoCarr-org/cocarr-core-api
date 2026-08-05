const cron = require('node-cron');
const refundService = require('../services/refundService');

// Daily refund-eligibility job.
//
// Writes bookings whose hold period has elapsed into the refund list. It does
// NOT move money — an admin reviews each entry and initiates the refund. That
// separation is deliberate: the job decides *what is due for review*, a human
// decides *what gets paid*.
//
// Timezone is pinned for the same reason as the settlement job: on a UTC
// server an unpinned "06:30" fires at noon IST and the day boundary the
// 7-day cutoff is measured against shifts.
const SCHEDULE = process.env.REFUND_CRON || '30 6 * * *'; // every day 06:30
const TIMEZONE = process.env.REFUND_TIMEZONE || 'Asia/Kolkata';

// On by default, unlike the settlement job — this one only creates review
// rows, it never pays anyone, so there is no money risk in it running.
const ENABLED = process.env.REFUND_CRON_ENABLED !== 'false';

let instance = null;

const initializeRefundScheduler = () => {
  if (!ENABLED) {
    console.log(`⏸️  Refund eligibility job is OFF (REFUND_CRON_ENABLED=false). Would run "${SCHEDULE}" ${TIMEZONE}`);
    return null;
  }
  if (!cron.validate(SCHEDULE)) {
    console.error(`❌ Invalid REFUND_CRON "${SCHEDULE}" — refund job not scheduled`);
    return null;
  }

  instance = cron.schedule(SCHEDULE, async () => {
    console.log('💰 Refund eligibility run starting…');
    try {
      const r = await refundService.buildRefundList({});
      console.log(
        `✅ Refund run: ${r.created.length} added to the list (₹${r.totalRefundable}), `
        + `${r.blocked.length} held for open damage claims, ${r.skipped.length} skipped`,
      );
      if (r.blocked.length) {
        console.log('   held:', r.blocked.slice(0, 5).map((b) => `${b.bookingId} (${b.reason})`).join(', '));
      }
    } catch (error) {
      // Never let this take the process down.
      console.error('❌ Refund eligibility run failed:', error.message);
    }
  }, { timezone: TIMEZONE });

  console.log(`✨ Refund eligibility job scheduled — "${SCHEDULE}" (${TIMEZONE}), ${refundService.HOLD_DAYS}-day hold`);
  return instance;
};

const stopRefundScheduler = () => {
  if (instance) { instance.stop(); console.log('⏹️  Refund eligibility job stopped'); }
};

const getRefundSchedulerStatus = () => ({
  enabled: ENABLED, running: !!instance, schedule: SCHEDULE,
  timezone: TIMEZONE, holdDays: refundService.HOLD_DAYS,
});

module.exports = { initializeRefundScheduler, stopRefundScheduler, getRefundSchedulerStatus };
