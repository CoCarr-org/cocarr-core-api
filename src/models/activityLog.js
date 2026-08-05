const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

// Records what an admin changed and when — createdAt (Sequelize default
// timestamp) is the "when"; everything else answers "who did what to which
// record". `adminName` is denormalized (copied at write time, not joined)
// so a log entry still reads sensibly after the admin who made the change
// is edited or deleted.
const ActivityLog = db.define('activityLog', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
    defaultValue: () => uuidv4(),
  },
  adminId: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  adminName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  action: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  entityType: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  entityId: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  changes: {
    type: DataTypes.JSON,
    allowNull: true,
  },
});

module.exports = ActivityLog;
