const cron = require('node-cron');
const payoutService = require('../services/payoutService');

/**
 * Payout Scheduler
 * Runs every hour to check for bookings that ended 48+ hours ago
 * and automatically creates payout ledgers for them
 */

let schedulerInstance = null;

/**
 * Initialize the payout scheduler
 * Should be called once when the app starts
 */
const initializePayoutScheduler = () => {
  // Schedule to run every hour at minute 0
  schedulerInstance = cron.schedule('0 * * * *', async () => {
    console.log('🔄 Running scheduled payout ledger creation...');
    try {
      const result = await payoutService.processScheduledPayouts();
      
      if (result.successCount > 0) {
        console.log(`✅ Payout scheduler: Successfully created ${result.successCount} ledgers`);
      }
      if (result.failedCount > 0) {
        console.log(`⚠️  Payout scheduler: Failed to create ${result.failedCount} ledgers`);
      }
      if (result.processedCount === 0) {
        console.log('ℹ️  Payout scheduler: No bookings eligible for payout yet');
      }
    } catch (error) {
      console.error('❌ Payout scheduler error:', error.message);
    }
  });

  console.log('✨ Payout scheduler initialized - will run every hour at minute 0');
  return schedulerInstance;
};

/**
 * Stop the payout scheduler
 * Can be called during app shutdown
 */
const stopPayoutScheduler = () => {
  if (schedulerInstance) {
    schedulerInstance.stop();
    console.log('⏹️  Payout scheduler stopped');
  }
};

/**
 * Get scheduler status
 */
const getSchedulerStatus = () => {
  if (!schedulerInstance) {
    return { status: 'not_initialized' };
  }

  return {
    status: 'running',
    nextRun: 'Every hour at :00',
    lastRun: new Date()
  };
};

module.exports = {
  initializePayoutScheduler,
  stopPayoutScheduler,
  getSchedulerStatus
};
