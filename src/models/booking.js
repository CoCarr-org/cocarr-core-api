const { DataTypes } = require('sequelize');
const db = require('../configs/db'); // assuming you have a database configuration file
const Vehicle = require('../models/vehicle'); // assuming you have a database configuration file
const { v4 } = require('uuid');
const User = require('./user');
const { BOOKING_INITIATED, BOOKING_BOOKED, BOOKING_FINISHED, BOOKING_CANCELLED, BOOKING_ONGOING } = require('../configs/constants');
const Transaction = require('./transaction');
const Refund = require('./refund');
const Host = require('./host');

const Booking = db.define('booking', {
  id: {
    type: DataTypes.UUID,
    defaultValue:()=>v4(),
    primaryKey: true,
  },
  bookingId:{
    type:DataTypes.STRING
  },
  transactionId:{
    type:DataTypes.UUID,
    allowNull:true,
    references: {
        model: 'transactions', // Referencing the transactions table
        key: 'id', // Referencing the id column in the transactions table
      },
  },
  startTime: DataTypes.DATE,
  endTime: DataTypes.DATE,
  pickupTime: DataTypes.DATE, // actual
  dropTime: DataTypes.DATE, // actual
  address: DataTypes.STRING, // 
  lat: {type:DataTypes.STRING,allowNull:true}, // 
  lng: {type:DataTypes.STRING,allowNull:true}, // 
  address: {
    type:DataTypes.STRING,
  }, // 
  startKms:DataTypes.INTEGER,
  startKmsImage:DataTypes.STRING,
  startFuel:DataTypes.INTEGER,
  startFuelImage:DataTypes.STRING,
  startImage:DataTypes.STRING,
  endKms:DataTypes.INTEGER,
  endFuel:DataTypes.INTEGER,
  endFuelImage:DataTypes.STRING,
  endImage:DataTypes.STRING,
  delayedBy: DataTypes.INTEGER,
  delayReason: DataTypes.STRING,
  isCancelled: DataTypes.BOOLEAN,
  cancelledBy: DataTypes.INTEGER, // 0 - user, 1 - admin, 2-host
  cancelReason: DataTypes.STRING, // 
  cancellationFee: DataTypes.INTEGER,
  convenienceFee: DataTypes.INTEGER,
  protectionPlanFee: DataTypes.INTEGER,
  // Which tier was bought — 'basicPlan' | 'silverPlan' | 'goldPlan'.
  //
  // `protectionPlan` below stores the plan ROW id, which pins the price card
  // that was in force, but NOT which tier the rider chose. Without this the
  // accident-coverage cap (basicPlanAccidentAmount vs goldPlanAccidentAmount)
  // cannot be resolved at refund time, so damage excess could not be computed.
  protectionPlanTier: DataTypes.STRING,
  protectionPlan: 
  {
    type:DataTypes.UUID,
    allowNull:true
  },
  deliveryFee: DataTypes.INTEGER,
  deliveryType: 
  {
    type:DataTypes.ENUM,
    values:['self','driver']
  },
  offerId: DataTypes.INTEGER,
  rideType:{
    type:DataTypes.INTEGER,
    defaultValue:1 // 1 - Rental , 2 - Subscription
  },
  offerPercentage: DataTypes.INTEGER,
  offerAmount: DataTypes.INTEGER,
  kmAlloted: DataTypes.INTEGER,
  extraKmFee: DataTypes.INTEGER,
  createdAt: DataTypes.DATE,
  totalAmount: DataTypes.INTEGER,
  WalletPointsAwarded: 
  {
    type:DataTypes.INTEGER,
    defaultValue:0
  },
  walletPointsUsed: 
  {
    type:DataTypes.INTEGER,
    defaultValue:0
  },
  depositAmount:DataTypes.INTEGER,
  paymentId: DataTypes.INTEGER,
  userId:{
    type:DataTypes.STRING,
    allowNull:true
  },
  vehicleId:{
    type:DataTypes.UUID,
  },
  hostId:{
    type:DataTypes.UUID,
    allowNull:true
  },
  extension:{
    type:DataTypes.INTEGER,
    defaultValue:0
  },
  isRefunded: 
  {
    type:DataTypes.BOOLEAN,
    defaultValue:false
  },
  paymentType: 
  {
    type:DataTypes.STRING,
    defaultValue:'online' // ['online','cash']
  },
  bookingType: 
  {
    type:DataTypes.STRING,
    defaultValue:'online' // ['online','offline]
  },
  adminAdded: 
  {
    type:DataTypes.BOOLEAN,
    defaultValue:false
  },
  refundedAmount: DataTypes.INTEGER,
  status:
  {
    type:DataTypes.ENUM,
    values:[BOOKING_INITIATED,BOOKING_BOOKED,BOOKING_ONGOING,BOOKING_FINISHED,BOOKING_CANCELLED],
    defaultValue:BOOKING_INITIATED
  },
  remarks:
  {
    type:DataTypes.TEXT,
    allowNull:true
  },
  startOtp:{
    type:DataTypes.INTEGER,
    allowNull:true
  },
  endOtp:{
    type:DataTypes.INTEGER,
    allowNull:true
  },
  // Set when the host has recorded the odometer/fuel/photos for the handover.
  // The ride does NOT become ongoing at that point — it stays `booked` until
  // the rider enters the start OTP, which is what proves both parties are
  // actually together. Same idea for endCapturedAt.
  startCapturedAt:{
    type: DataTypes.DATE,
  },
  endCapturedAt:{
    type: DataTypes.DATE,
  },
  startOtpVerified:{
    type:DataTypes.BOOLEAN,
    defaultValue:false
  },
  endOtpVerified:{
    type:DataTypes.BOOLEAN,
    defaultValue:false
  },
  isRescheduled:{
    type:DataTypes.BOOLEAN,
    defaultValue:false
  }
});

Booking.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' })
Booking.belongsTo(User, { foreignKey: 'userId', as: 'user' })
Booking.belongsTo(Host, { foreignKey: 'hostId', as: 'host' })
Booking.hasOne(Transaction, {sourceKey:'transactionId', foreignKey: 'id', as: 'transaction' })
Booking.hasMany(Refund, {foreignKey: 'bookingId', as: 'refunds' })

module.exports = Booking;
