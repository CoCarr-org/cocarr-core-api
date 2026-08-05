const db = require("../configs/db");
const User = require("./user");
const Booking = require("./booking");
const { DataTypes } = require("sequelize");
const Transaction = require("./transaction");
const { v4 } = require("uuid");
const { DUE_CREATED,DUE_PAID,DUE_CANCELLED } = require("../configs/constants");

const Due = db.define('due', {
    id: {
      type: DataTypes.UUID,
      defaultValue: () => v4(),
      primaryKey: true,
    },
    userId:{
      type:DataTypes.STRING,
      allowNull:false
    },
    bookingId: {
      type: DataTypes.UUID,
      allowNull:true
    },
    orderId:{
        type:DataTypes.STRING,
        allowNull:true
    },
    transactionId: {
      type: DataTypes.UUID,
      allowNull:true
    },
    totalAmount:{
        type:DataTypes.INTEGER
    },
    reason:{
        type: DataTypes.TEXT
    },
    cancelledReason:{
        type:DataTypes.TEXT
    },
    status:{
        type:DataTypes.ENUM,
        values:[DUE_CREATED,DUE_PAID,DUE_CANCELLED],
        defaultValue:DUE_CREATED
    },
    remarks:{
        type:DataTypes.TEXT,
        allowNull:true
    },
    dueType:{
        type:DataTypes.ENUM,
        values:['shared','host','company'],
        defaultValue:'company'
    },
    hostAmount:{
        type:DataTypes.INTEGER,
        allowNull:true,
        comment:'Amount to be paid to host if dueType is shared'
    }
  });
  

  // Due.belongsTo(Booking,{foreignKey:'bookingId',as:'booking',targetKey:'id'})
  // Due.belongsTo(User,{foreignKey:'userId',as:'user',targetKey:'id'})
  // Due.belongsTo(Transaction,{foreignKey:'transactionId',as:'transaction'})

  module.exports = Due