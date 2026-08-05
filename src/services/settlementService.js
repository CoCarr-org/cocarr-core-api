const { Op } = require('sequelize');
const moment = require('moment');
const db = require('../configs/db');
const Settlement = require('../models/settlement');
const HostPayoutLedger = require('../models/hostPayoutLedger');
const HostPayoutAccount = require('../models/hostPayoutAccount');
const Booking = require('../models/booking');
const Host = require('../models/host');
const Damage = require('../models/damage');
const Dispute = require('../models/dispute');
const payoutService = require('./payoutService');
const RazorpayInstance = require('../helper/payment');
const { logActivity } = require('./activityLogService');
const {
  BOOKING_FINISHED, DAMAGE_PENDING, DAMAGE_APPROVED,
} = require('../configs/constants');

// Weekly host settlement.
//
// Runs every Monday morning over the week that just ended. For each host it
// collects the bookings that completed in that window, sums the per-booking
// ledger rows (which already carry commission and GST), and submits ONE
// transfer per host to the payment gateway. The gateway's own status is then
// mirrored back onto the settlement by the webhook.

// ── Period ────────────────────────────────────────────────────────────────
// Monday 00:00:00.000 through Sunday 23:59:59.999 of the PREVIOUS week.
// Using moment's isoWeek so the week always starts Monday regardless of the
// server's locale — the default `week` starts Sunday in some locales, which
// would silently shift every settlement by a day.
function getSettlementWindow(reference = new Date()) {
  const lastWeek = moment(reference).subtract(1, 'week');
  return {
    periodStart: lastWeek.clone().startOf('isoWeek').toDate(),
    periodEnd: lastWeek.clone().endOf('isoWeek').toDate(),
  };
}

// ── Eligibility ───────────────────────────────────────────────────────────
// A booking is only settleable once every claim against it is resolved.
//
// Damage: 'pending' is obviously unresolved. 'approved' is ALSO unresolved —
// it means money is owed but not yet collected, so paying the host now would
// settle against an amount still in flux. Only 'rejected' and 'paid' are done.
// Dispute: 'open' and 'investigating' are unresolved.
async function findUnresolvedHolds(bookingIds) {
  if (!bookingIds.length) return { heldIds: new Set(), reasons: {} };

  const [damages, disputes] = await Promise.all([
    Damage.findAll({
      where: {
        bookingId: { [Op.in]: bookingIds },
        damageStatus: { [Op.in]: [DAMAGE_PENDING, DAMAGE_APPROVED] },
      },
      attributes: ['bookingId', 'damageStatus'],
      raw: true,
    }),
    Dispute.findAll({
      where: {
        bookingId: { [Op.in]: bookingIds },
        status: { [Op.in]: ['open', 'investigating'] },
      },
      attributes: ['bookingId', 'status'],
      raw: true,
    }).catch(() => []), // dispute.bookingId may not exist in every deployment
  ]);

  const heldIds = new Set();
  const reasons = {};
  const note = (id, text) => {
    heldIds.add(id);
    reasons[id] = reasons[id] ? `${reasons[id]}; ${text}` : text;
  };

  damages.forEach((d) => note(d.bookingId, `damage claim ${d.damageStatus}`));
  disputes.forEach((d) => note(d.bookingId, `dispute ${d.status}`));

  return { heldIds, reasons };
}

// ── Build ─────────────────────────────────────────────────────────────────
// Collects settleable bookings for the window and groups them by host.
async function collectSettleableBookings({ periodStart, periodEnd }) {
  // Completion is judged on dropTime (when the ride actually ended), falling
  // back to endTime for older rows where dropTime was never recorded.
  const bookings = await Booking.findAll({
    where: {
      status: BOOKING_FINISHED,
      [Op.or]: [
        { dropTime: { [Op.between]: [periodStart, periodEnd] } },
        { dropTime: null, endTime: { [Op.between]: [periodStart, periodEnd] } },
      ],
    },
    attributes: ['id', 'bookingId', 'hostId', 'totalAmount', 'dropTime', 'endTime'],
  });

  const withHost = bookings.filter((b) => b.hostId);
  const { heldIds, reasons } = await findUnresolvedHolds(withHost.map((b) => b.id));

  const byHost = {};
  for (const booking of withHost) {
    const bucket = byHost[booking.hostId] || (byHost[booking.hostId] = { settleable: [], held: [] });
    if (heldIds.has(booking.id)) {
      bucket.held.push({ booking, reason: reasons[booking.id] });
    } else {
      bucket.settleable.push(booking);
    }
  }
  return byHost;
}

