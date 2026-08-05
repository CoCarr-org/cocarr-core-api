const { Op } = require('sequelize');
const moment = require('moment');
const RefundRequest = require('../models/refundRequest');
const Booking = require('../models/booking');
const Damage = require('../models/damage');
const Refund = require('../models/refund');
const Transaction = require('../models/transaction');
const ProtectionPlan = require('../models/protectionplan');
const VehiclePlan = require('../models/vehicleplan');
const Vehicle = require('../models/vehicle');
const User = require('../models/user');
const Settings = require('../models/settings');
const RazorpayInstance = require('../helper/payment');
const { logActivity } = require('./activityLogService');
const {
  BOOKING_FINISHED, BOOKING_CANCELLED,
  DAMAGE_PENDING, DAMAGE_APPROVED, DAMAGE_ASSESSED, DAMAGE_PAID,
  REFUND_PENDING,
} = require('../configs/constants');

// Rider refunds.
//
// Distinct from settlementService, which pays HOSTS for completed bookings.
// This returns the RIDER's security deposit, less whatever they owe.
//
// Timeline after a ride ends:
//   0–24h   host may report damage
//   0–7d    admin verifies the damage photos, then assessment estimates cost
//   day 7   the daily job writes eligible bookings into the refund list
//   then    an admin checks the figures and initiates the refund
//
// A booking only becomes eligible once nothing is still in flux — an open or
// unassessed claim means the deduction is unknown, and refunding then would
// either short-change the rider or hand back money that is owed.
//
// (This file replaced a dead stub that was never imported and called
// `db.transaction()` without importing `db`, and read `paymentId` off Booking
// where it lives on Transaction.)

const HOLD_DAYS = Number(process.env.REFUND_HOLD_DAYS || 7);
const DAMAGE_WINDOW_HOURS = Number(process.env.DAMAGE_REPORT_WINDOW_HOURS || 24);
const LATE_GRACE_HOURS = Number(process.env.LATE_RETURN_GRACE_HOURS || 1);

const httpError = (m, s) => Object.assign(new Error(m), { statusCode: s });
const badRequest = (m) => httpError(m, 400);
const notFound = (m) => httpError(m, 404);

const money = (n) => Math.max(0, Math.round(Number(n) || 0));

// ── Protection plan cover ─────────────────────────────────────────────────
// Each tier carries an accident cover amount, with a separate figure for
// luxury vehicles. Damage up to the cover is absorbed by the plan; the rider
// pays only the excess.
async function resolveDamageCover(booking, vehicle) {
  if (!booking.protectionPlan || !booking.protectionPlanTier) {
    return { cover: 0, reason: 'No protection plan on this booking' };
  }
  const plan = await ProtectionPlan.findByPk(booking.protectionPlan);
  if (!plan) return { cover: 0, reason: 'Protection plan record not found' };

  const luxury = !!vehicle?.isLuxury;
  const field = `${booking.protectionPlanTier}${luxury ? 'Luxury' : ''}AccidentAmount`;
  const cover = Number(plan[field] || 0);

  return {
    cover,
    tier: booking.protectionPlanTier,
    luxury,
    reason: cover
      ? `${booking.protectionPlanTier}${luxury ? ' (luxury)' : ''} covers up to ₹${cover}`
      : `No cover configured for ${field}`,
  };
}

const settingValue = async (type, fallback = 0) => {
  const row = await Settings.findOne({ where: { type } });
  return row ? Number(row.value) || 0 : fallback;
};

