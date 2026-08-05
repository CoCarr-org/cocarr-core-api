const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

// Security > API Keys. Only a SHA-256 hash of the key is stored — the plain
// value is shown exactly once, at creation, and is unrecoverable after that.
// `prefix` is the first few visible characters so a key can be identified in
// the list without storing the secret.
const ApiKey = db.define('apiKey', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  name: { type: DataTypes.STRING, allowNull: false },
  prefix: { type: DataTypes.STRING, allowNull: false },
  hashedKey: { type: DataTypes.STRING, allowNull: false },
  scopes: { type: DataTypes.STRING, allowNull: true },
  lastUsedAt: { type: DataTypes.DATE, allowNull: true },
  revokedAt: { type: DataTypes.DATE, allowNull: true },
  createdByAdminId: { type: DataTypes.STRING, allowNull: true },
  createdByName: { type: DataTypes.STRING, allowNull: true },
});

module.exports = ApiKey;
