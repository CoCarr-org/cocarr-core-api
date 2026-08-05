const { Op } = require('sequelize');
const User = require('../models/user');
const Wallet = require('../models/wallet');
const WalletTransaction = require('../models/wallettransaction');
const Referral = require('../models/referral');
const ReferralReward = require('../models/referralReward');
const ReferralCampaign = require('../models/referralCampaign');
const ReferralCode = require('../models/referralCode');
const Booking = require('../models/booking');
const { displayName, DISPLAY_NAME_ATTRIBUTES } = require('../utils/userDisplayName');

// Wallet transactions for the admin panel: the ledger, and the trace behind any
// one row.
//
// THE POINT OF THIS FILE is the trace. Points appearing in someone's wallet is
// the sort of thing that generates support tickets and fraud questions, and
// until now the only answer available was a free-text description like
// "Referral reward (sign-up)" — enough to see that points moved, useless for
// working out why, from whom, or under which campaign.
//
// `getTransaction` walks the provenance columns written at credit time
// (referenceType / referenceId / counterpartyUserId) all the way out to the
// people involved, so an admin lands on a wallet row and leaves knowing which
// user, which referral, which campaign and which other user produced it — with
// links to each.

const httpError = (m, s) => Object.assign(new Error(m), { statusCode: s });
const badRequest = (m) => httpError(m, 400);
const notFound = (m) => httpError(m, 404);

const paginate = ({ offset = 0, limit = 25 } = {}) => ({
  offset: Number(offset) || 0,
  limit: Math.min(Number(limit) || 25, 100),
});

// One user, reduced to what a reviewer needs to recognise and reach them.
// Always through `displayName` — `users.name` is null for OTP signups.
const userCard = (user) => {
  if (!user) return null;
  return {
    id: user.id,
    name: displayName(user),
    email: user.email || null,
    phone: user.contactNumber || null,
    verificationStatus: user.verificationStatus || null,
    joinedAt: user.createdAt || null,
  };
};

const USER_CARD_ATTRIBUTES = ['id', ...DISPLAY_NAME_ATTRIBUTES, 'verificationStatus', 'createdAt'];

// ── The ledger ─────────────────────────────────────────────────────────────
//
// Search matches the user, not the transaction: an admin arrives from a support
// ticket holding a name or a phone number, never a wallet-transaction id. The
// matching users are resolved first and the ledger filtered to them, which also
// keeps the count honest — filtering rows after paging would report a total for
// a different set than the one displayed.
async function listTransactions(params = {}) {
  const { offset, limit } = paginate(params);
  const search = String(params.search || '').trim();
  const { referenceType, direction, userId, from, to } = params;

  const where = {};
  if (userId) where.userId = userId;
  if (referenceType) where.referenceType = referenceType;
  if (direction === 'credit') where.isCredit = true;
  if (direction === 'debit') where.isCredit = false;

  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt[Op.gte] = new Date(from);
    // `to` is a date, and a user asking for "up to the 5th" means the whole of
    // the 5th. Without this the last day of any range silently returns nothing.
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      where.createdAt[Op.lte] = end;
    }
  }

  if (search) {
    const matches = await User.findAll({
      where: {
        [Op.or]: [
          { firstName: { [Op.like]: `%${search}%` } },
          { lastName: { [Op.like]: `%${search}%` } },
          { name: { [Op.like]: `%${search}%` } },
          { email: { [Op.like]: `%${search}%` } },
          { contactNumber: { [Op.like]: `%${search}%` } },
        ],
      },
      attributes: ['id'],
      raw: true,
    });
    // '__none__' rather than skipping the clause: an unmatched search must
    // return nothing, not everything.
    where.userId = { [Op.in]: matches.length ? matches.map((u) => u.id) : ['__none__'] };
  }

  const { count, rows } = await WalletTransaction.findAndCountAll({
    where, offset, limit, order: [['createdAt', 'DESC']],
  });

  // Both sides of every row, in two queries rather than 2N.
  const ids = new Set();
  for (const t of rows) {
    if (t.userId) ids.add(t.userId);
    if (t.counterpartyUserId) ids.add(t.counterpartyUserId);
  }
  const users = ids.size
    ? await User.findAll({ where: { id: { [Op.in]: [...ids] } }, attributes: USER_CARD_ATTRIBUTES })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  const data = rows.map((t) => ({
    id: t.id,
    userId: t.userId,
    user: userCard(byId.get(t.userId)),
    points: t.points,
    isCredit: t.isCredit,
    status: t.status,
    description: t.description,
    referenceType: t.referenceType || null,
    referenceId: t.referenceId || null,
    counterparty: userCard(byId.get(t.counterpartyUserId)),
    createdAt: t.createdAt,
  }));

  // Totals over the WHOLE filtered set, not the current page — a page total is
  // a number nobody wants.
  const [credited, debited] = await Promise.all([
    WalletTransaction.sum('points', { where: { ...where, isCredit: true } }),
    WalletTransaction.sum('points', { where: { ...where, isCredit: false } }),
  ]);

  return {
    data,
    totalCount: count,
    totals: {
      credited: credited || 0,
      debited: debited || 0,
      net: (credited || 0) - (debited || 0),
    },
  };
}

