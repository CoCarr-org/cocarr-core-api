const { DataTypes } = require('sequelize');
const db = require('../configs/db');

// Vehicle registration certificate. Links to the VEHICLE, not the user.
//
// Named vehicleRcDocument rather than vehicleRc so the table name cannot be
// confused with the `rcVerified`/`vehicleRcVerified` columns still on the
// vehicle row during the migration window.
const VehicleRcDocument = db.define('vehicleRcDocument', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  vehicleId: { type: DataTypes.UUID, allowNull: false },

  rcNumber: { type: DataTypes.STRING },
  imageKey: { type: DataTypes.STRING },

  // Captured FROM the RC record, never typed by the host — held for dispute
  // and audit purposes.
  ownerName: { type: DataTypes.STRING },
  makerModel: { type: DataTypes.STRING },
  makerDescription: { type: DataTypes.STRING },
  manufacturedYear: { type: DataTypes.STRING },
  colour: { type: DataTypes.STRING },
  fuelType: { type: DataTypes.STRING },
  engineNumber: { type: DataTypes.STRING },
  chassisNumber: { type: DataTypes.STRING },
  registrationDate: { type: DataTypes.DATEONLY },
  fitnessUpto: { type: DataTypes.DATEONLY },
  insuranceUpto: { type: DataTypes.DATEONLY },

  status: {
    type: DataTypes.ENUM,
    values: ['pending', 'verified', 'rejected'],
    defaultValue: 'pending',
  },
  rejectionReason: { type: DataTypes.TEXT },
  verifiedAt: { type: DataTypes.DATE },
  reviewedByAdminId: { type: DataTypes.UUID },

  // The provider's verification id, distinct from the admin's decision.
  providerStatus: { type: DataTypes.STRING },
  verificationId: { type: DataTypes.STRING },
  providerCheckedAt: { type: DataTypes.DATE },

  isCurrent: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  indexes: [{ fields: ['vehicleId'] }, { fields: ['vehicleId', 'isCurrent'] }],
});

module.exports = VehicleRcDocument;
