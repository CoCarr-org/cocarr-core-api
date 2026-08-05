const referralService = require('../services/referralService');

// Grants the first-booking referral reward when a referred user completes a
// booking. Listens to the same `bookingConfirmed` event the notification
// subscriber uses. handleFirstBooking is idempotent and no-ops for users who
// were not referred, so it is safe to run on every confirmation.
const onBookingConfirmed = async ({ userId }) => {
  try {
    await referralService.handleFirstBooking(userId);
  } catch (error) {
    // Never let a reward failure bubble into the booking flow.
    console.log('[referral] first-booking reward skipped:', error?.message);
  }
};

module.exports.loadReferralListeners = (emitter) => {
  emitter.on('bookingConfirmed', onBookingConfirmed);
};