// ── The trace ──────────────────────────────────────────────────────────────
//
// Everything behind one wallet transaction, resolved to the user level, which
// is the whole reason the provenance columns exist.
async function getTransaction(id) {
  const txn = await WalletTransaction.findByPk(id);
  if (!txn) throw notFound('Wallet transaction not found');

  const [owner, counterparty, wallet] = await Promise.all([
    User.findByPk(txn.userId, { attributes: USER_CARD_ATTRIBUTES }),
    txn.counterpartyUserId
      ? User.findByPk(txn.counterpartyUserId, { attributes: USER_CARD_ATTRIBUTES })
      : null,
    Wallet.findByPk(txn.walletId),
  ]);

  const trace = {
    id: txn.id,
    points: txn.points,
    isCredit: txn.isCredit,
    status: txn.status,
    description: txn.description,
    referenceType: txn.referenceType || null,
    referenceId: txn.referenceId || null,
    createdAt: txn.createdAt,
    metadata: txn.metadata || null,
    user: userCard(owner),
    counterparty: userCard(counterparty),
    wallet: wallet
      ? { id: wallet.id, walletPoints: wallet.walletPoints, referralPoints: wallet.referralPoints }
      : null,
    // Filled in per reference type below. Null means the row predates the
    // provenance columns — an honest "we don't know", which is better than an
    // invented source.
    source: null,
  };

  if (txn.referenceType === 'referral' && txn.referenceId) {
    trace.source = await traceReferral(txn.referenceId, txn.id);
  } else if (txn.referenceType === 'booking' && txn.referenceId) {
    const booking = await Booking.findByPk(txn.referenceId);
    trace.source = booking
      ? {
        kind: 'booking',
        bookingId: booking.id,
        uniqueId: booking.uniqueId || null,
        status: booking.status,
        startTime: booking.startTime,
        endTime: booking.endTime,
      }
      : { kind: 'booking', bookingId: txn.referenceId, missing: true };
  }

  return trace;
}

// The full referral behind a credit: both people, the code, the campaign, every
// reward stage, and every wallet row the referral produced on either side. This
// is the "back-track to user level" view.
async function traceReferral(referralId, highlightTransactionId = null) {
  const referral = await Referral.findByPk(referralId);
  if (!referral) return { kind: 'referral', referralId, missing: true };

  const [referrer, referee, campaign, rewards, code, siblingTxns] = await Promise.all([
    User.findByPk(referral.referrerId, { attributes: USER_CARD_ATTRIBUTES }),
    User.findByPk(referral.refereeId, { attributes: USER_CARD_ATTRIBUTES }),
    referral.campaignId ? ReferralCampaign.findByPk(referral.campaignId) : null,
    ReferralReward.findAll({ where: { referralId }, order: [['createdAt', 'ASC']] }),
    ReferralCode.findOne({ where: { userId: referral.referrerId } }),
    // Every wallet row this referral produced, both sides. The index on
    // (referenceType, referenceId) is what makes this cheap.
    WalletTransaction.findAll({
      where: { referenceType: 'referral', referenceId: referralId },
      order: [['createdAt', 'ASC']],
    }),
  ]);

  return {
    kind: 'referral',
    referralId: referral.id,
    referralCode: referral.referralCode,
    status: referral.status,
    rewardStatus: referral.rewardStatus,
    signupRewarded: referral.signupRewarded,
    firstBookingRewarded: referral.firstBookingRewarded,
    signedUpAt: referral.createdAt,
    completedAt: referral.completedAt || null,
    // Both ends, so the admin can jump to either user from here.
    referrer: userCard(referrer),
    referee: userCard(referee),
    referrerCode: code ? { code: code.code, status: code.status } : null,
    campaign: campaign
      ? {
        id: campaign.id,
        name: campaign.name,
        referrerSignupPoints: campaign.referrerSignupPoints,
        refereeSignupPoints: campaign.refereeSignupPoints,
        referrerFirstBookingPoints: campaign.referrerFirstBookingPoints,
        refereeFirstBookingPoints: campaign.refereeFirstBookingPoints,
      }
      // Null means the referral ran on the built-in defaults, not that the
      // campaign vanished — say so rather than showing a blank.
      : { id: null, name: 'Default referral campaign (no campaign configured)' },
    pointsReferrer: referral.rewardPointsReferrer,
    pointsReferee: referral.rewardPointsReferee,
    rewards: rewards.map((r) => ({
      id: r.id,
      beneficiary: r.beneficiary,
      rewardType: r.rewardType,
      points: r.points,
      status: r.status,
      walletTransactionId: r.walletTransactionId,
      createdAt: r.createdAt,
    })),
    walletTransactions: siblingTxns.map((t) => ({
      id: t.id,
      userId: t.userId,
      points: t.points,
      isCredit: t.isCredit,
      description: t.description,
      createdAt: t.createdAt,
      // Which row the admin arrived from, so the list can mark it.
      isCurrent: t.id === highlightTransactionId,
    })),
  };
}

