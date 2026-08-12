const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { toPublicUrl } = require('../utils/publicUrl');

// Identity documents (Aadhaar/KYC, PAN, driving licence) are NOT on this model.
// They live in their own tables — kycDocuments / panCards / drivingLicences —
// read through documentStoreService. The inline columns were removed so
// db.sync({alter:true}) cannot re-create them; re-adding a field here would
// resurrect a dead column on the next boot.
const User = db.define('user', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
  },
  profilePhoto: {
    type: DataTypes.STRING,
    // Serve through the API's image proxy; the bucket itself is private.
    get() {
      return toPublicUrl(this.getDataValue('profilePhoto'));
    },
  },
  contactNumber: {
    type: DataTypes.STRING,
  },
  countryCode: {
    type: DataTypes.STRING,
    defaultValue:'+91'
  },
  contactVerified: {
    type: DataTypes.BOOLEAN,
  },
  email: {
    type: DataTypes.STRING,
  },
  emailVerified: {
    type: DataTypes.BOOLEAN,
  },
  // ── Onboarding profile (PRD: Signup & KYC) ─────────────────────────────
  // `name` is the display name Firebase Auth supplied at sign-up. These are
  // the structured fields the KYC matching rules actually compare against,
  // which is why they are separate rather than parsed out of `name` at match
  // time — and why onboarding collects them explicitly.
  firstName: {
    type: DataTypes.STRING,
  },
  lastName: {
    type: DataTypes.STRING,
  },
  dateOfBirth: {
    type: DataTypes.DATEONLY,
  },
  address: {
    type: DataTypes.TEXT,
  },
  city: {
    type: DataTypes.STRING,
  },
  state: {
    type: DataTypes.STRING,
  },
  pincode: {
    type: DataTypes.STRING,
  },

  // ── Profile lifecycle ──────────────────────────────────────────────────
  // NOT the same as each document's own `status` on
  // kycDocuments / drivingLicences / panCards — those record whether one
  // document is approved; this records where the PERSON is.
  //
  //   incomplete → pending → active | rejected
  //        ↑__________________________|          (fix & resubmit)
  //   active → suspended → active                (admin toggle)
  //
  // `incomplete` is the resting state of anyone who has not put a full
  // submission in — a brand-new account, someone mid-wizard, and crucially
  // someone who SKIPPED the licence or Aadhaar step. The apps use it as the
  // single signal for "show the complete-your-profile prompt", which is why
  // the earlier not_started/in_progress split was collapsed: it was a
  // distinction no client ever acted on differently.
  //
  // `active` is what admin approval produces, and the ONLY state that may
  // book a ride. `suspended` keeps every document and approval — suspension
  // is an access decision, not a re-review, so reactivating returns straight
  // to active. A suspended user cannot sign in at all.
  verificationStatus: {
    type: DataTypes.ENUM,
    values: ['incomplete', 'pending', 'active', 'rejected', 'suspended'],
    defaultValue: 'incomplete',
  },
  suspensionReason: {
    type: DataTypes.TEXT,
  },
  suspendedAt: {
    type: DataTypes.DATE,
  },
  // Mandatory when rejecting — the user has to know what to fix.
  verificationRejectionReason: {
    type: DataTypes.TEXT,
  },
  verificationSubmittedAt: {
    type: DataTypes.DATE,
  },
  verificationReviewedAt: {
    type: DataTypes.DATE,
  },
  verificationReviewedByAdminId: {
    type: DataTypes.UUID,
  },
  // ── Resubmission history ────────────────────────────────────────────────
  // A rejected user who fixes their details goes rejected → incomplete →
  // pending, and the reason, reviewer and review timestamp are all cleared on
  // the way through. That is right for the USER — a stale reason must not read
  // as the current state — but it meant the profile arrived back in the admin
  // queue looking like a first-time submission: no indication it had been seen
  // before, no record of what it was turned down for, and sorted by the new
  // timestamp as though it had just walked in.
  //
  // These survive the round trip so a reviewer can tell "this is attempt 3, and
  // here is what we said last time" — which is the whole point of asking someone
  // to resubmit.
  verificationAttempts: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  // The reason from the LAST rejection, kept after the user resubmits.
  // `verificationRejectionReason` is the CURRENT state and is cleared on edit;
  // this one is the history and is not.
  previousRejectionReason: {
    type: DataTypes.TEXT,
  },
  previousRejectedAt: {
    type: DataTypes.DATE,
  },
  // Only approved profiles appear in platform search. Kept as its own column
  // rather than derived from verificationStatus so an admin can hide a
  // verified profile without un-verifying their documents.
  isSearchable: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },

  // ── The two checks an admin makes that are NOT about a single document ────
  //
  // The document rows answer "is this scan real, legible and matching the
  // profile?". These two answer questions no individual document can:
  //
  // kycCheck    — is this person's IDENTITY established? Normally the Aadhaar
  //               OTP proves it, but the OTP cannot always run (a provider
  //               outage, or verification.providerBypass on in a development
  //               environment) — and when it does not, nothing recorded whether
  //               ops had satisfied themselves some other way. This is that
  //               record, and it is why the KYC section can read "verified"
  //               even on a bypassed run.
  //
  // photoMatch  — is the person in the live selfie the same person as the photo
  //               printed on the Aadhaar and the licence? Every document can be
  //               genuine and still belong to somebody else; this is the only
  //               check that looks at the three faces together, and it is the
  //               one an admin does with their eyes.
  //
  // Both are tri-state and both are UNVERIFIABLE — see verificationSections.js
  // for why `pending` has to be reachable again after `verified`.
  kycCheckStatus: {
    type: DataTypes.ENUM('pending', 'verified', 'rejected'),
    allowNull: false,
    defaultValue: 'pending',
  },
  kycCheckReason: {
    type: DataTypes.TEXT,
  },
  kycCheckedAt: {
    type: DataTypes.DATE,
  },
  kycCheckedByAdminId: {
    type: DataTypes.UUID,
  },
  photoMatchStatus: {
    type: DataTypes.ENUM('pending', 'verified', 'rejected'),
    allowNull: false,
    defaultValue: 'pending',
  },
  photoMatchReason: {
    type: DataTypes.TEXT,
  },
  photoMatchedAt: {
    type: DataTypes.DATE,
  },
  photoMatchedByAdminId: {
    type: DataTypes.UUID,
  },

  // Outcome of comparing profile name / licence name / Aadhaar name. Stored so
  // a reviewer can see WHY a submission was auto-flagged.
  nameMatchResult: {
    type: DataTypes.JSON,
  },

  lastCleanRides: {
    type: DataTypes.INTEGER,
    defaultValue:0
  },
  // The user's own shareable referral code and the code they signed up with are
  // NOT on this model. The code lives in its own table (referral_codes, minted
  // only when the user becomes active), and the "who referred me" link lives in
  // the `referrals` table (written at signup). Kept off `users` so a marketing
  // concern doesn't ride on the core account row — and so db.sync({alter:true})
  // does not resurrect the dropped columns. See referralService.
  totalRides: {
    type: DataTypes.INTEGER,
    defaultValue:0
  },
  totalUncleanRides: {
    type: DataTypes.INTEGER,
    defaultValue:0
  },
  isFreeDepositAllowed: {
    type: DataTypes.BOOLEAN,
    defaultValue:false
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue:true
  },
  adminAdded: {
    type: DataTypes.BOOLEAN,
    defaultValue:false
  },
});

module.exports = User;
