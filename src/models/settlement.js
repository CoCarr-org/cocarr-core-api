const { DataTypes } = require('sequelize');
const db = require('../configs/db');

// One row per host per weekly settlement period.
//
// Deliberately separate from the booking: booking.status keeps its existing
// five values and is never touched by settlement, so nothing across the four
// clients that filters on booking status can break. The per-booking maths
// (commission, GST, net payable) already lives on hostPayoutLedger — this
// record is the weekly BATCH that groups those ledger rows for one host and
// tracks the single payment made against them.
const Settlement = db.define('settlement', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

  hostId: { type: DataTypes.UUID, allowNull: false },

  // Monday 00:00:00 to Sunday 23:59:59 of the settled week.
  periodStart: { type: DataTypes.DATE, allowNull: false },
  periodEnd: { type: DataTypes.DATE, allowNull: false },

  bookingCount: { type: DataTypes.INTEGER, defaultValue: 0 },

  // Mirrored from the summed ledger rows so the batch stays readable even if
  // a ledger row is later corrected.
  grossAmount: { type: DataTypes.INTEGER, defaultValue: 0 },
  commissionAmount: { type: DataTypes.INTEGER, defaultValue: 0 },
  gstAmount: { type: DataTypes.INTEGER, defaultValue: 0 },
  netPayable: { type: DataTypes.INTEGER, defaultValue: 0 },

  // pending    — built, not yet sent to the gateway
  // submitted  — sent; awaiting the gateway's final word
  // paid       — gateway confirmed the money moved
  // failed     — gateway rejected or the transfer failed
  // on_hold    — nothing settleable this week (all bookings held), kept as a
  //              record that the host WAS considered
  // cancelled  — voided by an admin before submission
  status: {
    type: DataTypes.ENUM,
    values: ['pending', 'submitted', 'paid', 'failed', 'on_hold', 'cancelled'],
    defaultValue: 'pending',
  },

  // Gateway linkage. gatewayStatus is the provider's raw status string, kept
  // verbatim for support/debugging rather than squashed into ours.
  gatewayTransferId: { type: DataTypes.STRING, allowNull: true },
  gatewayStatus: { type: DataTypes.STRING, allowNull: true },
  gatewayResponse: { type: DataTypes.JSON, allowNull: true },
  failureReason: { type: DataTypes.TEXT, allowNull: true },

  // Bookings excluded from this batch because a damage claim or dispute was
  // still open. Held bookings are not lost — they become eligible for a later
  // run once resolved.
  heldBookingCount: { type: DataTypes.INTEGER, defaultValue: 0 },
  heldAmount: { type: DataTypes.INTEGER, defaultValue: 0 },

  submittedAt: { type: DataTypes.DATE, allowNull: true },
  paidAt: { type: DataTypes.DATE, allowNull: true },
}, {
  indexes: [
    // A host gets exactly one settlement per period. This is what makes the
    // Monday job safe to re-run: a second run for the same week hits this
    // constraint instead of paying the host twice.
    { unique: true, fields: ['hostId', 'periodStart'] },
  ],
});

module.exports = Settlement;
