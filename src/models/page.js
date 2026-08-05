const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

// CMS pages AND Legal Pages (terms, privacy) — same shape, distinguished by
// `type`, so the Legal Pages settings screen and the CMS pages screen share
// one store rather than duplicating a near-identical table.
const Page = db.define('page', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  slug: { type: DataTypes.STRING, allowNull: false },
  title: { type: DataTypes.STRING, allowNull: false },
  content: { type: DataTypes.TEXT('long'), allowNull: true },
  type: { type: DataTypes.ENUM('page', 'legal', 'blog'), defaultValue: 'page' },
  isPublished: { type: DataTypes.BOOLEAN, defaultValue: false },
  publishedAt: { type: DataTypes.DATE, allowNull: true },
}, {
  indexes: [{ unique: true, fields: ['slug'] }],
});

module.exports = Page;
