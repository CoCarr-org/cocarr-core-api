const os = require('os');
const { Op, fn, col, literal } = require('sequelize');
const { createCrudService } = require('./crudFactory');
const { CustomError } = require('../middlewares/error');
const { logActivity } = require('./activityLogService');
const { displayName, displayNameOr, DISPLAY_NAME_ATTRIBUTES } = require('../utils/userDisplayName');
const referralService = require('./referralService');

const Dispute = require('../models/dispute');
const MediaAsset = require('../models/mediaAsset');
const Announcement = require('../models/announcement');
const PushCampaign = require('../models/pushCampaign');
const ApiLog = require('../models/apiLog');
const Booking = require('../models/booking');
const Vehicle = require('../models/vehicle');
const VehiclePlan = require('../models/vehicleplan');
const User = require('../models/user');
const Host = require('../models/host');
const Review = require('../models/review');
const HostReview = require('../models/hostReview');
const HostPayoutLedger = require('../models/hostPayoutLedger');
const HostInvoice = require('../models/hostInvoice');
const Referral = require('../models/referral');
const ReferralCode = require('../models/referralCode');
const WalletTransaction = require('../models/wallettransaction');
const WebhookLog = require('../models/webhookLog');
const Wallet = require('../models/wallet');

// ── New CRUD modules ────────────────────────────────────────────────────
const disputes = createCrudService({
  model: Dispute, entityType: 'Dispute', searchable: ['bookingId', 'category', 'description'],
  allowed: ['bookingId', 'raisedBy', 'raisedByUserId', 'category', 'description',
    'amountClaimed', 'amountAwarded', 'status', 'resolution'],
});

const media = createCrudService({
  model: MediaAsset, entityType: 'MediaAsset', searchable: ['name', 'folder', 'altText'],
  allowed: ['name', 'url', 'mimeType', 'sizeBytes', 'folder', 'altText'],
});

const announcements = createCrudService({
  model: Announcement, entityType: 'Announcement', searchable: ['title', 'body'],
  allowed: ['title', 'body', 'audience', 'severity', 'isActive', 'startsAt', 'endsAt'],
});

const pushCampaigns = createCrudService({
  model: PushCampaign, entityType: 'PushCampaign', searchable: ['title', 'body'],
  allowed: ['title', 'body', 'audience', 'scheduledAt'],
});

const apiLogs = createCrudService({
  model: ApiLog, entityType: 'ApiLog', searchable: ['path', 'method', 'adminName'],
});

// Marks a campaign sent. Deliberately does NOT dispatch: fcmService sends to
// a single token, so a real broadcast needs token collection + batching that
// doesn't exist yet. Recording it as sent without sending would be a lie, so
// this returns a clear error instead.
async function sendPushCampaign(id, actingAdmin) {
  const campaign = await PushCampaign.findByPk(id);
  if (!campaign) throw new CustomError('Campaign not found', 404);
  throw new CustomError(
    'Broadcast sending is not implemented. fcmService targets one device token at a time — ' +
    'a campaign needs audience token collection and batched delivery first. The campaign is saved as a draft.',
    501
  );
}

// ── Read-only views over existing tables ────────────────────────────────
const paginate = (params) => ({
  offset: parseInt(params.offset) || 0,
  limit: parseInt(params.limit) || 25,
});

// Finance > Refunds — refunded bookings.
async function listRefunds(params = {}) {
  const where = { isRefunded: true };
  const { offset, limit } = paginate(params);
  const data = await Booking.findAll({
    where, offset, limit, order: [['updatedAt', 'DESC']],
    attributes: ['id', 'bookingId', 'userId', 'totalAmount', 'refundedAmount', 'status', 'isRefunded', 'createdAt', 'updatedAt'],
  });
  const totalCount = await Booking.count({ where });
  const sumRow = await Booking.findOne({
    where, attributes: [[fn('SUM', col('refundedAmount')), 'total']], raw: true,
  });
  return { data, totalCount, totalRefunded: Number(sumRow?.total || 0) };
}

