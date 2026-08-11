const { DataTypes } = require('sequelize');
const db = require('../configs/db');

// Aadhaar / identity KYC document.
//
// One row per submission, not one per user: a rejected document is kept and a
// new row added, so the review history survives. `isCurrent` marks the row the
// application should read — exactly one per user.
const KycDocument = db.define('kycDocument', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.STRING, allowNull: false },

  // Aadhaar number (or the provider's masked equivalent) and the provider's
  // reference for the e-KYC transaction.
  documentNumber: { type: DataTypes.STRING },
  // The provider's e-KYC transaction id, written ONLY by a successful OTP
  // verification. Its presence is the proof that the holder controls the
  // Aadhaar-linked phone, which is why `submitAadhaar` refuses without it.
  referenceId: { type: DataTypes.STRING },
  otpVerifiedAt: { type: DataTypes.DATE },
  // Name as returned by the provider — what the matching rules compare against.
  holderName: { type: DataTypes.STRING },
  // Aadhaar is collected as two faces, like the licence — the back carries the
  // address, which is what the profile address is checked against.
  imageKey: { type: DataTypes.STRING },        // front (kept as the legacy name)
  backImageKey: { type: DataTypes.STRING },
  dateOfBirth: { type: DataTypes.DATEONLY },
  gender: { type: DataTypes.STRING },
  address: { type: DataTypes.TEXT },

  status: {
    type: DataTypes.ENUM,
    values: ['pending', 'verified', 'rejected'],
    defaultValue: 'pending',
  },
  rejectionReason: { type: DataTypes.TEXT },
  verifiedAt: { type: DataTypes.DATE },
  reviewedByAdminId: { type: DataTypes.UUID },

  // What the verification provider said, kept apart from `status` which is the
  // admin's decision.
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

  // ── What OCR read off the BACK of the Aadhaar ────────────────────────────
  // Aadhaar is a two-faced document: the front carries the number/name/DOB and
  // the back carries the ADDRESS. The front columns above are read from
  // `imageKey`; these are read from `backImageKey`, kept separate so a back read
  // never overwrites the front's number (the two are OCR'd independently, and
  // the back rarely carries a number at all). Mirrors the front shape.
  backOcrStatus: { type: DataTypes.STRING },    // VALID | INVALID | UNCHECKED | FAILED
  backOcrVerificationId: { type: DataTypes.STRING },
  backOcrFields: { type: DataTypes.JSON },
  backOcrRaw: { type: DataTypes.JSON },
  backOcrCheckedAt: { type: DataTypes.DATE },
  // Set when OCR could not read the document and the user explicitly agreed to
  // manual verification instead. Without this the submission does not proceed —
  // it is a consent record, so it stores WHEN as well as whether.
  manualConsent: { type: DataTypes.BOOLEAN, defaultValue: false },
  manualConsentAt: { type: DataTypes.DATE },

  isCurrent: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  indexes: [{ fields: ['userId'] }, { fields: ['userId', 'isCurrent'] }],
});

module.exports = KycDocument;