// ── The calculation ───────────────────────────────────────────────────────
async function calculateRefund(booking) {
  const vehicle = booking.vehicleId ? await Vehicle.findByPk(booking.vehicleId) : null;
  const lines = [];
  const deposit = money(booking.depositAmount);

  // ── Cancellation ──
  if (booking.status === BOOKING_CANCELLED) {
    // cancelledBy: 0 = user, 1 = admin, 2 = host.
    const byHost = booking.cancelledBy === 2;
    const byAdmin = booking.cancelledBy === 1;
    const fare = money(booking.totalAmount) - deposit - money(booking.convenienceFee);

    let refundableFare;
    let cancellationFee = 0;

    if (byHost || byAdmin) {
      // The rider did nothing wrong — everything back, convenience fee included.
      refundableFare = money(money(booking.totalAmount) - deposit);
      lines.push({ label: `Cancelled by ${byHost ? 'host' : 'admin'} — full refund`, amount: refundableFare });
    } else {
      // Rider cancelled: tiered policy, measured from cancellation to start.
      const hoursToStart = moment(booking.startTime).diff(moment(booking.updatedAt || new Date()), 'hours', true);
      if (hoursToStart > 24) {
        refundableFare = money(fare);
        lines.push({ label: 'Cancelled more than 24h before start — full fare', amount: refundableFare });
      } else if (hoursToStart >= 12) {
        refundableFare = money(fare * 0.5);
        cancellationFee = money(fare - refundableFare);
        lines.push({ label: 'Cancelled 12–24h before start — 50% of fare', amount: refundableFare });
      } else {
        refundableFare = 0;
        cancellationFee = money(fare);
        lines.push({ label: 'Cancelled under 12h before start — no fare refund', amount: 0 });
      }
      if (booking.protectionPlanFee) {
        lines.push({ label: 'Protection plan fee (non-refundable)', amount: -money(booking.protectionPlanFee) });
      }
      if (booking.convenienceFee) {
        lines.push({ label: 'Convenience fee (non-refundable)', amount: -money(booking.convenienceFee) });
      }
    }

    lines.push({ label: 'Security deposit returned', amount: deposit });

    return {
      type: 'cancellation',
      cancelledBy: byHost ? 'host' : byAdmin ? 'admin' : 'rider',
      depositAmount: deposit,
      refundableFare: money(refundableFare),
      cancellationFee,
      damageAmount: 0, damageCoveredByPlan: 0, damagePayable: 0,
      fuelCharge: 0, extraHourCharge: 0, extraKmCharge: 0, cleaningCharge: 0,
      totalDeductions: cancellationFee,
      refundAmount: money(deposit + refundableFare),
      shortfall: 0,
      lines,
    };
  }

  // ── Completed ride ──
  // Only assessed or paid claims carry a usable figure. Pending/approved means
  // the amount isn't settled and the booking shouldn't have reached here.
  const damages = await Damage.findAll({ where: { bookingId: booking.id } });
  const chargeable = damages.filter((d) => [DAMAGE_ASSESSED, DAMAGE_PAID].includes(d.damageStatus));
  const damageAmount = chargeable.reduce((a, d) => a + money(d.assessedAmount ?? d.damageAmount), 0);

  const { cover, reason: coverReason, tier } = await resolveDamageCover(booking, vehicle);
  const damageCoveredByPlan = Math.min(damageAmount, cover);
  const damagePayable = money(damageAmount - damageCoveredByPlan);

  if (damageAmount) {
    lines.push({ label: `Damage assessed (${chargeable.length} claim${chargeable.length === 1 ? '' : 's'})`, amount: -damageAmount });
    if (damageCoveredByPlan) lines.push({ label: `Covered by plan — ${coverReason}`, amount: damageCoveredByPlan });
    if (damagePayable) lines.push({ label: 'Damage excess payable by rider', amount: -damagePayable });
  }

  // Fuel returned below what it left with.
  let fuelCharge = 0;
  if (booking.startFuel != null && booking.endFuel != null) {
    const shortfall = Number(booking.startFuel) - Number(booking.endFuel);
    if (shortfall > 0) {
      const rate = await settingValue('fuel_charge_per_unit', 0);
      fuelCharge = money(shortfall * rate);
      lines.push({
        label: `Fuel shortfall ${shortfall} @ ₹${rate}`,
        amount: -fuelCharge,
        // Zero rate means nobody configured it — flag rather than silently
        // charging nothing and looking correct.
        warning: rate ? null : 'fuel_charge_per_unit is not configured, so no fuel charge was applied',
      });
    }
  }

  // Late return against the booked end time.
  let extraHourCharge = 0;
  if (booking.dropTime && booking.endTime) {
    const lateHours = moment(booking.dropTime).diff(moment(booking.endTime), 'hours', true);
    const billable = Math.ceil(Math.max(0, lateHours - LATE_GRACE_HOURS));
    if (billable > 0) {
      const plan = await VehiclePlan.findOne({ where: { vehicleId: booking.vehicleId } });
      const hourly = money(plan?.perHourFee || plan?.weekdayFee || 0);
      extraHourCharge = money(billable * hourly);
      lines.push({ label: `Late return ${billable}h beyond ${LATE_GRACE_HOURS}h grace @ ₹${hourly}/h`, amount: -extraHourCharge });
    }
  }

  // Distance beyond the included allowance.
  let extraKmCharge = 0;
  if (booking.startKms != null && booking.endKms != null && booking.kmAlloted) {
    const driven = Number(booking.endKms) - Number(booking.startKms);
    const excess = Math.max(0, driven - Number(booking.kmAlloted));
    if (excess > 0) {
      const rate = money(booking.extraKmFee);
      extraKmCharge = money(excess * rate);
      lines.push({ label: `${excess} km beyond ${booking.kmAlloted} km @ ₹${rate}/km`, amount: -extraKmCharge });
    }
  }

  const totalDeductions = money(damagePayable + fuelCharge + extraHourCharge + extraKmCharge);
  lines.push({ label: 'Security deposit', amount: deposit });

  return {
    type: 'ride_completion',
    depositAmount: deposit,
    refundableFare: 0,
    damageAmount, damageCoveredByPlan, damagePayable,
    protectionTier: tier || null,
    protectionCover: cover,
    fuelCharge, extraHourCharge, extraKmCharge, cleaningCharge: 0,
    cancellationFee: 0,
    totalDeductions,
    refundAmount: money(deposit - totalDeductions),
    // Deductions can exceed the deposit — the rider then OWES money, which is a
    // collection, not a refund. Surfaced so it doesn't silently clamp to zero.
    shortfall: money(totalDeductions - deposit),
    lines,
  };
}