// Finance/Hosts > Payouts — the settlement ledger.
async function listPayouts(params = {}) {
  const where = {};
  if (params.hostId) where.hostId = params.hostId;
  if (params.status) where.status = params.status;
  const { offset, limit } = paginate(params);
  const data = await HostPayoutLedger.findAll({ where, offset, limit, order: [['createdAt', 'DESC']] });
  const totalCount = await HostPayoutLedger.count({ where });
  return { data, totalCount };
}

// Finance > Invoices.
async function listInvoices(params = {}) {
  const where = {};
  if (params.hostId) where.hostId = params.hostId;
  const { offset, limit } = paginate(params);
  const data = await HostInvoice.findAll({ where, offset, limit, order: [['createdAt', 'DESC']] });
  const totalCount = await HostInvoice.count({ where });
  return { data, totalCount };
}

// Marketing > Referrals. Backed by the referral module's `referrals` table,
// with referrer/referee joined in for the admin list.
async function listReferrals(params = {}) {
  const { offset, limit } = paginate(params);
  const where = {};
  if (params.status) where.status = params.status;
  const data = await Referral.findAll({
    where,
    offset,
    limit,
    order: [['createdAt', 'DESC']],
    include: [
      { model: User, as: 'referrer', attributes: ['id', ...DISPLAY_NAME_ATTRIBUTES] },
      { model: User, as: 'referee', attributes: ['id', ...DISPLAY_NAME_ATTRIBUTES] },
    ],
  });
  const totalCount = await Referral.count({ where });
  return { data, totalCount };
}

// User Management > Referrals.
//
// Backed by the referral module's real `referrals` table (one row per referred
// user, written at signup) joined to `referral_codes` for each referrer's code
// and running totals. Aggregated into one row per referrer, with the people
// they brought in. (The old `users.referralCodeUsed`/`referralCode` columns this
// used to read have been decoupled into `referral_codes`; the never-written
// `userReferral` table is gone.)
async function listUserReferrals(params = {}) {
  const { offset, limit } = paginate(params);
  const search = (params.search || '').trim().toLowerCase();

  // Every recorded referral, with both sides joined in.
  const referrals = await Referral.findAll({
    order: [['createdAt', 'DESC']],
    include: [
      // DISPLAY_NAME_ATTRIBUTES, not just `name`: `users.name` is NULL for
      // anyone who signed up through the OTP flow, because onboarding writes
      // firstName/lastName and never touches it. Selecting only `name` is
      // exactly why referred users rendered as "Friend" / "Unknown".
      { model: User, as: 'referee', attributes: ['id', ...DISPLAY_NAME_ATTRIBUTES, 'createdAt'] },
      { model: User, as: 'referrer', attributes: ['id', ...DISPLAY_NAME_ATTRIBUTES, 'createdAt'] },
    ],
  });

  // Group by referrer.
  const byReferrer = new Map();
  for (const r of referrals) {
    if (!byReferrer.has(r.referrerId)) byReferrer.set(r.referrerId, []);
    byReferrer.get(r.referrerId).push(r);
  }
  const referrerIds = [...byReferrer.keys()];

  // Codes (the shareable code + running totals) and wallets for those referrers.
  const [codeRecords, wallets] = await Promise.all([
    referrerIds.length
      ? ReferralCode.findAll({ where: { userId: { [Op.in]: referrerIds } }, raw: true })
      : [],
    referrerIds.length
      ? Wallet.findAll({
          where: { userId: { [Op.in]: referrerIds } },
          attributes: ['userId', 'referralPoints', 'walletPoints'],
          raw: true,
        })
      : [],
  ]);
  const codeByUser = new Map(codeRecords.map((c) => [c.userId, c]));
  const walletByUser = new Map(wallets.map((w) => [w.userId, w]));

  // The referral status vocabulary lives in referralService — importing it keeps
  // this in step when it changes, and it just did: `rewarded`/`eligible` became
  // `completed`, and counting only `rewarded` here would have reported every
  // freshly credited referral as neither completed nor pending.
  const isCompleted = (st) => referralService.COMPLETED_STATUSES.includes(st);
  const isPending = (st) => referralService.PENDING_STATUSES.includes(st);

  let rows = referrerIds.map((rid) => {
    const list = byReferrer.get(rid) || [];
    const referrer = list[0] ? list[0].referrer : null;
    const codeRec = codeByUser.get(rid) || null;
    const wallet = walletByUser.get(rid) || null;
    return {
      referralCode: codeRec ? codeRec.code : (list[0] ? list[0].referralCode : null),
      codeStatus: codeRec ? codeRec.status : null,
      referrerId: rid,
      referrerName: displayName(referrer),
      referrerEmail: referrer ? referrer.email : null,
      referrerPhone: referrer ? referrer.contactNumber : null,
      referrerJoinedAt: referrer ? referrer.createdAt : null,
      referrerExists: !!referrer,
      referredCount: list.length,
      // Referrals still waiting on the referee to become active / book, vs fully rewarded.
      pendingCount: list.filter((r) => isPending(r.status)).length,
      completedCount: list.filter((r) => r.status === 'rewarded').length,

      pointsEarned: codeRec ? codeRec.totalPointsEarned : (wallet ? wallet.referralPoints : 0),
      walletPoints: wallet ? wallet.walletPoints : 0,
      referredUsers: list.map((r) => ({
        id: r.refereeId,
        name: displayNameOr(r.referee, 'Deleted user'),
        email: r.referee ? r.referee.email : null,
        phone: r.referee ? r.referee.contactNumber : null,
        joinedAt: r.referee ? r.referee.createdAt : r.createdAt,
        status: r.status,
        pointsAwarded: r.rewardPointsReferrer,
        // What the referrer's row is actually waiting on, so the queue can show
        // "pending" without the admin opening each one.
        rewardStatus: r.rewardStatus,
        referralId: r.id,
        completedAt: r.completedAt || null,
      })),
    };
  });

  if (search) {
    rows = rows.filter((r) =>
      (r.referralCode || '').toLowerCase().includes(search) ||
      (r.referrerName || '').toLowerCase().includes(search) ||
      (r.referrerEmail || '').toLowerCase().includes(search) ||
      (r.referrerPhone || '').toLowerCase().includes(search));
  }

  // Most prolific referrers first.
  rows.sort((a, b) => b.referredCount - a.referredCount);

  const totalCount = rows.length;
  const paged = rows.slice(offset, offset + limit);
  return {
    data: paged,
    totalCount,
    totalReferrers: totalCount,
    totalReferred: referrals.length,
  };
}

