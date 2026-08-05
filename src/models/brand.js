const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4 } = require('uuid');

const Brand = db.define('brand', {
    id: {
      type: DataTypes.STRING,
      defaultValue: () => v4(),
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
    },
  });

module.exports = Brand;
