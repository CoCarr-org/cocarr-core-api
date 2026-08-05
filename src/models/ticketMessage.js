const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

// A single reply on a support ticket. `authorName` is denormalised so the
// thread still reads correctly after an admin is renamed or removed.
const TicketMessage = db.define('ticketMessage', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  ticketId: { type: DataTypes.STRING, allowNull: false },
  authorType: { type: DataTypes.ENUM('admin', 'user', 'system'), defaultValue: 'admin' },
  authorId: { type: DataTypes.STRING, allowNull: true },
  authorName: { type: DataTypes.STRING, allowNull: true },
  message: { type: DataTypes.TEXT, allowNull: false },
  isInternalNote: { type: DataTypes.BOOLEAN, defaultValue: false },
});

module.exports = TicketMessage;
