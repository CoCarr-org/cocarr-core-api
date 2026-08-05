const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

const IpWhitelist = db.define('ipWhitelist', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  label: { type: DataTypes.STRING, allowNull: false },
  ipAddress: { type: DataTypes.STRING, allowNull: false },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  createdByAdminId: { type: DataTypes.STRING, allowNull: true },
});

module.exports = IpWhitelist;