// ── Eligibility ───────────────────────────────────────────────────────────
function damageBlocks(damages) {
  const open = damages.filter((d) => [DAMAGE_PENDING, DAMAGE_APPROVED].includes(d.damageStatus));
  if (!open.length) return null;
  const pending = open.filter((d) => d.damageStatus === DAMAGE_PENDING).length;
  const awaiting = open.filter((d) => d.damageStatus === DAMAGE_APPROVED).length;
  return [
    pending ? `${pending} claim(s) awaiting admin verification` : null,
    awaiting ? `${awaiting} claim(s) awaiting assessment` : null,
  ].filter(Boolean).join('; ');
}

// The daily job.
async function buildRefundList({ reference, dryRun = false, admin } = {}) {
  const now = reference ? new Date(reference) : new Date();
  const cutoff = moment(now).subtract(HOLD_DAYS, 'days').toDate();

  const candidates = await Booking.findAll({
    where: {
      [Op.or]: [
        { status: BOOKING_FINISHED, dropTime: { [Op.ne]: null, [Op.lte]: cutoff } },
        { status: BOOKING_FINISHED, dropTime: null, endTime: { [Op.lte]: cutoff } },
        { status: BOOKING_CANCELLED, updatedAt: { [Op.lte]: cutoff } },
      ],
    },
  });

  const result = { holdDays: HOLD_DAYS, cutoff, dryRun, created: [], skipped: [], blocked: [], totalRefundable: 0 };

  for (const booking of candidates) {
    try {
      const existing = await RefundRequest.findOne({ where: { bookingId: booking.id } });
      if (existing) {
        result.skipped.push({ bookingId: booking.bookingId, reason: `Already listed (${existing.status})` });
        continue;
      }

      if (booking.status === BOOKING_FINISHED) {
        const damages = await Damage.findAll({ where: { bookingId: booking.id } });
        const blocker = damageBlocks(damages);
        if (blocker) {
          // Not lost — becomes eligible on a later run once resolved.
          result.blocked.push({ bookingId: booking.bookingId, reason: blocker });
          continue;
        }
      }

      const calc = await calculateRefund(booking);
      const eligibleAt = moment(booking.dropTime || booking.endTime || booking.updatedAt)
        .add(HOLD_DAYS, 'days').toDate();

      result.totalRefundable += calc.refundAmount;

      if (dryRun) {
        result.created.push({
          bookingId: booking.bookingId, type: calc.type,
          refundAmount: calc.refundAmount, shortfall: calc.shortfall, calc,
        });
        continue;
      }

      const row = await RefundRequest.create({
        bookingId: booking.id,
        userId: booking.userId,
        type: calc.type,
        status: 'pending_review',
        depositAmount: calc.depositAmount,
        refundableFare: calc.refundableFare,
        damageAmount: calc.damageAmount,
        damageCoveredByPlan: calc.damageCoveredByPlan,
        damagePayable: calc.damagePayable,
        fuelCharge: calc.fuelCharge,
        extraHourCharge: calc.extraHourCharge,
        extraKmCharge: calc.extraKmCharge,
        cancellationFee: calc.cancellationFee,
        totalDeductions: calc.totalDeductions,
        calculatedAmount: calc.refundAmount,
        refundAmount: calc.refundAmount,
        calculation: calc,
        eligibleAt,
      });

      result.created.push({
        bookingId: booking.bookingId, refundRequestId: row.id,
        type: calc.type, refundAmount: calc.refundAmount, shortfall: calc.shortfall,
      });
    } catch (error) {
      console.error(`[refund] booking ${booking.bookingId} failed:`, error.message);
      result.skipped.push({ bookingId: booking.bookingId, reason: error.message });
    }
  }

  if (!dryRun && result.created.length) {
    await logActivity({
      adminId: admin?.id || null,
      adminName: admin?.name || 'Refund eligibility job',
      action: 'build', entityType: 'RefundRequest', entityId: null,
      changes: { created: result.created.length, blocked: result.blocked.length },
    });
  }

  return result;
}