// User detail > Referral & rewards. Everything the referral module knows about
// one user: their own code, the people they referred (with each referral's
// state and points), whether they were themselves referred, and the referral
// wallet transactions on their account.
async function getUserReferralDetail(userId) {
  const user = await User.findByPk(userId, {
    attributes: ['id', ...DISPLAY_NAME_ATTRIBUTES, 'verificationStatus', 'createdAt'],
  });
  if (!user) throw new CustomError('User not found', 404);

  const codeRec = await ReferralCode.findOne({ where: { userId }, raw: true });

  // People this user referred.
  const referrals = await Referral.findAll({
    where: { referrerId: userId },
    include: [{ model: User, as: 'referee', attributes: ['id', ...DISPLAY_NAME_ATTRIBUTES, 'verificationStatus', 'createdAt'] }],
    order: [['createdAt', 'DESC']],
  });

  // Was this user themselves referred by someone?
  const referredBy = await Referral.findOne({
    where: { refereeId: userId },
    include: [{ model: User, as: 'referrer', attributes: ['id', ...DISPLAY_NAME_ATTRIBUTES] }],
  });

  // Referral-related wallet transactions on this user's account.
  //
  // Matched on `referenceType`, NOT on the description text. Matching
  // `description LIKE 'Referral%'` was fragile by construction — descriptions
  // are user-facing prose and were reworded the moment they started naming the
  // other party, at which point a prefix match silently returns nothing. The
  // column exists precisely so this question has a structural answer.
  const walletTransactions = await WalletTransaction.findAll({
    where: { userId, referenceType: 'referral' },
    order: [['createdAt', 'DESC']],
    limit: 50,
    raw: true,
  });

  const referredUsers = referrals.map((r) => ({
    id: r.refereeId,
    name: displayName(r.referee),
    email: r.referee ? r.referee.email : null,
    phone: r.referee ? r.referee.contactNumber : null,
    verificationStatus: r.referee ? r.referee.verificationStatus : null,
    referredAt: r.createdAt,
    joinedAt: r.referee ? r.referee.createdAt : r.createdAt,
    status: r.status,
    rewardStatus: r.rewardStatus,
    signupRewarded: r.signupRewarded,
    firstBookingRewarded: r.firstBookingRewarded,
    pointsEarned: r.rewardPointsReferrer || 0,   // what THIS user earned from the referral
    refereePoints: r.rewardPointsReferee || 0,   // what the friend earned
  }));

  // The referral status vocabulary lives in referralService — importing it keeps
  // this in step when it changes, and it just did: `rewarded`/`eligible` became
  // `completed`, and counting only `rewarded` here would have reported every
  // freshly credited referral as neither completed nor pending.
  const isCompleted = (st) => referralService.COMPLETED_STATUSES.includes(st);
  const isPending = (st) => referralService.PENDING_STATUSES.includes(st);

  return {
    user: {
      id: user.id, name: displayName(user), email: user.email,
      phone: user.contactNumber, verificationStatus: user.verificationStatus, joinedAt: user.createdAt,
    },
    code: codeRec ? {
      code: codeRec.code, status: codeRec.status, activatedAt: codeRec.activatedAt,
      totalReferrals: codeRec.totalReferrals, totalPointsEarned: codeRec.totalPointsEarned,
    } : null,
    summary: {
      referredCount: referredUsers.length,
      pointsGained: referredUsers.reduce((s, r) => s + r.pointsEarned, 0),
      completed: referredUsers.filter((r) => isCompleted(r.status)).length,
      pending: referredUsers.filter((r) => isPending(r.status)).length,
    },
    referredBy: referredBy ? {
      referrerId: referredBy.referrerId,
      name: displayName(referredBy.referrer),
      phone: referredBy.referrer ? referredBy.referrer.contactNumber : null,
      code: referredBy.referralCode,
      status: referredBy.status,
      myReward: referredBy.rewardPointsReferee || 0,
    } : null,
    referredUsers,
    walletTransactions: walletTransactions.map((t) => ({
      id: t.id, points: t.points, isCredit: t.isCredit, description: t.description, createdAt: t.createdAt,
    })),
  };
}

