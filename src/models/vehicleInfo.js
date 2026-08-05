// // models/vehicle.js
// const { DataTypes, Transaction } = require('sequelize');
// const db = require('../configs/db');
// const Vendor = require('./vendor');
// const Brand = require('./brand');
// const Image = require('./image');
// const { v4: uuidv4 } = require('uuid');
// const VehiclePlan = require('./vehicleplan');
// const Pickup = require('./pickuppoint');

// const Vehicle = db.define('vehicle', {
//   id: {
//     type: DataTypes.UUID,
//     defaultValue: () => uuidv4(),
//     primaryKey: true,
//     allowNull: false,
//   },
//   vehicleId: {
//     type: DataTypes.INTEGER,
//   },
//   pickupId: {
//     type: DataTypes.UUID,
//   },
//   vehicleNumber: {
//     type: DataTypes.STRING,
//   },
//   vehicleName: {
//     type: DataTypes.STRING,
//     allowNull: false,
//   },
//   vehicleYear: {
//     type: DataTypes.INTEGER,
//     allowNull: false,
//   },
//   vehicleBrand: {
//     type: DataTypes.STRING, // Assuming the brand is a string, adjust if it's an integer
//     allowNull: false,
//   },
//   vehicleType: {
//     type: DataTypes.STRING,
//     allowNull: false,
//   },
//   vehicleFuelType: {
//     type: DataTypes.STRING,
//     allowNull: false,
//   },
//   vehicleSeats: {
//     type: DataTypes.INTEGER,
//     allowNull: false,
//     defaultValue:4
//   },
//   totalRides: {
//     type: DataTypes.INTEGER,
//     defaultValue:0
//   },
//   totalKms: {
//     type: DataTypes.INTEGER,
//     defaultValue:0
//   },
//   totalUncleanRides: {
//     type: DataTypes.INTEGER,
//     defaultValue:0
//   },
//   ownerType: {
//     type: DataTypes.INTEGER,
//     allowNull: false,
//   },
//   ownerId:{
//     type:DataTypes.STRING
//   },
//   offerType: {
//     type: DataTypes.INTEGER,
//   },
//   reviews: {
//     type: DataTypes.INTEGER,
//     allowNull: false,
//     defaultValue:0
//   },
//   rating: {
//     type: DataTypes.FLOAT,
//     allowNull: false,
//     defaultValue:0
//   },
//   description : {
//     type: DataTypes.STRING,
//     defaultValue:''
//   },
//   features:
//   {
//     type: DataTypes.STRING
//   }
// });

// Vehicle.belongsTo(Vendor,{foreignKey:'ownerId',targetKey:'id',as:'owner'})
// Vehicle.belongsTo(Pickup,{foreignKey:'pickupId',targetKey:'id',as:'pickupPoint'})
// Vehicle.belongsTo(Brand,{foreignKey:'vehicleBrand',targetKey:'id',as:'brand'})
// Vehicle.hasMany(Image, { foreignKey: 'vehicleId', as: 'images' })
// Vehicle.hasMany(VehiclePlan, { foreignKey: 'vehicleId', as: 'vehiclePlan' })

// module.exports = Vehicle;
