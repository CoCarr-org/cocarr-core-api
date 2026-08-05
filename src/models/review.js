// models/review.js

const { DataTypes } = require('sequelize');
const sequelize = require('../configs/db');
const { v4 } = require('uuid');
const User = require('./user');
const Vehicle = require('./vehicle');
const Transaction = require('./transaction');
const Booking = require('./booking');

const Review = sequelize.define('review', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
    defaultValue:()=>v4()
  },
  totalRating:{
    type:DataTypes.INTEGER,
  },
  cleanlinessRating:{
    type:DataTypes.INTEGER,
  },
  comfortRating:{
    type:DataTypes.INTEGER,
  },
  hostRating:{
    type:DataTypes.INTEGER,
  },
  handlingRating:{
    type:DataTypes.INTEGER,
    allowNull:true,
    defaultValue:null
  },
  userId:{
    type:DataTypes.STRING
  },
  vehicleId:{
    type:DataTypes.UUID
  },
  bookingId:{
    type:DataTypes.UUID
  },
  comment:{
    type:DataTypes.TEXT,
    allowNull:true
  }
});

// Review.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Review.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });
Review.belongsTo(Booking, { foreignKey: 'bookingId', as: 'booking' });

module.exports = Review;
