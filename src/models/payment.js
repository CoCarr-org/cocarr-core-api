// const { DataTypes } = require('sequelize');
// const db = require('../configs/db'); // assuming you have a database configuration file
// const Vehicle = require('../models/vehicle'); // assuming you have a database configuration file
// const { v4 } = require('uuid');
// const User = require('./user');

// const Payment = db.define('payment', {
//   id: {
//     type: DataTypes.UUID,
//     defaultValue:()=>v4(),
//     primaryKey: true,
//   },
//   orderId:{
//     type:DataTypes.STRING,
//   },
//   userId:{
//     type:DataTypes.UUID
//   },
//   amount: DataTypes.INTEGER,
//   initiatedTime: DataTypes.DATE,
//   executedTime: DataTypes.DATE,
//   status:
//   {
//     type:DataTypes.ENUM,
//     values:["initiated","paid","refunded","cancelled"],
//     defaultValue:"initiated"
//   },
//   offerId: DataTypes.INTEGER
// });

// // Payment.belongsTo(Payment, { foreignKey: 'vehicleId', as: 'vehicle' })
// // Payment.belongsTo(User, { foreignKey: 'userId', as: 'user' })

// module.exports = Payment;
