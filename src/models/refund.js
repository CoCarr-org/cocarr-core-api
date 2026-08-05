const { DataTypes } = require('sequelize');
const db = require('../configs/db'); // assuming you have a database configuration file
const { v4 } = require('uuid');
const { REFUND_PENDING, REFUND_PROCESSED, REFUND_FAILED } = require('../configs/constants');
const Booking = require('./booking');
const Transaction = require('./transaction');
const Refund = db.define('refund', {
  id: {
    type: DataTypes.UUID,
    defaultValue:()=>v4(),
    primaryKey: true,
  },
  paymentId:{
    type:DataTypes.STRING,
    allowNull:false
  },
  transactionId:{
    type:DataTypes.UUID,
    allowNull:false
  },
  bookingId:{
    type:DataTypes.UUID
  },
  acquirer:{
    type:DataTypes.STRING,
  },
  amount: 
  {
    type : DataTypes.INTEGER,
    allowNull:false
  },
  initiatedTime: DataTypes.DATE,
  executedTime: DataTypes.DATE,
  status:
  {
    type:DataTypes.ENUM,
    values:[REFUND_PENDING,REFUND_PROCESSED,REFUND_FAILED],
    defaultValue:REFUND_PENDING
  }
});



module.exports = Refund;
