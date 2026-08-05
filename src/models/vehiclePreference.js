const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4 } = require('uuid');
// const Vehicle = require('./vehicle');

const VehiclePreference = db.define('vehiclepreference', {
  id: {
    type: DataTypes.UUID,
    defaultValue:()=>v4(),
    primaryKey: true,
  },
  vehicleId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  hostId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  midnightBooking: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  selfPickup: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  deliverAvailable: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  }
});

module.exports = VehiclePreference;
