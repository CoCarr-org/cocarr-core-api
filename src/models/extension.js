const { v4 } = require("uuid");
const db = require("../configs/db");
const User = require("./user");
const Booking = require("./booking");
const { DataTypes } = require("sequelize");
const Transaction = require("./transaction");
const { EXTENSION_INITIATED, EXTENSION_DONE, EXTENSION_FAILED, EXTENSION_CANCELLED } = require("../configs/constants");

const Extension = db.define('extension', {
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
    existingEndTime:{
        type:DataTypes.DATE
    },
    extendedEndTime:{
        type:DataTypes.DATE
    },
    extendedHours: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    status:{
        type:DataTypes.STRING,
        values:[EXTENSION_INITIATED,EXTENSION_DONE,EXTENSION_FAILED,EXTENSION_CANCELLED],
        defaultValue:EXTENSION_INITIATED
    }
  });
  

  // Extension.belongsTo(User,{foreignKey:'userId',as:'user'})
  // Extension.belongsTo(Booking,{foreignKey:'bookingId',as:'booking'})
  // Extension.belongsTo(Transaction,{foreignKey:'transactionId',as:'transaction'})

  module.exports = Extension