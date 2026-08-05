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
  adminAdded: {
    type: DataTypes.BOOLEAN,
    defaultValue:false
  },
});

module.exports = Host; 