// Every settleable booking needs a ledger row. The hourly payout scheduler
// normally creates these 48h after a ride ends, but a booking that ended late
// in the week may not have one yet — so build any that are missing rather than
// silently dropping the host's money from the batch.
async function ensureLedgerRows(bookings) {
  const existing = await HostPayoutLedger.findAll({
    where: { bookingId: { [Op.in]: bookings.map((b) => b.id) } },
  });
  const haveFor = new Set(existing.map((l) => l.bookingId));
  const ledgers = [...existing];

  for (const booking of bookings) {
    if (haveFor.has(booking.id)) continue;
    try {
      ledgers.push(await payoutService.createPayoutLedger(booking.id));
    } catch (error) {
      // A booking whose payout can't be computed (missing commission config,
      // unpaid transaction) is skipped, not fatal — the rest of the host's
      // week still settles and this one is picked up by a later run.
      console.error(`[settlement] could not build ledger for booking ${booking.bookingId}:`, error.message);
    }
  }
  // Only unsettled rows may join a new batch.
  return ledgers.filter((l) => !l.settlementId);
}

const sum = (rows, field) => rows.reduce((a, r) => a + Number(r[field] || 0), 0);

// ── Gateway submission ────────────────────────────────────────────────────
async function submitToGateway(settlement, host) {
  const accounts = await HostPayoutAccount.findAll({
    where: { hostId: host.id, isActive: true },
    order: [['createdAt', 'DESC']],
  });
  const account = accounts.find((a) => a.isVerified) || null;

  if (!account) {
    throw new Error(accounts.length
      ? 'Host has a payout account but it is not verified'
      : 'Host has no payout account on file');
  }
  if (!account.razorpayContactId) {
    throw new Error('Host payout account is not linked to the payment gateway');
  }

  const transfer = await RazorpayInstance.transfers.create({
    account: account.razorpayContactId,
    // Razorpay works in paise.
    amount: Math.round(settlement.netPayable * 100),
    currency: 'INR',
    // Deterministic from host + period, so a retry of the same week is
    // recognisable in the gateway dashboard rather than looking like a new payout.
    receipt: `stl_${host.id.slice(0, 8)}_${moment(settlement.periodStart).format('YYYYMMDD')}`,
    notes: {
      settlementId: settlement.id,
      hostId: host.id,
      period: `${moment(settlement.periodStart).format('YYYY-MM-DD')} to ${moment(settlement.periodEnd).format('YYYY-MM-DD')}`,
      bookings: String(settlement.bookingCount),
    },
  });

  return transfer;
}