// ── Admin reads ───────────────────────────────────────────────────────────
async function listRefundRequests(params = {}) {
  const offset = Number(params.offset) || 0;
  const limit = Math.min(Number(params.limit) || 20, 100);
  const where = {};
  if (params.status) where.status = params.status;
  if (params.type) where.type = params.type;

  const { count, rows } = await RefundRequest.findAndCountAll({
    where, offset, limit, order: [['eligibleAt', 'ASC']],
  });

  const bookingIds = [...new Set(rows.map((r) => r.bookingId))];
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const [bookings, users] = await Promise.all([
    bookingIds.length ? Booking.findAll({ where: { id: { [Op.in]: bookingIds } },
      attributes: ['id', 'bookingId', 'startTime', 'endTime', 'dropTime', 'status', 'totalAmount'] }) : [],
    userIds.length ? User.findAll({ where: { id: { [Op.in]: userIds } },
      attributes: ['id', 'name', 'email', 'contactNumber'] }) : [],
  ]);
  const bookingById = Object.fromEntries(bookings.map((b) => [b.id, b.toJSON()]));
  const userById = Object.fromEntries(users.map((u) => [u.id, u.toJSON()]));

  return {
    data: rows.map((r) => ({
      ...r.toJSON(),
      booking: bookingById[r.bookingId] || null,
      user: userById[r.userId] || null,
    })),
    totalCount: count,
    totals: {
      pending: await RefundRequest.sum('refundAmount', { where: { ...where, status: 'pending_review' } }) || 0,
      approved: await RefundRequest.sum('refundAmount', { where: { ...where, status: 'approved' } }) || 0,
      completed: await RefundRequest.sum('refundAmount', { where: { ...where, status: 'completed' } }) || 0,
    },
    counts: {
      pending_review: await RefundRequest.count({ where: { status: 'pending_review' } }),
      approved: await RefundRequest.count({ where: { status: 'approved' } }),
      processing: await RefundRequest.count({ where: { status: 'processing' } }),
      failed: await RefundRequest.count({ where: { status: 'failed' } }),
    },
  };
}

