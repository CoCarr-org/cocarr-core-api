const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');
const { toPublicUrl } = require('../utils/publicUrl');

// Content > Media Library. Files themselves live in the private bucket; this
// is the catalogue so uploads are findable/reusable instead of orphaned.
const MediaAsset = db.define('mediaAsset', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  name: { type: DataTypes.STRING, allowNull: false },
  url: {
    type: DataTypes.STRING,
    allowNull: false,
    get() { return toPublicUrl(this.getDataValue('url')); },
  },
  mimeType: { type: DataTypes.STRING, allowNull: true },
  sizeBytes: { type: DataTypes.INTEGER, allowNull: true },
  folder: { type: DataTypes.STRING, defaultValue: 'general' },
  altText: { type: DataTypes.STRING, allowNull: true },
  uploadedByAdminId: { type: DataTypes.STRING, allowNull: true },
});

module.exports = MediaAsset;
