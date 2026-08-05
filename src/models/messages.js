const { DataTypes } = require('sequelize');
const sequelize = require('../configs/db');
const { v4 } = require('uuid');
const User = require('./user');
const Conversation = require('./conversation');

const Message = sequelize.define('message', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: () => v4()
  },
  conversationId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  // References User.id (Firebase uid) — a STRING. See conversation.js.
  senderId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  content: {
    type: DataTypes.JSON, // Changed from TEXT to JSON to support rich text or image
    allowNull: false
  },
  type: {
    type: DataTypes.ENUM('rich_text', 'image'), // Added field to specify type
    allowNull: false
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
});

Message.belongsTo(Conversation, { foreignKey: 'conversationId', as: 'conversation' });
Message.belongsTo(User, { foreignKey: 'senderId', as: 'sender' });

module.exports = Message;
