const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

// Free-form platform configuration, grouped per Settings screen.
//
// NOTE: this is deliberately NOT the existing `settings` table — that one's
// `type` column is an ENUM of seven fee values (DRIVER_FEE, CONVENIENCE_FEE,
// ...), so it physically cannot store arbitrary keys like company name or
// maintenance mode. The two coexist: `settings` stays the pricing/fee store
// behind Settings > Pricing & Fees, this backs the other Settings screens.
const PlatformSetting = db.define('platformSetting', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  group: { type: DataTypes.STRING, allowNull: false },
  key: { type: DataTypes.STRING, allowNull: false },
  label: { type: DataTypes.STRING, allowNull: false },
  value: { type: DataTypes.TEXT, allowNull: true },
  valueType: { type: DataTypes.ENUM('text', 'number', 'boolean', 'textarea'), defaultValue: 'text' },
  description: { type: DataTypes.STRING, allowNull: true },
}, {
  indexes: [{ unique: true, fields: ['group', 'key'] }],
});

module.exports = PlatformSetting;
