const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

const Faq = db.define('faq', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  question: { type: DataTypes.STRING, allowNull: false },
  answer: { type: DataTypes.TEXT, allowNull: false },
  category: { type: DataTypes.STRING, defaultValue: 'general' },
  audience: { type: DataTypes.ENUM('rider', 'host', 'all'), defaultValue: 'all' },
  sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
});

module.exports = Faq;
