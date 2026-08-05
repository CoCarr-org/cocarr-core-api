const { Op } = require('sequelize');
const db = require('../configs/db');
const { CustomError } = require('../middlewares/error');
const User = require('../models/user');
const Wallet = require('../models/wallet');
const WalletTransaction = require('../models/wallettransaction');
const Referral = require('../models/referral');
const ReferralReward = require('../models/referralReward');
const ReferralCampaign = require('../models/referralCampaign');
const ReferralCode = require('../models/referralCode');
const fcmService = require('./fcmService');
const { displayName, displayNameOr } = require('../utils/userDisplayName');

// ── Referral module service ────────────────────────────────────────────────
// Owns the referral lifecycle end to end. Two rules shape the timing:
//
//   1. A user's shareable code is minted only when they become an ACTIVE
//      (verified) user, and only an active code can be applied by a referee.
//      The code lives in its own table (referral_codes), not on `users`.
//   2. A referee's referral is RECORDED at signup (status 'pending') but the
//      signup reward is credited only when the referee THEMSELVES becomes an
//      active user. The first-booking reward follows on their first booking.
//
// Reward amounts and eligibility come from the active ReferralCampaign so they
// can change without an app release; DEFAULT_CAMPAIGN keeps the module working
// before an admin has configured one.

// ── Referral status ────────────────────────────────────────────────────────
// The status answers one question: has this referral's money actually moved?
//
//   pending    — recorded at signup. Nothing has been credited. This is where a
//                referral sits for as long as the referee is unverified, which
//                may be forever.
//   completed  — the wallet transactions exist. Set in the same DB transaction
//                that writes them, so the status can never claim a credit that
//                did not land, and never miss one that did.
//   cancelled  — reversed by an admin; the credits were debited back.
//   fraud      — blocked, and will never earn.
//
// `rewardStatus` (pending | partial | credited) is the finer-grained view for
// the two-stage campaign: `completed` means the sign-up credit landed, while
// `rewardStatus: 'partial'` says the first-booking stage is still to come.
// They are deliberately separate — "did this referral pay out?" and "is every
// stage done?" are different questions and the admin screens need both.
//
// LEGACY VALUES: rows written before this carry `eligible` (signup credited,
// first booking outstanding) and `rewarded` (both credited). Both mean the
// money moved, so both read as completed. `status` is a STRING, not an ENUM,
// so nothing had to be migrated — but every query that filters on it has to
// accept the old spellings, which is what COMPLETED_STATUSES is for.
const STATUS_PENDING = 'pending';
const STATUS_COMPLETED = 'completed';
const COMPLETED_STATUSES = [STATUS_COMPLETED, 'rewarded', 'eligible'];
const PENDING_STATUSES = [STATUS_PENDING, 'created'];

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_LENGTH = 6;

const DEFAULT_CAMPAIGN = {
  id: null,
  name: 'Default referral campaign',
  active: true,
  referrerSignupPoints: 100,
  refereeSignupPoints: 100,
  referrerFirstBookingPoints: 200,
  refereeFirstBookingPoints: 100,
  firstBookingRewardEnabled: true,
  fraudChecksEnabled: true,
};

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
  }
  return code;
}

// Ensures a user has a permanent, unique referral code row. Codes are compared
// case-insensitively (PRD), so they are always stored upper-cased. Safe to call
// repeatedly — returns the existing code if there is one.
//
// `activate` flips the code on (status 'active') — pass it when the caller knows
// the user has just become an active/verified user. A code stays `inactive`
// (and so unusable by referees) until then.
async function ensureReferralCode(userId, { transaction, activate = false } = {}) {
  if (!userId) throw new CustomError('User not found', 404);

  let record = await ReferralCode.findOne({ where: { userId }, transaction });
  if (!record) {
    // Retry on the rare collision; the column is unique.
    let code = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = generateCode();
      const clash = await ReferralCode.findOne({ where: { code: candidate }, transaction });
      if (!clash) { code = candidate; break; }
    }
    if (!code) throw new CustomError('Could not allocate a referral code, please retry', 500);

    record = await ReferralCode.create({
      userId,
      code,
      status: activate ? 'active' : 'inactive',
      activatedAt: activate ? new Date() : null,
    }, { transaction });
    return record;
  }

  if (activate && record.status !== 'active') {
    record.status = 'active';
    record.activatedAt = record.activatedAt || new Date();
    await record.save({ transaction });
  }
  return record;
}