// ── The run ───────────────────────────────────────────────────────────────
// `dryRun` builds and reports everything without creating rows or moving money
// — always worth doing before the first live Monday.
async function runWeeklySettlement({ reference, dryRun = false, admin } = {}) {
  const window = getSettlementWindow(reference);
  const byHost = await collectSettleableBookings(window);
  const hostIds = Object.keys(byHost);

  const results = {
    period: window,
    dryRun,
    hostsConsidered: hostIds.length,
    settlements: [],
    skipped: [],
    totals: { netPayable: 0, held: 0, bookings: 0 },
  };

  for (const hostId of hostIds) {
    const { settleable, held } = byHost[hostId];
    const heldAmount = held.reduce((a, h) => a + Number(h.booking.totalAmount || 0), 0);

    try {
      const host = await Host.findByPk(hostId);
      if (!host) {
        results.skipped.push({ hostId, reason: 'Host record not found' });
        continue;
      }

      // Re-running the same week must not pay twice.
      const already = await Settlement.findOne({
        where: { hostId, periodStart: window.periodStart },
      });
      if (already) {
        results.skipped.push({
          hostId, hostName: host.name,
          reason: `Already settled for this period (${already.status})`,
          settlementId: already.id,
        });
        continue;
      }

      if (!settleable.length) {
        results.skipped.push({
          hostId, hostName: host.name,
          reason: held.length
            ? `All ${held.length} booking(s) held pending damage/dispute resolution`
            : 'No completed bookings in period',
          heldBookings: held.length,
        });
        continue;
      }

      const ledgers = await ensureLedgerRows(settleable);
      if (!ledgers.length) {
        results.skipped.push({ hostId, hostName: host.name, reason: 'No payable ledger rows could be built' });
        continue;
      }

      const netPayable = sum(ledgers, 'hostPayableAmount');
      const draft = {
        hostId,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
        bookingCount: ledgers.length,
        grossAmount: sum(ledgers, 'totalGrossAmount'),
        commissionAmount: sum(ledgers, 'commissionAmount'),
        gstAmount: sum(ledgers, 'gstAmount'),
        netPayable,
        heldBookingCount: held.length,
        heldAmount,
      };

      if (dryRun) {
        results.settlements.push({ ...draft, hostName: host.name, status: 'would-submit' });
        results.totals.netPayable += netPayable;
        results.totals.held += heldAmount;
        results.totals.bookings += ledgers.length;
        continue;
      }

      // Claim the ledger rows and create the batch in one transaction, so a
      // crash mid-run can't leave rows attached to a settlement that vanished.
      const settlement = await db.transaction(async (t) => {
        const created = await Settlement.create(draft, { transaction: t });
        await HostPayoutLedger.update(
          { settlementId: created.id },
          { where: { id: { [Op.in]: ledgers.map((l) => l.id) } }, transaction: t },
        );
        return created;
      });

      // Money movement happens OUTSIDE the transaction. If it were inside, a
      // gateway timeout would roll back the record of a transfer that may
      // actually have gone through.
      if (netPayable <= 0) {
        await settlement.update({ status: 'on_hold', failureReason: 'Net payable is zero or negative' });
        results.settlements.push({ ...draft, hostName: host.name, settlementId: settlement.id, status: 'on_hold' });
        continue;
      }

      try {
        const transfer = await submitToGateway(settlement, host);
        await settlement.update({
          status: 'submitted',
          gatewayTransferId: transfer.id,
          gatewayStatus: transfer.status || null,
          gatewayResponse: transfer,
          submittedAt: new Date(),
        });
        await HostPayoutLedger.update(
          { payoutStatus: 'processed', razorpayTransferId: transfer.id, payoutDate: new Date() },
          { where: { settlementId: settlement.id } },
        );
        results.settlements.push({
          ...draft, hostName: host.name, settlementId: settlement.id,
          status: 'submitted', transferId: transfer.id,
        });
      } catch (error) {
        // The batch stays, marked failed with the reason — an admin can see
        // exactly which host didn't get paid and why, and retry it.
        await settlement.update({ status: 'failed', failureReason: error.message });
        results.settlements.push({
          ...draft, hostName: host.name, settlementId: settlement.id,
          status: 'failed', error: error.message,
        });
      }

      results.totals.netPayable += netPayable;
      results.totals.held += heldAmount;
      results.totals.bookings += ledgers.length;
    } catch (error) {
      console.error(`[settlement] host ${hostId} failed:`, error.message);
      results.skipped.push({ hostId, reason: error.message });
    }
  }

  if (!dryRun) {
    await logActivity({
      adminId: admin?.id || null,
      adminName: admin?.name || 'Weekly settlement job',
      action: 'run', entityType: 'Settlement', entityId: null,
      changes: {
        period: `${moment(window.periodStart).format('YYYY-MM-DD')} to ${moment(window.periodEnd).format('YYYY-MM-DD')}`,
        settlements: results.settlements.length,
        totalNetPayable: results.totals.netPayable,
      },
    });
  }

  return results;
}

// ── Gateway status sync ───────────────────────────────────────────────────
// Razorpay transfer states → ours. Anything unrecognised leaves our status
// alone but still records the raw value, so an unexpected state is visible
// rather than silently treated as success.
const GATEWAY_STATUS_MAP = {
  processed: 'paid',
  settled: 'paid',
  reversed: 'failed',
  failed: 'failed',
  pending: 'submitted',
  queued: 'submitted',
  processing: 'submitted',
};

