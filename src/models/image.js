const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');
const { toPublicUrl } = require('../utils/publicUrl');


const Image = db.define('image', {
    id: {
        type: DataTypes.UUID,
        defaultValue: () => uuidv4(),
        primaryKey: true,
      },
      vehicleId:{
        type:DataTypes.UUID
      },
      isCover:{
        type:DataTypes.BOOLEAN,
        defaultValue:false
      },
      url: {
        type: DataTypes.STRING,
        // Serve through the API's image proxy; the bucket itself is private.
        get() {
          return toPublicUrl(this.getDataValue('url'));
        },
      },
      bookingId:{
        type:DataTypes.UUID
      },
      isStartImage:{
        type:DataTypes.BOOLEAN,
        defaultValue:false
      },
      isEndImage:{
        type:DataTypes.BOOLEAN,
        defaultValue:false
      },
      isDeleted:{
        type:DataTypes.BOOLEAN,
        defaultValue:false
      },
      type:{
        type:DataTypes.STRING,
        enum:['front','back','driverSide','passengerSide','userWithCar','fuelOdometer','other']
      }
  });

//   Image.belongsTo(Vehicle,{foreignKey:'vehicleId',as:'vehicle'});
  module.exports = Image