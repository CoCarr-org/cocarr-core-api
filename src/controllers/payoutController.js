const payoutService = require('../services/payoutService');

const calculateBookingPayout = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const payout = await payoutService.calculateBookingPayout(bookingId);
    res.json(payout);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const createPayoutLedger = async (req, res) => {
  try {
    const { bookingId } = req.body;
    const ledger = await payoutService.createPayoutLedger(bookingId);
    res.status(201).json(ledger);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getHostPendingPayouts = async (req, res) => {
  try {
    const { hostId } = req.params;
    const payouts = await payoutService.getHostPendingPayouts(hostId);
    res.json(payouts);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const processHostPayout = async (req, res) => {
  try {
    const { hostId } = req.params;
    const result = await payoutService.processHostPayout(hostId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getPayoutSummary = async (req, res) => {
  try {
    const summary = await payoutService.getPayoutSummary();
    res.json(summary);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getUpcomingScheduledPayouts = async (req, res) => {
  try {
    const { daysAhead = 7 } = req.query;
    const upcoming = await payoutService.getUpcomingScheduledPayouts(parseInt(daysAhead));
    res.json({
      daysAhead: parseInt(daysAhead),
      count: upcoming.length,
      upcomingPayouts: upcoming
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const processScheduledPayouts = async (req, res) => {
  try {
    const result = await payoutService.processScheduledPayouts();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports = {
  calculateBookingPayout,
  createPayoutLedger,
  getHostPendingPayouts,
  processHostPayout,
  getPayoutSummary,
  getUpcomingScheduledPayouts,
  processScheduledPayouts
};
