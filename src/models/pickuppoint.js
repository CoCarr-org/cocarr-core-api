const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4 } = require('uuid');
const City = require('./city');
const Host = require('./host');
const Vehicle = require('./vehicle');

const Pickup = db.define('pickup', {
    id: {
      type: DataTypes.UUID,
      defaultValue: () => v4(),
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
    },
    cityId: {
      type: DataTypes.UUID,
    },
    vehicleId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    hostId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    address: {
      type: DataTypes.STRING,
    },
    lat: {
      type: DataTypes.FLOAT,
    },
    long: {
      type: DataTypes.FLOAT,
    },
  });


module.exports = Pickup;
