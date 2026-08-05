const { v4 } = require("uuid");
const db = require("../configs/db");
const User = require("./user");
const Booking = require("./booking");
const { DataTypes } = require("sequelize");
const Transaction = require("./transaction");
const { RESCHEDULE_INITIATED, RESCHEDULE_DONE, RESCHEDULE_FAILED, RESCHEDULE_CANCELLED } = require("../configs/constants");

const Reschedule = db.define('reschedule', {
    id: {
      type: DataTypes.UUID,
      defaultValue: () => v4(),
      primaryKey: true,
    },
    userId:{
      type:DataTypes.STRING,
    },
    bookingId: {
      type: DataTypes.UUID,
    },
    transactionId:{
        type:DataTypes.UUID
    },
    rescheduledTo:{
        type:DataTypes.DATE
    },
    rescheduledFrom: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    status:{
        type:DataTypes.STRING,
        values:[RESCHEDULE_INITIATED,RESCHEDULE_DONE,RESCHEDULE_FAILED,RESCHEDULE_CANCELLED],
        defaultValue:RESCHEDULE_INITIATED
    }
  });
  

  // Extension.belongsTo(User,{foreignKey:'userId',as:'user'})
  // Extension.belongsTo(Booking,{foreignKey:'bookingId',as:'booking'})
  // Extension.belongsTo(Transaction,{foreignKey:'transactionId',as:'transaction'})

  module.exports = Reschedule