const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4 } = require('uuid');
// const Vehicle = require('./vehicle');

const VehiclePlan = db.define('vehicleplan', {
  id: {
    type: DataTypes.UUID,
    defaultValue:()=>v4(),
    primaryKey: true,
  },
  vehicleId: {
    type: DataTypes.UUID
  },
  kmAlloted: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  extraKmFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  perHourFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue:0
  },
  weekdayFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue:0
  },
  weekendFee: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue:0
  },
  startTime: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  endTime: {
    type: DataTypes.DATE,
    allowNull: true,
  }
});

// VehiclePlan.belongsTo(Vehicle,{foreignKey:'vehicleId',targetKey:'id',as:'vehicle'})

module.exports = VehiclePlan;
