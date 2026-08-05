const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

const FeatureFlag = db.define('featureFlag', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  key: { type: DataTypes.STRING, allowNull: false },
  label: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.STRING, allowNull: true },
  isEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
}, {
  indexes: [{ unique: true, fields: ['key'] }],
});

module.exports = FeatureFlag;
