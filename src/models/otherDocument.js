const { DataTypes } = require('sequelize');
const db = require('../configs/db');

// Anything that doesn't have a dedicated table: address proof, insurance,
// permits, pollution certificates, and whatever gets asked for next.
//
// Polymorphic on purpose — this is the escape hatch that means a new document
// requirement doesn't need a schema change. Anything that turns out to be
// common enough to need its own columns should graduate to its own table.
const OtherDocument = db.define('otherDocument', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

  // 'user' | 'vehicle' | 'host'. Not a real FK, which is the trade-off for
  // being polymorphic — nothing at the DB level stops an orphan, so always
  // delete these alongside their owner.
  ownerType: { type: DataTypes.STRING, allowNull: false },
  ownerId: { type: DataTypes.STRING, allowNull: false },

  // Free-form so a new requirement needs no migration, e.g. 'address_proof',
  // 'insurance', 'permit', 'pollution_certificate'.
  documentType: { type: DataTypes.STRING, allowNull: false },
  label: { type: DataTypes.STRING },

  documentNumber: { type: DataTypes.STRING },
  holderName: { type: DataTypes.STRING },
  // Array of storage keys — some documents are multi-page.
  imageKeys: { type: DataTypes.JSON },
  issuedDate: { type: DataTypes.DATEONLY },
  expiryDate: { type: DataTypes.DATEONLY },

  status: {
    type: DataTypes.ENUM,
    values: ['pending', 'verified', 'rejected'],
    defaultValue: 'pending',
  },
  rejectionReason: { type: DataTypes.TEXT },
  verifiedAt: { type: DataTypes.DATE },
  reviewedByAdminId: { type: DataTypes.UUID },

  isCurrent: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  indexes: [
    { fields: ['ownerType', 'ownerId'] },
    { fields: ['documentType'] },
  ],
});

module.exports = OtherDocument;