// The code record for a user, or null if none minted yet (i.e. not active).
async function getUserCode(userId) {
  return ReferralCode.findOne({ where: { userId } });
}

// The single active campaign, or the built-in default when none is configured
// or the configured one is outside its date window.
async function getActiveCampaign() {
  const now = new Date();
  const campaign = await ReferralCampaign.findOne({
    where: {
      active: true,
      [Op.and]: [
        { [Op.or]: [{ startDate: null }, { startDate: { [Op.lte]: now } }] },
        { [Op.or]: [{ endDate: null }, { endDate: { [Op.gte]: now } }] },
      ],
    },
    order: [['createdAt', 'DESC']],
  });
  return campaign || DEFAULT_CAMPAIGN;
}

// Whether the referral programme is currently open — used by the clients to
// decide whether to show the "have a referral code?" entry at signup.
async function getProgramStatus() {
  const campaign = await getActiveCampaign();
  return { programActive: !!(campaign && campaign.active) };
}

// Validates a referral code for a would-be referee. Returns the referrer.
// `refereeId` is optional (may be unknown before signup); when supplied it also
// enforces the self-referral and already-referred rules. The code must belong
// to an ACTIVE code record — an inactive (not-yet-verified) owner's code cannot
// be used.
async function validateReferralCode(rawCode, refereeId) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) throw new CustomError('Invalid referral code.', 400, 'INVALID_REFERRAL_CODE');

  const codeRecord = await ReferralCode.findOne({ where: { code } });
  if (!codeRecord || codeRecord.status !== 'active') {
    throw new CustomError('Invalid referral code.', 400, 'INVALID_REFERRAL_CODE');
  }

  const referrer = await User.findByPk(codeRecord.userId);
  if (!referrer) throw new CustomError('Invalid referral code.', 400, 'INVALID_REFERRAL_CODE');

  if (refereeId && referrer.id === refereeId) {
    throw new CustomError('You cannot use your own referral code.', 400, 'SELF_REFERRAL');
  }

  const campaign = await getActiveCampaign();
  if (!campaign.active) {
    throw new CustomError('Referral campaign has ended.', 400, 'CAMPAIGN_EXPIRED');
  }

  if (refereeId) {
    const existing = await Referral.findOne({ where: { refereeId } });
    if (existing) {
      throw new CustomError('Referral code has already been applied.', 400, 'ALREADY_REFERRED');
    }
  }

  return { referrer, campaign, codeRecord };
}

// Credits `points` to a user's wallet inside `transaction`, writing the
// matching wallet transaction, and returns the created wallet-transaction id.
//
// The provenance arguments are not optional decoration. A wallet row that says
// only "Referral reward (sign-up)" tells an admin that points moved and nothing
// else — not which referral, not which campaign, not who the other side was.
// Every credit written here carries enough to reconstruct the whole story.
async function creditWallet({
  userId, points, description, transaction,
  referenceType = null, referenceId = null, counterpartyUserId = null, metadata = null,
}) {
  let wallet = await Wallet.findOne({ where: { userId }, transaction });
  if (!wallet) {
    wallet = await Wallet.create({ userId }, { transaction });
  }
  const balanceBefore = wallet.walletPoints || 0;
  wallet.walletPoints = balanceBefore + points;
  wallet.referralPoints = (wallet.referralPoints || 0) + points;
  await wallet.save({ transaction });

  const txn = await WalletTransaction.create({
    userId,
    walletId: wallet.id,
    points,
    isCredit: true,
    description,
    referenceType,
    referenceId,
    counterpartyUserId,
    // Balances are snapshotted rather than recomputed later: replaying every
    // transaction to work out what the balance was at the time is exactly the
    // kind of arithmetic that quietly disagrees with the wallet after one
    // adjustment lands out of order.
    metadata: { ...(metadata || {}), balanceBefore, balanceAfter: wallet.walletPoints },
  }, { transaction });

  return txn.id;
}

// Keeps the referrer's code-record counters (totalReferrals / totalPointsEarned)
// in step as rewards are credited, so dashboards don't re-aggregate every read.
async function bumpReferrerCode({ referrerId, points = 0, addReferral = false, transaction }) {
  const record = await ReferralCode.findOne({ where: { userId: referrerId }, transaction });
  if (!record) return;
  if (addReferral) record.totalReferrals += 1;
  if (points) record.totalPointsEarned += points;
  await record.save({ transaction });
}

