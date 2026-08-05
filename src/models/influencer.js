const { DataTypes } = require('sequelize');
const sequelize = require('../configs/db');

const Influencer = sequelize.define('Influencer', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true
  },
  referral_code: {
    type: DataTypes.STRING(50),
    unique: true
  },
  commission_percent: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
});

module.exports = Influencer; 