const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

// Support Center — a customer support ticket. `userId` is the Firebase uid
// of the customer (User PK), nullable so an admin can raise an internal
// ticket that isn't tied to a specific customer.
const Ticket = db.define('ticket', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  ticketNumber: { type: DataTypes.STRING, allowNull: false },
  userId: { type: DataTypes.STRING, allowNull: true },
  bookingId: { type: DataTypes.STRING, allowNull: true },
  subject: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  category: { type: DataTypes.STRING, allowNull: true },
  status: { type: DataTypes.ENUM('open', 'pending', 'resolved', 'closed'), defaultValue: 'open' },
  priority: { type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'), defaultValue: 'medium' },
  assignedToAdminId: { type: DataTypes.STRING, allowNull: true },
  assignedToName: { type: DataTypes.STRING, allowNull: true },
  resolvedAt: { type: DataTypes.DATE, allowNull: true },
});

module.exports = Ticket;
