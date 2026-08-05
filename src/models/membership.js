const { DataTypes, NOW } = require('sequelize');
const db = require('../configs/db'); // assuming you have a database configuration file
const { v4 } = require('uuid');
const User = require('./user');
const { TRANSACTION_TYPE_MEMBERSHIP, TRANSACTION_TYPE_BOOKING, TRANSACTION_INITIATED, TRANSACTION_FAILED, TRANSACTION_PAID, TRANSACTION_CANCELLED, TRANSACTION_AUTHORIZED, TRANSACTION_CAPTURED, MEMBERSHIP_INITIATED, MEMBERSHIP_SUBSCRIBED, MEMBERSHIP_RENEWED, MEMBERSHIP_EXPIRED, MEMBERSHIP_CANCELLED } = require('../configs/constants');
const MembershipType = require('./membershiptype');
const Transaction = require('./transaction');
const Membership = db.define('membership', {
  id: {
    type: DataTypes.UUID,
    defaultValue:()=>v4(),
    primaryKey: true,
  },
  membershipTypeId:{
    type:DataTypes.UUID,
    allowNull:false
    },
    transactionId:{
    type:DataTypes.UUID,
    allowNull:false
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
  initiatedTime: 
  {
    type:DataTypes.DATE,
    defaultValue:NOW(),
  },
  startingTime: 
  {
    type:DataTypes.DATE,
    allowNull:false,
  },
  endingTime: 
  {
    type:DataTypes.DATE,
    allowNull:false,
  },
  freeRideLimit:
  {
    type:DataTypes.INTEGER,
    allowNull:false,
    defaultValue:0
  },
  freeRideLimitUsed:
  {
    type:DataTypes.INTEGER,
    allowNull:false,
    defaultValue:0
  },
  freeDeliveryLimit:
  {
    type:DataTypes.INTEGER,
    allowNull:false,
    defaultValue:0
  },
  freeDeliveryLimitUsed:
  {
    type:DataTypes.INTEGER,
    allowNull:false,
    defaultValue:0
  },
  status:
  {
    type:DataTypes.ENUM,
    values:[MEMBERSHIP_INITIATED,MEMBERSHIP_SUBSCRIBED,MEMBERSHIP_RENEWED,MEMBERSHIP_EXPIRED,MEMBERSHIP_CANCELLED],
    defaultValue:MEMBERSHIP_INITIATED
  }
});

Membership.belongsTo(User, { foreignKey: 'userId', as: 'user' })
Membership.belongsTo(MembershipType, { foreignKey: 'membershipTypeId', as: 'membershipType' })
Membership.belongsTo(Transaction, { foreignKey: 'transactionId', as: 'transaction' })

module.exports = Membership;
