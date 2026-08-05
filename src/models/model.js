const { DataTypes } = require('sequelize');
const db = require('../configs/db');


const Model = db.define('model', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
      },
      brand: {
        type: DataTypes.STRING,
      },
  });

  module.exports = Model