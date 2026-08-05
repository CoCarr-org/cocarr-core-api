const express = require('express');
const router = express.Router();
const payoutController = require('../controllers/payoutController');
const { authenticateAdmin } = require('../middlewares/authMiddleware');

// Get payout calculation for a booking
router.get('/calculate/:bookingId', authenticateAdmin, payoutController.calculateBookingPayout);

// Create payout ledger entry
router.post('/ledger', authenticateAdmin, payoutController.createPayoutLedger);

// Get pending payouts for a host
router.get('/host/:hostId/pending', authenticateAdmin, payoutController.getHostPendingPayouts);

// Process host payout via Razorpay
router.post('/host/:hostId/process', authenticateAdmin, payoutController.processHostPayout);

// Get payout summary
router.get('/summary', authenticateAdmin, payoutController.getPayoutSummary);

// Get upcoming scheduled payouts (within X days)
router.get('/scheduled', authenticateAdmin, payoutController.getUpcomingScheduledPayouts);

// Manually trigger scheduled payout processing (for testing/admin override)
router.post('/scheduled/process', authenticateAdmin, payoutController.processScheduledPayouts);

module.exports = router;
