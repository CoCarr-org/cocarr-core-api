const { DataTypes } = require('sequelize');
const sequelize = require('../configs/db');

// Audit row for each individual wallet reward credited under a referral.
// One referral produces up to four of these (signup + first-booking, each for
// referrer and referee). Links back to the wallet transaction that moved the
// points, so a reward can be traced and reversed.
const ReferralReward = sequelize.define('referral_reward', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4,
  },
  referralId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  // Who received these points.
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  // referrer | referee — which side of the referral this credit is for.
  beneficiary: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  // signup | first_booking
  rewardType: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  points: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  walletTransactionId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  // success | reversed
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'success',
  },
});

module.exports = ReferralReward;
