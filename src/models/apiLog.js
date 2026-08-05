const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

// Developer > API Logs. Written by apiLogMiddleware. Deliberately stores no
// request/response bodies — those routinely carry OTPs, Aadhaar numbers and
// payment identifiers, none of which should sit in a browsable admin table.
const ApiLog = db.define('apiLog', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  method: { type: DataTypes.STRING, allowNull: false },
  path: { type: DataTypes.STRING, allowNull: false },
  statusCode: { type: DataTypes.INTEGER, allowNull: true },
  durationMs: { type: DataTypes.INTEGER, allowNull: true },
  adminId: { type: DataTypes.STRING, allowNull: true },
  adminName: { type: DataTypes.STRING, allowNull: true },
  ipAddress: { type: DataTypes.STRING, allowNull: true },
  errorMessage: { type: DataTypes.TEXT, allowNull: true },
});

module.exports = ApiLog;