// Support > Feedback — rider reviews and host reviews merged into one feed.
async function listFeedback(params = {}) {
  const { offset, limit } = paginate(params);
  const [riderReviews, hostReviews] = await Promise.all([
    Review.findAll({ limit: limit + offset, order: [['createdAt', 'DESC']] }),
    HostReview.findAll({ limit: limit + offset, order: [['createdAt', 'DESC']] }),
  ]);
  const merged = [
    ...riderReviews.map((r) => ({ ...r.toJSON(), source: 'Rider review' })),
    ...hostReviews.map((r) => ({ ...r.toJSON(), source: 'Host review' })),
  ]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(offset, offset + limit);
  const totalCount = await Review.count() + await HostReview.count();
  return { data: merged, totalCount };
}

// Vehicles > Pricing — per-vehicle plans.
async function listVehiclePricing(params = {}) {
  const { offset, limit } = paginate(params);
  const data = await Vehicle.findAll({
    where: { deleted: false },
    offset, limit, order: [['vehicleName', 'ASC']],
    attributes: ['id', 'vehicleName', 'vehicleNumber', 'active'],
    include: [{ model: VehiclePlan, as: 'vehiclePlan' }],
  });
  const totalCount = await Vehicle.count({ where: { deleted: false } });
  return { data, totalCount };
}

// Vehicles > Documents — RC / verification state per vehicle.
async function listVehicleDocuments(params = {}) {
  const { offset, limit } = paginate(params);
  const data = await Vehicle.findAll({
    where: { deleted: false },
    offset, limit, order: [['createdAt', 'DESC']],
    attributes: ['id', 'vehicleName', 'vehicleNumber', 'isAdminApproved', 'approvalStatus', 'rejectionReason', 'isDraft', 'createdAt'],
  });
  const totalCount = await Vehicle.count({ where: { deleted: false } });
  return { data, totalCount };
}

