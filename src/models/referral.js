const { DataTypes } = require('sequelize');
const sequelize = require('../configs/db');

// One row per referred user. Tracks the referral through its lifecycle
// (created → pending → eligible → rewarded, plus failure states) and records
// how many points each side has earned so far. The permanent per-user code
// itself stays on users.referralCode; this table is the link + state.
const Referral = sequelize.define('referral', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4,
  },
  // The user who owns the referral code (the referrer).
  referrerId: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  // The new user who signed up with the code (the referee).
  refereeId: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  referralCode: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  // created | pending | eligible | rewarded | cancelled | fraud
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'pending',
  },
  // pending | partial | credited  — tracks wallet crediting across the two
  // reward stages (signup, first booking).
  rewardStatus: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'pending',
  },
  // Idempotency flags so a reward stage is granted only once per referral.
  signupRewarded: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  firstBookingRewarded: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  // Running total of points credited to each side for this referral.
  rewardPointsReferrer: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  rewardPointsReferee: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  // When the wallet credit actually landed — i.e. when `status` became
  // `completed`. Written inside the same DB transaction as the wallet rows, so
  // a timestamp here is proof the money moved, not merely that someone intended
  // it to. Null for as long as the referral is pending.
  completedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  indexes: [
    // A user can only be referred once (PRD restriction).
    { unique: true, fields: ['refereeId'] },
    { fields: ['referrerId'] },
  ],
});

module.exports = Referral;