async function getRefundRequest(id) {
  const row = await RefundRequest.findByPk(id);
  if (!row) throw notFound('Refund request not found');

  const booking = await Booking.findByPk(row.bookingId);
  const user = await User.findByPk(row.userId, { attributes: ['id', 'name', 'email', 'contactNumber'] });
  const damages = booking ? await Damage.findAll({ where: { bookingId: booking.id } }) : [];

  return {
    ...row.toJSON(),
    booking: booking ? booking.toJSON() : null,
    user: user ? user.toJSON() : null,
    damages,
    // Recomputed live so the reviewer sees whether anything changed since the
    // job ran — an assessment finalised in the meantime, for instance.
    recalculated: booking ? await calculateRefund(booking) : null,
  };
}

// ── Admin decisions ───────────────────────────────────────────────────────
const EDITABLE = ['damagePayable', 'fuelCharge', 'extraHourCharge', 'extraKmCharge',
  'cleaningCharge', 'otherDeduction', 'cancellationFee'];

async function reviewRefundRequest(id, body, admin) {
  const row = await RefundRequest.findByPk(id);
  if (!row) throw notFound('Refund request not found');
  if (!['pending_review', 'approved'].includes(row.status)) {
    throw badRequest(`This refund is ${row.status} and can no longer be edited`);
  }

  const patch = {};
  for (const field of EDITABLE) {
    if (body[field] !== undefined) {
      const n = Number(body[field]);
      if (!Number.isFinite(n) || n < 0) throw badRequest(`${field} must be a positive number`);
      patch[field] = Math.round(n);
    }
  }
  if (body.otherDeductionReason !== undefined) patch.otherDeductionReason = body.otherDeductionReason;
  if (body.adminNotes !== undefined) patch.adminNotes = body.adminNotes;

  const merged = { ...row.toJSON(), ...patch };
  if (money(merged.otherDeduction) && !String(merged.otherDeductionReason || '').trim()) {
    throw badRequest('A reason is required for any additional deduction');
  }

  const totalDeductions = money(
    merged.damagePayable + merged.fuelCharge + merged.extraHourCharge
    + merged.extraKmCharge + merged.cleaningCharge + merged.otherDeduction + merged.cancellationFee,
  );
  patch.totalDeductions = totalDeductions;
  patch.refundAmount = money(merged.depositAmount + merged.refundableFare - totalDeductions);

  if (body.approve === true) {
    patch.status = 'approved';
    patch.reviewedByAdminId = admin?.id || null;
    patch.reviewedAt = new Date();
  }

  await row.update(patch);
  await logActivity({
    adminId: admin?.id, adminName: admin?.name,
    action: body.approve ? 'approve' : 'update',
    entityType: 'RefundRequest', entityId: id,
    // Keep the machine's figure alongside the human's so an override is visible.
    changes: { ...patch, calculatedAmount: row.calculatedAmount },
  });

  return getRefundRequest(id);
}

async function rejectRefundRequest(id, reason, admin) {
  const text = String(reason || '').trim();
  if (!text) throw badRequest('A reason is required when rejecting a refund');

  const row = await RefundRequest.findByPk(id);
  if (!row) throw notFound('Refund request not found');
  if (['processing', 'completed'].includes(row.status)) {
    throw badRequest(`This refund is already ${row.status}`);
  }

  await row.update({
    status: 'rejected', adminNotes: text,
    reviewedByAdminId: admin?.id || null, reviewedAt: new Date(),
  });
  await logActivity({
    adminId: admin?.id, adminName: admin?.name, action: 'reject',
    entityType: 'RefundRequest', entityId: id, changes: { reason: text },
  });
  return getRefundRequest(id);
}

