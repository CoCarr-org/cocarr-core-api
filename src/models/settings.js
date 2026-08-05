const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4 } = require('uuid');
const { CONVENIENCE_FEE, DEPOSIT_AMOUNT, DRIVER_FEE, PICKUP_DROP_FEE,FIRST_TIME_OFFER, MAX_POINTS_USAGE, RESCHEDULE_FEE } = require('../configs/constants');

const Settings = db.define('settings', {
    id: {
      type: DataTypes.STRING,
      defaultValue: () => v4(),
      primaryKey: true,
    },
    type: {
      type: DataTypes.ENUM,
      values:[DRIVER_FEE,CONVENIENCE_FEE,DEPOSIT_AMOUNT,PICKUP_DROP_FEE,FIRST_TIME_OFFER,MAX_POINTS_USAGE,RESCHEDULE_FEE]
    },
    label: {
      type: DataTypes.STRING,
    },
    value: {
      type: DataTypes.STRING,
    },
  });

module.exports = Settings;
