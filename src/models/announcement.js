const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

// Marketing > Announcements — in-app messages.
const Announcement = db.define('announcement', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  title: { type: DataTypes.STRING, allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false },
  audience: { type: DataTypes.ENUM('all', 'rider', 'host'), defaultValue: 'all' },
  severity: { type: DataTypes.ENUM('info', 'warning', 'critical'), defaultValue: 'info' },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  startsAt: { type: DataTypes.DATE, allowNull: true },
  endsAt: { type: DataTypes.DATE, allowNull: true },
});

module.exports = Announcement;
