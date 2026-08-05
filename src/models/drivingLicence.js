const { DataTypes } = require('sequelize');
const db = require('../configs/db');

// Driving licence. Two images because both faces are collected.
const DrivingLicence = db.define('drivingLicence', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.STRING, allowNull: false },

  licenceNumber: { type: DataTypes.STRING },
  // Name printed on the licence — compared against the profile by the KYC
  // matching rule.
  holderName: { type: DataTypes.STRING },
  dateOfBirth: { type: DataTypes.DATEONLY },
  issuedDate: { type: DataTypes.DATEONLY },
  expiryDate: { type: DataTypes.DATEONLY },
  frontImageKey: { type: DataTypes.STRING },
  backImageKey: { type: DataTypes.STRING },

  status: {
    type: DataTypes.ENUM,
    values: ['pending', 'verified', 'rejected'],
    defaultValue: 'pending',
  },
  rejectionReason: { type: DataTypes.TEXT },
  verifiedAt: { type: DataTypes.DATE },
  reviewedByAdminId: { type: DataTypes.UUID },

  providerStatus: { type: DataTypes.STRING },
  providerCheckedAt: { type: DataTypes.DATE },


  // ── What the OCR provider actually read off the document ─────────────────
  // Stored so the admin reviews the EXTRACTED values against the scan, rather
  // than against what the user typed. `ocrFields` is the parsed subset the UI
  // renders; `ocrRaw` is the untouched provider payload, kept because Cashfree
  // returns fields we don't model yet and a reviewer occasionally needs them.
  ocrStatus: { type: DataTypes.STRING },        // VALID | INVALID | UNCHECKED | FAILED
  ocrVerificationId: { type: DataTypes.STRING },
  ocrFields: { type: DataTypes.JSON },
  ocrRaw: { type: DataTypes.JSON },
  ocrCheckedAt: { type: DataTypes.DATE },
  // Set when OCR could not read the document and the user explicitly agreed to
  // manual verification instead. Without this the submission does not proceed —
  // it is a consent record, so it stores WHEN as well as whether.
  manualConsent: { type: DataTypes.BOOLEAN, defaultValue: false },
  manualConsentAt: { type: DataTypes.DATE },

  isCurrent: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  indexes: [{ fields: ['userId'] }, { fields: ['userId', 'isCurrent'] }],
});

module.exports = DrivingLicence;
