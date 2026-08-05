const { DataTypes } = require('sequelize');
const sequelize = require('../configs/db');

// Admin-configurable referral campaign. Reward points and eligibility rules
// live here so they can be changed without an app release (PRD objective 5).
// A single campaign is active at a time; the service falls back to sensible
// defaults when none is configured, so the module works out of the box.
const ReferralCampaign = sequelize.define('referral_campaign', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Default referral campaign',
  },
  active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  // Campaign window. Null means open-ended.
  startDate: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  endDate: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Reward points, per the PRD reward table (Signup: 100/100, First booking:
  // 200/100). Configurable per campaign.
  referrerSignupPoints: {
    type: DataTypes.INTEGER,
    defaultValue: 100,
  },
  refereeSignupPoints: {
    type: DataTypes.INTEGER,
    defaultValue: 100,
  },
  referrerFirstBookingPoints: {
    type: DataTypes.INTEGER,
    defaultValue: 200,
  },
  refereeFirstBookingPoints: {
    type: DataTypes.INTEGER,
    defaultValue: 100,
  },
  // Whether the first-booking reward stage is enabled at all. When false only
  // the signup reward is granted.
  firstBookingRewardEnabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  // One-device-one-referral style guard. When true the service enforces that a
  // referee has not already been referred (always enforced) and can be extended
  // with device checks by the caller.
  fraudChecksEnabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
});

module.exports = ReferralCampaign;
