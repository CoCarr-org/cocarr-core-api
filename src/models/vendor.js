// models/vendor.js

const { DataTypes } = require('sequelize');
const sequelize = require('../configs/db');
const City = require('./city');
const { v4 } = require('uuid');

const Vendor = sequelize.define('vendor', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
    defaultValue:v4()
  },
  name: {
    type: DataTypes.STRING,
  },
  email:{
    type:DataTypes.STRING
  },
  mobile:{
    type:DataTypes.STRING
  },
  city:{
    type:DataTypes.UUID,
  },
  permission: {
    type: DataTypes.INTEGER,
  },
  lastActivity: {
    type: DataTypes.DATE,
  },
  isActive:{
    type:DataTypes.BOOLEAN,
    defaultValue:true
  }
});

Vendor.belongsTo(City, { foreignKey: 'city', as: 'cityName' });

module.exports = Vendor;
