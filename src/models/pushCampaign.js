const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

// Marketing > Push Notifications. Composed and stored here; actually sending
// goes through the existing fcmService. `status` distinguishes a saved draft
// from one that has been dispatched.
const PushCampaign = db.define('pushCampaign', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  title: { type: DataTypes.STRING, allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false },
  audience: { type: DataTypes.ENUM('all', 'rider', 'host'), defaultValue: 'all' },
  status: { type: DataTypes.ENUM('draft', 'sending', 'sent', 'failed'), defaultValue: 'draft' },
  scheduledAt: { type: DataTypes.DATE, allowNull: true },
  sentAt: { type: DataTypes.DATE, allowNull: true },
  recipientCount: { type: DataTypes.INTEGER, defaultValue: 0 },
  failureReason: { type: DataTypes.TEXT, allowNull: true },
  createdByAdminId: { type: DataTypes.STRING, allowNull: true },
});

module.exports = PushCampaign;