// ── Processing ────────────────────────────────────────────────────────────
// Money goes back to the card/account that paid, so this is a PAYMENT REFUND
// against the original transaction — NOT a payout transfer. Transfers pay
// hosts, who never paid us in the first place; refunding a rider through one
// would send money from the platform balance with no link to their payment.
async function processRefund(id, admin) {
  const row = await RefundRequest.findByPk(id);
  if (!row) throw notFound('Refund request not found');
  if (row.status !== 'approved') {
    throw badRequest(`Only an approved refund can be sent (this one is ${row.status})`);
  }
  if (row.refundAmount <= 0) {
    throw badRequest('There is nothing to refund — deductions cover the whole deposit');
  }

  const booking = await Booking.findByPk(row.bookingId);
  if (!booking) throw notFound('Booking not found');

  const transaction = await Transaction.findByPk(booking.transactionId);
  if (!transaction?.paymentId) {
    throw badRequest('The original payment is missing, so there is nothing to refund against');
  }

  // Marked processing BEFORE the call: if the gateway succeeds but the response
  // never reaches us, the row must not still look sendable.
  await row.update({ status: 'processing', initiatedAt: new Date() });

  try {
    const response = await RazorpayInstance.payments.refund(transaction.paymentId, {
      amount: row.refundAmount * 100, // paise
      notes: { refundRequestId: row.id, bookingId: booking.bookingId },
    });

    // Mirror into the refund-transaction table the finance screens read.
    await Refund.create({
      bookingId: booking.id,
      paymentId: transaction.paymentId,
      transactionId: transaction.id,
      acquirer: response?.acquirer_data?.arn || response?.acquirer_data?.rrn || response?.acquirer_data?.utr || null,
      status: REFUND_PENDING,
      amount: row.refundAmount,
      initiatedTime: new Date(),
    });

    await row.update({
      gatewayRefundId: response.id,
      gatewayStatus: response.status || null,
      gatewayResponse: response,
      // Instant refunds report 'processed' straight away; anything else stays
      // processing until the webhook confirms.
      status: response.status === 'processed' ? 'completed' : 'processing',
      completedAt: response.status === 'processed' ? new Date() : null,
    });

    await logActivity({
      adminId: admin?.id, adminName: admin?.name, action: 'refund',
      entityType: 'RefundRequest', entityId: id,
      changes: { amount: row.refundAmount, gatewayRefundId: response.id },
    });

    return getRefundRequest(id);
  } catch (error) {
    const message = error?.error?.description || error.message;
    await row.update({ status: 'failed', failureReason: message });
    throw badRequest(`Refund failed: ${message}`);
  }
}

// Gateway status → ours, driven by the refund.* webhook.
const GATEWAY_MAP = { processed: 'completed', failed: 'failed', pending: 'processing' };

async function syncRefundFromGateway({ refundId, gatewayStatus, payload }) {
  if (!refundId) return { updated: false, reason: 'No refund id in payload' };

  const row = await RefundRequest.findOne({ where: { gatewayRefundId: refundId } });
  if (!row) return { updated: false, reason: `No refund request for ${refundId}` };

  const mapped = GATEWAY_MAP[String(gatewayStatus || '').toLowerCase()];
  const patch = { gatewayStatus: gatewayStatus || null };
  if (payload) patch.gatewayResponse = payload;
  if (mapped && mapped !== row.status) {
    patch.status = mapped;
    if (mapped === 'completed') patch.completedAt = new Date();
    if (mapped === 'failed') patch.failureReason = payload?.error_description || `Gateway reported "${gatewayStatus}"`;
  }
  await row.update(patch);

  if (patch.status) {
    await Refund.update(
      {
        status: patch.status === 'completed' ? 'processed' : patch.status === 'failed' ? 'failed' : REFUND_PENDING,
        executedTime: patch.status === 'completed' ? new Date() : null,
      },
      { where: { bookingId: row.bookingId } },
    );
  }

  return { updated: true, refundRequestId: row.id, status: patch.status || row.status };
}

module.exports = {
  HOLD_DAYS, DAMAGE_WINDOW_HOURS,
  calculateRefund, buildRefundList,
  listRefundRequests, getRefundRequest,
  reviewRefundRequest, rejectRefundRequest,
  processRefund, syncRefundFromGateway,
};
