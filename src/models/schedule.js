const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4 } = require('uuid');

const Schedule = db.define('schedule', {
  id: {
    type: DataTypes.UUID,
    defaultValue: () => v4(),
    primaryKey: true,
  },
  vehicleId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  startTime: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  endTime: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  deleted:{
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'available',
  },
});

module.exports = Schedule;