// Best-effort push notifications. Never allowed to fail the surrounding
// transaction — a missing device token must not cost someone their reward.
async function notify(userId, title, body) {
  try {
    await fcmService.sendNotification({ title, body, payload: { screen: 'ReferralPage' } }, [userId]);
  } catch (err) {
    console.log('[referral] notification skipped:', err?.message);
  }
}

// Credits one reward stage (signup or first_booking) to both sides of a
// referral inside `transaction`, writing wallet transactions and audit rows and
// updating the running totals. Idempotency is the caller's responsibility (via
// the signupRewarded / firstBookingRewarded flags).
async function creditStage({ referral, campaign, stage, transaction }) {
  const points = stage === 'signup'
    ? { referrer: campaign.referrerSignupPoints, referee: campaign.refereeSignupPoints }
    : { referrer: campaign.referrerFirstBookingPoints, referee: campaign.refereeFirstBookingPoints };

  const label = stage === 'signup' ? 'sign-up' : 'first booking';

  // Both parties, so each side's description can name the other. Looked up once
  // rather than per side. `displayName` is what makes these readable at all —
  // `users.name` is null for anyone who signed up through the OTP flow.
  const [referrerUser, refereeUser] = await Promise.all([
    User.findByPk(referral.referrerId, { transaction }),
    User.findByPk(referral.refereeId, { transaction }),
  ]);
  const referrerName = displayNameOr(referrerUser, 'your referrer');
  const refereeName = displayNameOr(refereeUser, 'your friend');

  for (const side of ['referrer', 'referee']) {
    const userId = side === 'referrer' ? referral.referrerId : referral.refereeId;
    const amount = points[side];
    if (!amount || amount <= 0) continue;

    // Written from the reader's point of view — this string is shown to the
    // user in their own wallet history, so it has to say what THEY did.
    const description = side === 'referrer'
      ? (stage === 'signup'
        ? `Referral reward — ${refereeName} joined using your code ${referral.referralCode}`
        : `Referral reward — ${refereeName} completed their first booking`)
      : (stage === 'signup'
        ? `Referral reward — you joined using ${referrerName}'s code ${referral.referralCode}`
        : 'Referral reward — your first booking');

    const walletTransactionId = await creditWallet({
      userId,
      points: amount,
      description,
      transaction,
      referenceType: 'referral',
      referenceId: referral.id,
      // One hop to the other party from either side's wallet row.
      counterpartyUserId: side === 'referrer' ? referral.refereeId : referral.referrerId,
      metadata: {
        stage,
        beneficiary: side,
        referralCode: referral.referralCode,
        campaignId: campaign.id || null,
        campaignName: campaign.name || null,
        referrerId: referral.referrerId,
        referrerName,
        refereeId: referral.refereeId,
        refereeName,
      },
    });

    await ReferralReward.create({
      referralId: referral.id,
      userId,
      beneficiary: side,
      rewardType: stage === 'signup' ? 'signup' : 'first_booking',
      points: amount,
      walletTransactionId,
    }, { transaction });

    if (side === 'referrer') referral.rewardPointsReferrer += amount;
    else referral.rewardPointsReferee += amount;
  }

  // Keep the referrer's code counters current.
  await bumpReferrerCode({
    referrerId: referral.referrerId,
    points: points.referrer || 0,
    addReferral: stage === 'signup',
    transaction,
  });
}

// Records a referral for a brand-new user at signup. Validates the code and
// creates the referral in `pending` state — NO reward is credited here. The
// signup reward is granted later, when the referee becomes an active user (see
// creditSignupRewardOnActivation). Call this from within the signup flow.
//
// `transaction` is optional — when the caller already owns one it is reused.
async function recordPendingReferral({ refereeId, code, transaction: outerTxn }) {
  const { referrer, campaign } = await validateReferralCode(code, refereeId);

  const transaction = outerTxn || await db.transaction();
  try {
    const referral = await Referral.create({
      referrerId: referrer.id,
      refereeId,
      referralCode: String(code).trim().toUpperCase(),
      campaignId: campaign.id,
      status: 'pending',
      rewardStatus: 'pending',
    }, { transaction });

    if (!outerTxn) await transaction.commit();
    return referral;
  } catch (err) {
    if (!outerTxn) await transaction.rollback();
    throw err;
  }
}

