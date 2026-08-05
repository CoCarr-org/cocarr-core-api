const { DataTypes } = require('sequelize');
const db = require('../configs/db');

// PAN card. See kycDocument for the one-row-per-submission rationale.
const PanCard = db.define('panCard', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.STRING, allowNull: false },

  panNumber: { type: DataTypes.STRING },
  // Name as printed on the card — frequently differs from the account name,
  // which is precisely what a reviewer needs to see.
  holderName: { type: DataTypes.STRING },
  imageKey: { type: DataTypes.STRING },

  status: {
    type: DataTypes.ENUM,
    values: ['pending', 'verified', 'rejected'],
    defaultValue: 'pending',
  },
  rejectionReason: { type: DataTypes.TEXT },
  verifiedAt: { type: DataTypes.DATE },
  reviewedByAdminId: { type: DataTypes.UUID },

  // Provider verdict is advisory — verification is the admin's call.
  providerStatus: { type: DataTypes.STRING },
  providerName: { type: DataTypes.STRING },
  providerCheckedAt: { type: DataTypes.DATE },
  nameMatch: { type: DataTypes.BOOLEAN },
  nameMismatchReason: { type: DataTypes.STRING },

  isCurrent: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  indexes: [{ fields: ['userId'] }, { fields: ['userId', 'isCurrent'] }],
});

module.exports = PanCard;
