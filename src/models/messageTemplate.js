const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

// Settings > Email & SMS Templates. NOTE: the API's existing email/push
// subscribers still send hardcoded content — storing a template here does
// not yet change what actually goes out. Wiring the senders to read from
// this table is a separate change.
const MessageTemplate = db.define('messageTemplate', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  key: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  channel: { type: DataTypes.ENUM('email', 'sms', 'push'), defaultValue: 'email' },
  subject: { type: DataTypes.STRING, allowNull: true },
  body: { type: DataTypes.TEXT('long'), allowNull: false },
  variables: { type: DataTypes.STRING, allowNull: true },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  indexes: [{ unique: true, fields: ['key', 'channel'] }],
});

module.exports = MessageTemplate;