// Grants the sign-up reward the first time a referred user becomes an ACTIVE
// (verified) user. Safe to call on every activation — it no-ops when the user
// was not referred, the referral was cancelled/flagged, or the reward was
// already granted. This is the "credit only when the profile becomes active"
// rule from the PRD.
async function creditSignupRewardOnActivation(refereeId) {
  const referral = await Referral.findOne({ where: { refereeId } });
  if (!referral) return null;
  if (referral.signupRewarded) return referral;
  if (referral.status === 'cancelled' || referral.status === 'fraud') return referral;

  const campaign = referral.campaignId
    ? (await ReferralCampaign.findByPk(referral.campaignId)) || await getActiveCampaign()
    : await getActiveCampaign();

  const transaction = await db.transaction();
  try {
    await creditStage({ referral, campaign, stage: 'signup', transaction });
    referral.signupRewarded = true;
    // The wallet transactions exist now, and this assignment is inside the same
    // DB transaction that wrote them — so the status can never claim a credit
    // that rolled back, nor miss one that committed.
    referral.status = STATUS_COMPLETED;
    // Still finer-grained: `partial` says the first-booking stage is outstanding.
    referral.rewardStatus = campaign.firstBookingRewardEnabled ? 'partial' : 'credited';
    referral.completedAt = new Date();
    await referral.save({ transaction });
    await transaction.commit();

    await notify(referral.referrerId, 'You earned referral points!',
      'Your friend is now a verified Cocarr user. Reward points have been added to your wallet.');
    await notify(referral.refereeId, 'Welcome to Cocarr!',
      'Your profile is verified. Reward points from your referral have been credited to your wallet.');

    return referral;
  } catch (err) {
    await transaction.rollback();
    console.error('[referral] signup reward on activation failed:', err);
    throw err;
  }
}

// Grants the first-booking reward the first time a referred user completes a
// booking. Safe to call on every booking confirmation — it no-ops when the user
// was not referred, the stage is disabled, the signup reward has not been
// credited yet, or the reward was already granted.
async function handleFirstBooking(refereeId) {
  const referral = await Referral.findOne({ where: { refereeId } });
  if (!referral) return null;
  if (referral.firstBookingRewarded) return referral;
  if (referral.status === 'cancelled' || referral.status === 'fraud') return referral;
  // A booking can only happen once the user is active, at which point the signup
  // reward has already been credited; guard anyway so the stages stay ordered.
  if (!referral.signupRewarded) return referral;

  const campaign = referral.campaignId
    ? (await ReferralCampaign.findByPk(referral.campaignId)) || await getActiveCampaign()
    : await getActiveCampaign();
  if (!campaign.firstBookingRewardEnabled) return referral;

  const transaction = await db.transaction();
  try {
    await creditStage({ referral, campaign, stage: 'first_booking', transaction });
    referral.firstBookingRewarded = true;
    referral.status = STATUS_COMPLETED;
    referral.rewardStatus = 'credited';
    referral.completedAt = referral.completedAt || new Date();
    await referral.save({ transaction });
    await transaction.commit();

    await notify(referral.referrerId, 'Referral reward credited!',
      'Great news! Your friend completed their first booking. Reward points have been added to your wallet.');
    await notify(referral.refereeId, 'Booking reward credited!',
      'Your first booking earned you referral points. They have been credited to your wallet.');

    return referral;
  } catch (err) {
    await transaction.rollback();
    console.error('[referral] first-booking reward failed:', err);
    throw err;
  }
}

// User-facing referral dashboard (PRD section 10). `codeActive` tells the client
// whether the user has an enabled code yet — the app shows the code only when
// it is active (i.e. the user has completed verification).
async function getReferralOverview(userId) {
  const user = await User.findByPk(userId);
  if (!user) throw new CustomError('User not found', 404);

  const codeRecord = await getUserCode(userId);
  const code = codeRecord && codeRecord.status === 'active' ? codeRecord.code : null;

  const referrals = await Referral.findAll({
    where: { referrerId: userId },
    // firstName/lastName are what `displayName` actually reads — selecting only
    // `name` is why referred users used to render as "Friend".
    include: [{
      model: User,
      as: 'referee',
      attributes: ['id', 'name', 'firstName', 'lastName', 'email', 'contactNumber', 'profilePhoto'],
    }],
    order: [['createdAt', 'DESC']],
  });

  const wallet = await Wallet.findOne({ where: { userId } });

  const completed = referrals.filter((r) => COMPLETED_STATUSES.includes(r.status)).length;
  const pending = referrals.filter((r) => PENDING_STATUSES.includes(r.status)).length;
  const totalPointsEarned = referrals.reduce((sum, r) => sum + (r.rewardPointsReferrer || 0), 0);

  return {
    code,
    referralCode: code,
    codeActive: !!code,
    totalReferrals: referrals.length,
    pending,
    completed,
    totalPointsEarned,
    walletBalance: wallet ? wallet.walletPoints : 0,
    referrals: referrals.map((r) => ({
      id: r.id,
      name: displayNameOr(r.referee, 'Friend'),
      refereeId: r.refereeId,
      status: r.status,
      rewardStatus: r.rewardStatus,
      points: r.rewardPointsReferrer,
      createdAt: r.createdAt,
    })),
  };
}

