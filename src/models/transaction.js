const { DataTypes } = require('sequelize');
const db = require('../configs/db'); // assuming you have a database configuration file
const { v4 } = require('uuid');
const User = require('./user');
const { TRANSACTION_TYPE_MEMBERSHIP, TRANSACTION_TYPE_BOOKING, TRANSACTION_INITIATED, TRANSACTION_FAILED, TRANSACTION_PAID, TRANSACTION_CANCELLED, TRANSACTION_AUTHORIZED, TRANSACTION_CAPTURED, TRANSACTION_TYPE_EXTENSION, TRANSACTION_TYPE_DUE, TRANSACTION_TYPE_RESCHEDULE } = require('../configs/constants');
const Transaction = db.define('transaction', {
  id: {
    type: DataTypes.UUID,
    defaultValue:()=>v4(),
    primaryKey: true,
  },
  orderId:{
    type:DataTypes.STRING,
    allowNull:false
  },
  paymentId:{
    type:DataTypes.STRING,
  },
  paymentMethod:{
    type:DataTypes.STRING,
  },
  userId:{
    type:DataTypes.STRING,
    allowNull:false
  },
  amount: 
  {
    type : DataTypes.INTEGER,
    allowNull:false
  },
  type:{
    type:DataTypes.ENUM,
    allowNull:false,
    values:[TRANSACTION_TYPE_MEMBERSHIP,TRANSACTION_TYPE_BOOKING,TRANSACTION_TYPE_EXTENSION,TRANSACTION_TYPE_DUE,TRANSACTION_TYPE_RESCHEDULE],
  },
  initiatedTime: DataTypes.DATE,
  executedTime: DataTypes.DATE,
  paymentStatus:
  {
    type:DataTypes.ENUM,
    values:[TRANSACTION_INITIATED,TRANSACTION_FAILED,TRANSACTION_AUTHORIZED,TRANSACTION_CAPTURED,TRANSACTION_PAID,TRANSACTION_CANCELLED],
    defaultValue:TRANSACTION_INITIATED
  },
  status:
  {
    type:DataTypes.ENUM,
    values:[TRANSACTION_INITIATED,TRANSACTION_FAILED,TRANSACTION_CANCELLED],
    defaultValue:TRANSACTION_INITIATED
  },
  offerId: DataTypes.INTEGER
});

Transaction.belongsTo(User, { foreignKey: 'userId', as: 'user' })
// Transaction.belongsTo(Booking, { foreignKey: 'bookingId', as: 'transaction' })

module.exports = Transaction;
