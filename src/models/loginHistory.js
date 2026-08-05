const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

// Security > Sessions / Administration > Login History. Written by the admin
// auth middleware on each authenticated request burst (throttled) — Firebase
// holds the real sign-in records, this is the panel-visible copy.
const LoginHistory = db.define('loginHistory', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  adminId: { type: DataTypes.STRING, allowNull: true },
  adminEmail: { type: DataTypes.STRING, allowNull: true },
  adminName: { type: DataTypes.STRING, allowNull: true },
  ipAddress: { type: DataTypes.STRING, allowNull: true },
  userAgent: { type: DataTypes.STRING, allowNull: true },
  success: { type: DataTypes.BOOLEAN, defaultValue: true },
});

module.exports = LoginHistory;
