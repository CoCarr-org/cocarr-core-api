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
  // Front of the card — kept as the legacy name, exactly like kycDocument's.
  // The number and the printed name are both on this face, so it is the only
  // one OCR reads (see SCANNED_KINDS.pan in onboardingDocumentService).
  imageKey: { type: DataTypes.STRING },
  // Back of the card. Carries no data we extract, but a reviewer needs it: it
  // is where a tampered or laminated-over card shows, and every other identity
  // document in this system is captured both faces. Nullable — every PAN
  // submitted before this column existed has a front and nothing else, and
  // those rows must keep reading cleanly.
  backImageKey: { type: DataTypes.STRING },

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

  // OCR of the uploaded card, mirroring kycDocument/drivingLicence. Lets PAN go
  // through the same scan → read → manual-fallback flow as Aadhaar and licence.
  // `providerStatus` above stays the PAN-registry verdict; `ocrStatus` is the
  // separate reading of the photograph.
  ocrStatus: { type: DataTypes.STRING },
  ocrVerificationId: { type: DataTypes.STRING },
  ocrFields: { type: DataTypes.JSON },
  ocrRaw: { type: DataTypes.JSON },
  ocrCheckedAt: { type: DataTypes.DATE },
  // Set when OCR could not read the card and the user asked for a human check.
  manualConsent: { type: DataTypes.BOOLEAN, defaultValue: false },
  manualConsentAt: { type: DataTypes.DATE },

  isCurrent: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  indexes: [{ fields: ['userId'] }, { fields: ['userId', 'isCurrent'] }],
});

module.exports = PanCard;
