const { DataTypes } = require('sequelize');
const db = require('../configs/db');

// The refund list — one row per booking that owes the rider money back.
//
// Deliberately NOT the same as `refund`. That table records a gateway refund
// TRANSACTION (payment id, acquirer reference, processed/failed). This is the
// workflow that decides how much to refund in the first place: what the deposit
// was, what is being deducted and why, and who signed it off. One refundRequest
// produces at most one gateway refund, and keeping them apart means a failed
// gateway call doesn't destroy the calculation behind it.
//
// Rows are created by the daily eligibility job, never by hand.
const RefundRequest = db.define('refundRequest', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

  bookingId: { type: DataTypes.UUID, allowNull: false },
  userId: { type: DataTypes.STRING, allowNull: false },

  // ride_completion — the 7-day window after a finished ride has elapsed.
  // cancellation    — the booking was cancelled; policy decides the amount.
  type: {
    type: DataTypes.ENUM,
    values: ['ride_completion', 'cancellation'],
    allowNull: false,
  },

  // pending_review — the job built it; an admin has not confirmed the figures
  // approved       — admin confirmed the calculation, not yet sent
  // processing     — sent to the gateway, awaiting its final word
  // completed      — gateway confirmed the money moved
  // failed         — gateway rejected or the refund failed
  // rejected       — admin decided nothing is owed
  status: {
    type: DataTypes.ENUM,
    values: ['pending_review', 'approved', 'processing', 'completed', 'failed', 'rejected'],
    defaultValue: 'pending_review',
  },

  // ── What the rider paid in ──
  depositAmount: { type: DataTypes.INTEGER, defaultValue: 0 },
  // Cancellations refund fare too, not just the deposit.
  refundableFare: { type: DataTypes.INTEGER, defaultValue: 0 },

  // ── Deductions ──
  // Raw assessed damage across every claim on the booking.
  damageAmount: { type: DataTypes.INTEGER, defaultValue: 0 },
  // How much of that the rider's protection plan absorbs.
  damageCoveredByPlan: { type: DataTypes.INTEGER, defaultValue: 0 },
  // The excess the rider actually pays — damageAmount minus the cover.
  damagePayable: { type: DataTypes.INTEGER, defaultValue: 0 },
  fuelCharge: { type: DataTypes.INTEGER, defaultValue: 0 },
  extraHourCharge: { type: DataTypes.INTEGER, defaultValue: 0 },
  extraKmCharge: { type: DataTypes.INTEGER, defaultValue: 0 },
  cleaningCharge: { type: DataTypes.INTEGER, defaultValue: 0 },
  cancellationFee: { type: DataTypes.INTEGER, defaultValue: 0 },
  // Anything the admin adds by hand, with a reason.
  otherDeduction: { type: DataTypes.INTEGER, defaultValue: 0 },
  otherDeductionReason: { type: DataTypes.TEXT },

  totalDeductions: { type: DataTypes.INTEGER, defaultValue: 0 },

  // What the job computed, kept separate from what the admin approved so an
  // override is visible rather than silently replacing the calculation.
  calculatedAmount: { type: DataTypes.INTEGER, defaultValue: 0 },
  refundAmount: { type: DataTypes.INTEGER, defaultValue: 0 },

  // Full breakdown as computed, for audit — the numbers above can be edited by
  // an admin, this records what the rules produced.
  calculation: { type: DataTypes.JSON },

  // When the booking became eligible (ride end + 7 days, or cancellation + 7).
  eligibleAt: { type: DataTypes.DATE },

  reviewedByAdminId: { type: DataTypes.UUID },
  reviewedAt: { type: DataTypes.DATE },
  adminNotes: { type: DataTypes.TEXT },

  // ── Gateway ──
  gatewayRefundId: { type: DataTypes.STRING },
  gatewayStatus: { type: DataTypes.STRING },
  gatewayResponse: { type: DataTypes.JSON },
  failureReason: { type: DataTypes.TEXT },
  initiatedAt: { type: DataTypes.DATE },
  completedAt: { type: DataTypes.DATE },
}, {
  indexes: [
    // One refund request per booking. This is what makes the daily job safe to
    // re-run: a second pass hits the constraint instead of refunding twice.
    { unique: true, fields: ['bookingId'] },
    { fields: ['status'] },
  ],
});

module.exports = RefundRequest;