// ── One user's referral position ───────────────────────────────────────────
//
// Both directions in one call, because the user detail screen needs both and
// they are meaningless apart: who brought this person in, and who they have
// brought in since.
async function getUserReferralSummary(userId) {
  if (!userId) throw badRequest('User id is required');

  const [referredBy, referralsMade, code] = await Promise.all([
    Referral.findOne({ where: { refereeId: userId } }),
    Referral.findAll({ where: { referrerId: userId }, order: [['createdAt', 'DESC']] }),
    ReferralCode.findOne({ where: { userId } }),
  ]);

  const ids = new Set();
  if (referredBy) ids.add(referredBy.referrerId);
  for (const r of referralsMade) ids.add(r.refereeId);
  const users = ids.size
    ? await User.findAll({ where: { id: { [Op.in]: [...ids] } }, attributes: USER_CARD_ATTRIBUTES })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  // Every wallet row this user has that came from a referral, so the screen can
  // show the money next to the relationship that produced it.
  const walletTransactions = await WalletTransaction.findAll({
    where: { userId, referenceType: 'referral' },
    order: [['createdAt', 'DESC']],
  });
  const txnsByReferral = new Map();
  for (const t of walletTransactions) {
    if (!txnsByReferral.has(t.referenceId)) txnsByReferral.set(t.referenceId, []);
    txnsByReferral.get(t.referenceId).push({
      id: t.id,
      points: t.points,
      isCredit: t.isCredit,
      description: t.description,
      createdAt: t.createdAt,
    });
  }

  return {
    // The user's own shareable code. `null` status means they have not been
    // approved yet — a code is only minted and activated on approval.
    code: code ? { code: code.code, status: code.status, totalReferrals: code.totalReferrals, totalPointsEarned: code.totalPointsEarned } : null,
    referredBy: referredBy
      ? {
        referralId: referredBy.id,
        referralCode: referredBy.referralCode,
        status: referredBy.status,
        rewardStatus: referredBy.rewardStatus,
        signedUpAt: referredBy.createdAt,
        completedAt: referredBy.completedAt || null,
        pointsEarned: referredBy.rewardPointsReferee,
        // The whole point of the bug report: this used to be a bare id, or
        // "Unknown", because only `users.name` was read.
        referrer: userCard(byId.get(referredBy.referrerId)),
        walletTransactions: txnsByReferral.get(referredBy.id) || [],
      }
      : null,
    referralsMade: referralsMade.map((r) => ({
      referralId: r.id,
      referralCode: r.referralCode,
      status: r.status,
      rewardStatus: r.rewardStatus,
      signedUpAt: r.createdAt,
      completedAt: r.completedAt || null,
      pointsEarned: r.rewardPointsReferrer,
      referee: userCard(byId.get(r.refereeId)),
      walletTransactions: txnsByReferral.get(r.id) || [],
    })),
    totals: {
      referralsMade: referralsMade.length,
      // "Completed" is the status the money actually moved on. The legacy
      // spellings count too — see the status block in referralService.
      completed: referralsMade.filter((r) => ['completed', 'rewarded', 'eligible'].includes(r.status)).length,
      pending: referralsMade.filter((r) => ['pending', 'created'].includes(r.status)).length,
      pointsFromReferrals: referralsMade.reduce((sum, r) => sum + (r.rewardPointsReferrer || 0), 0)
        + (referredBy?.rewardPointsReferee || 0),
    },
  };
}

// One user's whole wallet: balance plus their ledger. Used by the user detail
// screen, and deliberately not paginated to 100s — an admin looking at one
// person wants the recent history, not an archive.
async function getUserWallet(userId, { limit = 25 } = {}) {
  const wallet = await Wallet.findOne({ where: { userId } });
  const transactions = await WalletTransaction.findAll({
    where: { userId },
    order: [['createdAt', 'DESC']],
    limit: Math.min(Number(limit) || 25, 100),
  });

  return {
    wallet: wallet
      ? {
        id: wallet.id,
        walletPoints: wallet.walletPoints,
        referralPoints: wallet.referralPoints || 0,
      }
      // A user with no wallet row has never earned or spent anything. Reported
      // as zeroes rather than null so the screen has nothing to special-case.
      : { id: null, walletPoints: 0, referralPoints: 0 },
    transactions: transactions.map((t) => ({
      id: t.id,
      points: t.points,
      isCredit: t.isCredit,
      status: t.status,
      description: t.description,
      referenceType: t.referenceType || null,
      referenceId: t.referenceId || null,
      createdAt: t.createdAt,
    })),
  };
}

module.exports = {
  listTransactions,
  getTransaction,
  traceReferral,
  getUserReferralSummary,
  getUserWallet,
};
