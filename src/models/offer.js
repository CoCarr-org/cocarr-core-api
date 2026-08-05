const { DataTypes } = require('sequelize');
const sequelize = require('../configs/db');

const Offer = sequelize.define('offer', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  code: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT
  },
  discountType: {
    type: DataTypes.ENUM('percent', 'flat'),
    allowNull: false
  },
  discountValue: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  maxDiscountAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  minBookingAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: null,
  },
  maxBookingAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: null
  },
  minHours: {
    type: DataTypes.INTEGER,
    allowNull: null
  },
  maxHours: {
    type: DataTypes.INTEGER,
    allowNull: null
  },
  validFrom: {
    type: DataTypes.DATE,
    allowNull: false
  },
  validTo: {
    type: DataTypes.DATE,
    allowNull: false
  },
  maxUses: {
    type: DataTypes.INTEGER
  },
  offerApplicableOn: {
    type: DataTypes.ENUM('weekend','weekday','all','monday','tuesday','wednesday','thursday','friday','saturday','sunday'),
    allowNull: false,
    defaultValue: 'all'
  },
  firstTimeUser: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  isPlatformOffer: {
    type: DataTypes.BOOLEAN,
    defaultValue:true
  },
  createdBy: {
    type: DataTypes.STRING(50)
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  offerType: {
    type: DataTypes.ENUM('host', 'influencer','company'),
    defaultValue: 'company'
  }
},{tableName:'offers'});

module.exports = Offer; 