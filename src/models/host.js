const { DataTypes } = require('sequelize');
const sequelize = require('../configs/db');

const Host = sequelize.define('host', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
    // unique: true
  },
  name: {
    type: DataTypes.STRING,
  },
  profilePhoto: {
    type: DataTypes.STRING,
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
  kycNumber: {
    type: DataTypes.STRING,
  },
  kycRef: {
    type: DataTypes.STRING,
  },
  kycImage: {
    type: DataTypes.STRING,
  },
  kycVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  referralCode: {
    type: DataTypes.STRING,
    allowNull: true
  },
  referralCodeUsed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  totalHostCancelledRides: {
    type: DataTypes.INTEGER,
    defaultValue:0
  },
  totalCustomerCancelledRides: {
    type: DataTypes.INTEGER,
    defaultValue:0
  },
  totalRides: {
    type: DataTypes.INTEGER,
    defaultValue:0
  },
  totalUncleanRides: {
    type: DataTypes.INTEGER,
    defaultValue:0
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue:true
  },

  // ── Host verification, which is ITS OWN CHAIN ─────────────────────────────
  //
  // A host is verified on PAN + bank + KYC, and on nothing else. It does NOT
  // depend on the rider side of the same person: someone can be a fully
  // approved rider and an unverified host, or the reverse, and both are normal.
  // Riding needs to know who you are and that you may drive; being paid needs a
  // tax identity and an account to pay into. Those are different questions and
  // conflating them meant a host waiting on a licence review to get paid.
  //
  // Kept as a stored status rather than computed from the three parts, for the
  // same reason the user's is: an admin has to be able to withdraw it (a
  // suspicion, a failed payout, a bank account that turned out not to be
  // theirs) without that being indistinguishable from one of the parts lapsing.
  //
  // `isActive` above is a different, older switch — an operational on/off for
  // the account. This is the review outcome. Don't merge them.
  verificationStatus: {
    type: DataTypes.ENUM('pending', 'verified', 'rejected'),
    allowNull: false,
    defaultValue: 'pending',
  },
  verificationReason: {
    type: DataTypes.TEXT,
  },
  verificationReviewedAt: {
    type: DataTypes.DATE,
  },
  verificationReviewedByAdminId: {
    type: DataTypes.UUID,
  },
  adminAdded: {
    type: DataTypes.BOOLEAN,
    defaultValue:false
  },
});

module.exports = Host; 