const { v4 } = require("uuid");
const db = require("../configs/db");
const { DataTypes } = require("sequelize");

const ProtectionPlan = db.define('protectionplan', {
    id: {
      type: DataTypes.UUID,
      defaultValue: () => v4(),
      primaryKey: true,
    },
    startDate:{
        type:DataTypes.DATE
    },
    endDate:{
        type:DataTypes.DATE
    },
    basicPlanPrice:{
        type:DataTypes.INTEGER  // price for 12 hours
    },
    basicPlanLuxuryPrice:{
        type:DataTypes.INTEGER
    },
    basicPlanExtraHourPrice:{
        type:DataTypes.INTEGER
    },
    basicPlanLuxuryExtraHourPrice:{
        type:DataTypes.INTEGER
    },
    silverPlanPrice:{
        type:DataTypes.INTEGER
    },
    silverPlanLuxuryPrice:{
        type:DataTypes.INTEGER
    },
    silverPlanExtraHourPrice:{
        type:DataTypes.INTEGER
    },
    silverPlanLuxuryExtraHourPrice:{
        type:DataTypes.INTEGER
    },
    goldPlanPrice:{
        type:DataTypes.INTEGER
    },
    goldPlanLuxuryPrice:{
        type:DataTypes.INTEGER
    },
    goldPlanExtraHourPrice:{
        type:DataTypes.INTEGER
    },
    goldPlanLuxuryExtraHourPrice:{
        type:DataTypes.INTEGER
    },
    basicPlanAccidentAmount:{
        type:DataTypes.INTEGER
    },
    basicPlanLuxuryAccidentAmount:{
        type:DataTypes.INTEGER
    },
    silverPlanAccidentAmount:{
        type:DataTypes.INTEGER
    },
    silverPlanLuxuryAccidentAmount:{
        type:DataTypes.INTEGER
    },
    goldPlanAccidentAmount:{
        type:DataTypes.INTEGER
    },
    goldPlanLuxuryAccidentAmount:{
        type:DataTypes.INTEGER
    },
    minHours:{
        type:DataTypes.INTEGER
    },
    maxHours:{
        type:DataTypes.INTEGER
    },
    deleted:{
        type:DataTypes.BOOLEAN,
        defaultValue:false
    }
  });
  

  // Extension.belongsTo(User,{foreignKey:'userId',as:'user'})
  // Extension.belongsTo(Booking,{foreignKey:'bookingId',as:'booking'})
  // Extension.belongsTo(Transaction,{foreignKey:'transactionId',as:'transaction'})

  module.exports = ProtectionPlan