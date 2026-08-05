// models/review.js

const { DataTypes } = require('sequelize');
const sequelize = require('../configs/db');
const { v4 } = require('uuid');
const User = require('./user');
const Vehicle = require('./vehicle');
const Transaction = require('./transaction');
const Booking = require('./booking');

const HostReview = sequelize.define('hostReview', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
    defaultValue:()=>v4()
  },
  totalRating:{
    type:DataTypes.INTEGER,
  },
  hostId:{
    type:DataTypes.UUID
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


module.exports = HostReview;
