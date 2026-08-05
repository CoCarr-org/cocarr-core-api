const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

// Bookings > Disputes — "manual resolution". Separate from support tickets:
// a dispute is always attached to a booking and carries a monetary outcome.
const Dispute = db.define('dispute', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  bookingId: { type: DataTypes.STRING, allowNull: false },
  raisedBy: { type: DataTypes.ENUM('rider', 'host', 'admin'), defaultValue: 'rider' },
  raisedByUserId: { type: DataTypes.STRING, allowNull: true },
  category: { type: DataTypes.STRING, allowNull: true },
  description: { type: DataTypes.TEXT, allowNull: true },
  amountClaimed: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  amountAwarded: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  status: { type: DataTypes.ENUM('open', 'investigating', 'resolved', 'rejected'), defaultValue: 'open' },
  resolution: { type: DataTypes.TEXT, allowNull: true },
  resolvedByAdminId: { type: DataTypes.STRING, allowNull: true },
  resolvedAt: { type: DataTypes.DATE, allowNull: true },
});

module.exports = Dispute;