// ── Admin surface ──────────────────────────────────────────────────────────

async function listCampaigns() {
  return ReferralCampaign.findAll({ order: [['createdAt', 'DESC']] });
}

async function createCampaign(body = {}) {
  return ReferralCampaign.create(body);
}

async function updateCampaign(id, body = {}) {
  const campaign = await ReferralCampaign.findByPk(id);
  if (!campaign) throw new CustomError('Campaign not found', 404);
  await campaign.update(body);
  return campaign;
}

// Admin analytics (PRD section 12).
async function getAnalytics() {
  const [total, rewarded, pending, failed, fraud] = await Promise.all([
    Referral.count(),
    Referral.count({ where: { status: { [Op.in]: COMPLETED_STATUSES } } }),
    Referral.count({ where: { status: { [Op.in]: PENDING_STATUSES } } }),
    Referral.count({ where: { status: 'cancelled' } }),
    Referral.count({ where: { status: 'fraud' } }),
  ]);

  const distributed = await ReferralReward.sum('points', { where: { status: 'success' } });

  return {
    totalReferrals: total,
    successfulReferrals: rewarded,
    pending,
    failed,
    fraudCases: fraud,
    walletRewardsDistributed: distributed || 0,
    conversionRate: total ? Number(((rewarded / total) * 100).toFixed(2)) : 0,
  };
}

// Flag a referral as fraudulent so it can no longer earn rewards.
async function blockReferral(id, reason) {
  const referral = await Referral.findByPk(id);
  if (!referral) throw new CustomError('Referral not found', 404);
  referral.status = 'fraud';
  await referral.save();
  console.log(`[referral] ${id} blocked${reason ? `: ${reason}` : ''}`);
  return referral;
}

// Reverse every successful reward on a referral: debit the wallets, mark the
// audit rows reversed, and cancel the referral.
async function reverseReward(id) {
  const referral = await Referral.findByPk(id);
  if (!referral) throw new CustomError('Referral not found', 404);

  const rewards = await ReferralReward.findAll({ where: { referralId: id, status: 'success' } });
  const transaction = await db.transaction();
  try {
    for (const reward of rewards) {
      const wallet = await Wallet.findOne({ where: { userId: reward.userId }, transaction });
      if (wallet) {
        wallet.walletPoints = Math.max(0, wallet.walletPoints - reward.points);
        wallet.referralPoints = Math.max(0, (wallet.referralPoints || 0) - reward.points);
        await wallet.save({ transaction });
        await WalletTransaction.create({
          userId: reward.userId,
          walletId: wallet.id,
          points: reward.points,
          isCredit: false,
          description: 'Referral reward reversed',
        }, { transaction });
      }
      reward.status = 'reversed';
      await reward.save({ transaction });
    }
    referral.status = 'cancelled';
    referral.rewardStatus = 'pending';
    referral.completedAt = null;
    referral.rewardPointsReferrer = 0;
    referral.rewardPointsReferee = 0;
    await referral.save({ transaction });
    await transaction.commit();
    return referral;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = {
  STATUS_PENDING,
  STATUS_COMPLETED,
  COMPLETED_STATUSES,
  PENDING_STATUSES,
  ensureReferralCode,
  getUserCode,
  getActiveCampaign,
  getProgramStatus,
  validateReferralCode,
  recordPendingReferral,
  creditSignupRewardOnActivation,
  handleFirstBooking,
  getReferralOverview,
  listCampaigns,
  createCampaign,
  updateCampaign,
  getAnalytics,
  blockReferral,
  reverseReward,
};
