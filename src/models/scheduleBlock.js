const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4 } = require('uuid');

const ScheduleBlock = db.define('scheduleBlock', {
  id: {
    type: DataTypes.UUID,
    defaultValue: () => v4(),
    primaryKey: true,
  },
  vehicleId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  scheduleId: {
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

module.exports = ScheduleBlock;
