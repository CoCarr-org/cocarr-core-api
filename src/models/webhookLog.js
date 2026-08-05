const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

const WebhookLog = db.define('webhookLog', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  source: { type: DataTypes.STRING, allowNull: false },
  event: { type: DataTypes.STRING, allowNull: true },
  statusCode: { type: DataTypes.INTEGER, allowNull: true },
  succeeded: { type: DataTypes.BOOLEAN, defaultValue: true },
  payload: { type: DataTypes.JSON, allowNull: true },
  error: { type: DataTypes.TEXT, allowNull: true },
});

module.exports = WebhookLog;
