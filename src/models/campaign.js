const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

// Marketing > Campaigns. One campaign can target several channels at once,
// each with its own content — an SMS has a 160-char budget and no markup,
// an email has a subject and HTML, so they can't share one body field.
const Campaign = db.define('campaign', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  name: { type: DataTypes.STRING, allowNull: false },

  // Comma-separated subset of: email, sms, push
  channels: { type: DataTypes.STRING, allowNull: false, defaultValue: 'email' },

  emailSubject: { type: DataTypes.STRING, allowNull: true },
  emailBody: { type: DataTypes.TEXT('long'), allowNull: true },
  smsBody: { type: DataTypes.TEXT, allowNull: true },
  pushTitle: { type: DataTypes.STRING, allowNull: true },
  pushBody: { type: DataTypes.TEXT, allowNull: true },

  // Named segment + its parameters (days, cityId, minBookings...).
  audienceSegment: { type: DataTypes.STRING, allowNull: false, defaultValue: 'all' },
  audienceFilters: { type: DataTypes.JSON, allowNull: true },

  status: { type: DataTypes.ENUM('draft', 'scheduled', 'sending', 'sent', 'partial', 'failed'), defaultValue: 'draft' },
  scheduledAt: { type: DataTypes.DATE, allowNull: true },
  sentAt: { type: DataTypes.DATE, allowNull: true },

  recipientCount: { type: DataTypes.INTEGER, defaultValue: 0 },
  emailSent: { type: DataTypes.INTEGER, defaultValue: 0 },
  smsSent: { type: DataTypes.INTEGER, defaultValue: 0 },
  emailFailed: { type: DataTypes.INTEGER, defaultValue: 0 },
  smsFailed: { type: DataTypes.INTEGER, defaultValue: 0 },
  lastError: { type: DataTypes.TEXT, allowNull: true },

  createdByAdminId: { type: DataTypes.STRING, allowNull: true },
  createdByName: { type: DataTypes.STRING, allowNull: true },
});

module.exports = Campaign;