// Hosts > Documents — the host's KYC/licence state, which lives on the User.
async function listHostDocuments(params = {}) {
  const { offset, limit } = paginate(params);
  const hosts = await Host.findAll({ offset, limit, order: [['createdAt', 'DESC']] });
  const userIds = hosts.map((h) => h.userId).filter(Boolean);
  const users = userIds.length
    ? await User.findAll({
        where: { id: { [Op.in]: userIds } },
        attributes: ['id', 'name', 'email', 'contactNumber', 'kycNumber', 'kycVerified',
          'licenseNumber', 'licenseVerified', 'licenseFrontImage', 'licenseBackImage'],
      })
    : [];
  const byId = {};
  users.forEach((u) => { byId[u.id] = u.toJSON(); });
  const data = hosts.map((h) => ({ ...h.toJSON(), user: byId[h.userId] || null }));
  const totalCount = await Host.count();
  return { data, totalCount };
}

// ── Derived views (no storage of their own) ─────────────────────────────

// Dashboard > System Alerts — real signals, not a placeholder feed.
async function getSystemAlerts() {
  const alerts = [];

  const pendingVehicles = await Vehicle.count({ where: { approvalStatus: 'pending', isDraft: false, deleted: false } });
  if (pendingVehicles > 0) {
    alerts.push({ severity: 'warning', title: `${pendingVehicles} vehicle(s) awaiting approval`, area: 'Vehicles', action: '/dashboard/vehicles/approvals' });
  }

  // 'initiated' means payment captured but confirm-booking never completed —
  // a real stuck state, not a transient one.
  const stuck = await Booking.count({ where: { status: 'initiated' } });
  if (stuck > 0) {
    alerts.push({ severity: 'critical', title: `${stuck} booking(s) stuck at "initiated"`, area: 'Bookings', action: '/dashboard/rides' });
  }

  const openDisputes = await Dispute.count({ where: { status: ['open', 'investigating'] } });
  if (openDisputes > 0) {
    alerts.push({ severity: 'warning', title: `${openDisputes} unresolved dispute(s)`, area: 'Bookings', action: '/dashboard/bookings/disputes' });
  }

  const failedWebhooks = await WebhookLog.count({ where: { succeeded: false } });
  if (failedWebhooks > 0) {
    alerts.push({ severity: 'critical', title: `${failedWebhooks} failed webhook call(s)`, area: 'Developer', action: '/dashboard/developer/webhooks' });
  }

  // KYC lives in its own table now — count pending documents, not user columns.
  const KycDocument = require('../models/kycDocument');
  const unverifiedKyc = await KycDocument.count({
    where: { isCurrent: true, status: 'pending', documentNumber: { [Op.ne]: null } },
  });
  if (unverifiedKyc > 0) {
    alerts.push({ severity: 'info', title: `${unverifiedKyc} KYC submission(s) awaiting review`, area: 'Users', action: '/dashboard/users/kyc' });
  }

  const freeMemPct = Math.round((os.freemem() / os.totalmem()) * 100);
  if (freeMemPct < 10) {
    alerts.push({ severity: 'critical', title: `Server memory low (${freeMemPct}% free)`, area: 'Developer', action: '/dashboard/system-health' });
  }

  return { alerts, checkedAt: new Date().toISOString(), healthy: alerts.length === 0 };
}

