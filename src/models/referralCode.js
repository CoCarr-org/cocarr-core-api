const { DataTypes } = require('sequelize');
const sequelize = require('../configs/db');

// One row per user's permanent, shareable referral code — decoupled from the
// `users` table so a marketing concern doesn't live on the core account row and
// so the code can carry its own state and counters.
//
// A code is minted `inactive` and only flips to `active` once the owner
// completes onboarding verification (userVerificationService.approve). Only an
// `active` code can be applied by a referee — that is the "enable referral code
// only for active users" rule, enforced in referralService.validateReferralCode.
const ReferralCode = sequelize.define('referral_code', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4,
  },
  // The owner of the code. One code per user.
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  // The shareable code itself. Stored upper-cased; compared case-insensitively.
  code: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  // inactive | active — a code is usable by referees only while active.
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'inactive',
  },
  // When the code was switched on (i.e. when the owner became an active user).
  activatedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Running counters, so the dashboard/admin can read them without aggregating
  // the referrals table on every request.
  totalReferrals: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  totalPointsEarned: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
}, {
  indexes: [
    { unique: true, fields: ['userId'] },
    { unique: true, fields: ['code'] },
  ],
});

module.exports = ReferralCode;