async function syncFromGateway({ transferId, gatewayStatus, payload }) {
  if (!transferId) return { updated: false, reason: 'No transfer id in payload' };

  const settlement = await Settlement.findOne({ where: { gatewayTransferId: transferId } });
  if (!settlement) return { updated: false, reason: `No settlement for transfer ${transferId}` };

  const mapped = GATEWAY_STATUS_MAP[String(gatewayStatus || '').toLowerCase()];
  const patch = { gatewayStatus: gatewayStatus || null };
  if (payload) patch.gatewayResponse = payload;

  if (mapped && mapped !== settlement.status) {
    patch.status = mapped;
    if (mapped === 'paid') patch.paidAt = new Date();
    if (mapped === 'failed') {
      patch.failureReason = payload?.error_description || `Gateway reported "${gatewayStatus}"`;
    }
  }

  await settlement.update(patch);

  // Keep the per-booking ledger rows in step with the batch.
  if (patch.status === 'paid') {
    await HostPayoutLedger.update({ payoutStatus: 'completed' }, { where: { settlementId: settlement.id } });
  } else if (patch.status === 'failed') {
    await HostPayoutLedger.update(
      { payoutStatus: 'failed', failureReason: patch.failureReason },
      { where: { settlementId: settlement.id } },
    );
  }

  return { updated: true, settlementId: settlement.id, status: patch.status || settlement.status };
}

// ── Admin reads ───────────────────────────────────────────────────────────
async function listSettlements(params = {}) {
  const offset = Number(params.offset) || 0;
  const limit = Math.min(Number(params.limit) || 20, 100);
  const where = {};
  if (params.status) where.status = params.status;
  if (params.hostId) where.hostId = params.hostId;

  const { count, rows } = await Settlement.findAndCountAll({
    where, offset, limit, order: [['periodStart', 'DESC'], ['createdAt', 'DESC']],
  });

  const hostIds = [...new Set(rows.map((r) => r.hostId))];
  const hosts = hostIds.length
    ? await Host.findAll({ where: { id: { [Op.in]: hostIds } }, attributes: ['id', 'name', 'email', 'contactNumber'] })
    : [];
  const byId = Object.fromEntries(hosts.map((h) => [h.id, h.toJSON()]));

  const totals = {
    netPayable: await Settlement.sum('netPayable', { where }) || 0,
    paid: await Settlement.sum('netPayable', { where: { ...where, status: 'paid' } }) || 0,
  };

  return {
    data: rows.map((r) => ({ ...r.toJSON(), host: byId[r.hostId] || null })),
    totalCount: count,
    totals,
  };
}

async function getSettlement(id) {
  const settlement = await Settlement.findByPk(id);
  if (!settlement) {
    throw Object.assign(new Error('Settlement not found'), { statusCode: 404 });
  }
  const ledgers = await HostPayoutLedger.findAll({ where: { settlementId: id } });
  const host = await Host.findByPk(settlement.hostId, { attributes: ['id', 'name', 'email', 'contactNumber'] });
  return { ...settlement.toJSON(), host: host ? host.toJSON() : null, ledgers };
}

// Retry a failed batch without rebuilding it — the ledger rows stay attached.
async function retrySettlement(id, admin) {
  const settlement = await Settlement.findByPk(id);
  if (!settlement) throw Object.assign(new Error('Settlement not found'), { statusCode: 404 });
  if (!['failed', 'on_hold'].includes(settlement.status)) {
    throw Object.assign(
      new Error(`Only failed or on-hold settlements can be retried (this one is ${settlement.status})`),
      { statusCode: 400 },
    );
  }

  const host = await Host.findByPk(settlement.hostId);
  if (!host) throw Object.assign(new Error('Host not found'), { statusCode: 404 });

  try {
    const transfer = await submitToGateway(settlement, host);
    await settlement.update({
      status: 'submitted', gatewayTransferId: transfer.id,
      gatewayStatus: transfer.status || null, gatewayResponse: transfer,
      submittedAt: new Date(), failureReason: null,
    });
    await HostPayoutLedger.update(
      { payoutStatus: 'processed', razorpayTransferId: transfer.id, payoutDate: new Date() },
      { where: { settlementId: settlement.id } },
    );
    await logActivity({
      adminId: admin?.id, adminName: admin?.name, action: 'retry',
      entityType: 'Settlement', entityId: settlement.id,
      changes: { transferId: transfer.id },
    });
    return settlement;
  } catch (error) {
    await settlement.update({ status: 'failed', failureReason: error.message });
    throw Object.assign(new Error(error.message), { statusCode: 400 });
  }
}

module.exports = {
  getSettlementWindow, runWeeklySettlement, syncFromGateway,
  listSettlements, getSettlement, retrySettlement,
};
