const { DataTypes } = require('sequelize');
const sequelize = require('../configs/db');
const { v4 } = require('uuid');
const User = require('./user');
const Booking = require('./booking');

const Conversation = sequelize.define('conversation', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: () => v4()
  },
  bookingId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  // Both reference User.id, which is the Firebase uid — a STRING, not a UUID.
  // Declaring these UUID made MySQL reject the foreign key outright
  // ("Referencing column 'hostId' and referenced column 'id' ... are
  // incompatible"), which aborted the whole schema sync and left every model
  // after this one without a table.
  hostId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  userId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  isHostNotificationUnread: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  isUserNotificationUnread: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  isClosed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
});

Conversation.belongsTo(Booking, { foreignKey: 'bookingId', as: 'booking' });
Conversation.belongsTo(User, { foreignKey: 'hostId', as: 'host' });
Conversation.belongsTo(User, { foreignKey: 'userId', as: 'user' });

module.exports = Conversation;