// Reports > Operational — fleet utilisation.
async function getOperationalReport({ from, to } = {}) {
  const where = {};
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt[Op.gte] = new Date(from);
    if (to) where.createdAt[Op.lte] = new Date(to);
  }

  const [totalVehicles, activeVehicles, pendingApproval] = await Promise.all([
    Vehicle.count({ where: { deleted: false } }),
    Vehicle.count({ where: { deleted: false, active: true } }),
    Vehicle.count({ where: { deleted: false, approvalStatus: 'pending', isDraft: false } }),
  ]);

  const bookedVehicles = await Booking.count({ where, distinct: true, col: 'vehicleId' });

  const topVehicles = await Booking.findAll({
    where,
    attributes: ['vehicleId', [fn('COUNT', col('id')), 'bookings'], [fn('SUM', col('totalAmount')), 'revenue']],
    group: ['vehicleId'],
    order: [[literal('bookings'), 'DESC']],
    limit: 10,
    raw: true,
  });

  return {
    summary: {
      totalVehicles,
      activeVehicles,
      pendingApproval,
      vehiclesBooked: bookedVehicles,
      // Share of the fleet that saw at least one booking in range.
      utilisationPct: totalVehicles ? Math.round((bookedVehicles / totalVehicles) * 100) : 0,
    },
    topVehicles,
  };
}

// Reports > Customer — growth and retention.
async function getCustomerReport({ from, to } = {}) {
  const where = {};
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt[Op.gte] = new Date(from);
    if (to) where.createdAt[Op.lte] = new Date(to);
  }

  const [totalUsers, newUsers] = await Promise.all([User.count(), User.count({ where })]);

  const perUser = await Booking.findAll({
    attributes: ['userId', [fn('COUNT', col('id')), 'bookings'], [fn('SUM', col('totalAmount')), 'spend']],
    group: ['userId'],
    raw: true,
  });
  const bookers = perUser.length;
  const repeat = perUser.filter((u) => Number(u.bookings) > 1).length;

  const signupsByDay = await User.findAll({
    where,
    attributes: [[fn('DATE', col('createdAt')), 'day'], [fn('COUNT', col('id')), 'signups']],
    group: [literal('DATE(createdAt)')],
    order: [[literal('DATE(createdAt)'), 'ASC']],
    raw: true,
  });

  return {
    summary: {
      totalUsers,
      newUsers,
      customersWhoBooked: bookers,
      repeatCustomers: repeat,
      repeatRatePct: bookers ? Math.round((repeat / bookers) * 100) : 0,
      conversionPct: totalUsers ? Math.round((bookers / totalUsers) * 100) : 0,
    },
    signupsByDay,
    topCustomers: perUser.sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0)).slice(0, 10),
  };
}

// Developer > Background Jobs.
function getBackgroundJobs() {
  return {
    jobs: [
      { name: 'Payout scheduler', schedule: 'Configured at boot (utils/payoutScheduler.js)', status: 'configured',
        note: 'Runs in-process. There is no job queue, so there is no per-run history to show.' },
      { name: 'Admin sync (Firebase → DB)', schedule: 'On every boot', status: process.env.ADMIN_SERVICE_ACCOUNT ? 'configured' : 'not configured' },
      { name: 'User sync (Firebase → DB)', schedule: 'On every boot', status: process.env.USER_SERVICE_ACCOUNT ? 'configured' : 'not configured' },
      { name: 'Bootstrap super admin', schedule: 'On every boot', status: process.env.ADMIN_SERVICE_ACCOUNT ? 'configured' : 'not configured' },
    ],
    note: 'Derived from what the codebase actually schedules — no queue system (BullMQ/Agenda) is in use, so these are process-level tasks rather than tracked jobs.',
  };
}

// Reports > Export Centre — what can be exported, and from where.
function getExportTargets() {
  return {
    exports: [
      { key: 'users', label: 'Users (CSV)', endpoint: '/admin/export-user', available: true },
      { key: 'bookings', label: 'Bookings (CSV)', available: false, note: 'No export endpoint exists yet.' },
      { key: 'payouts', label: 'Payouts (CSV)', available: false, note: 'No export endpoint exists yet.' },
      { key: 'invoices', label: 'Invoices (CSV)', available: false, note: 'No export endpoint exists yet.' },
    ],
  };
}

module.exports = {
  disputes, media, announcements, pushCampaigns, apiLogs, sendPushCampaign,
  listRefunds, listPayouts, listInvoices, listReferrals, listUserReferrals, getUserReferralDetail, listFeedback,
  listVehiclePricing, listVehicleDocuments, listHostDocuments,
  getSystemAlerts, getOperationalReport, getCustomerReport,
  getBackgroundJobs, getExportTargets,
};
