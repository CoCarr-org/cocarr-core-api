// models/vehicle.js
const { DataTypes, Transaction } = require('sequelize');
const db = require('../configs/db');
const Vendor = require('./vendor');
const Brand = require('./brand');
const Image = require('./image');
const { v4: uuidv4 } = require('uuid');
const VehiclePlan = require('./vehicleplan');
const Pickup = require('./pickuppoint');

// Shows only the last 4 characters: enough for a host to confirm the right car
// was fetched, not enough to be worth harvesting from a public response.
const maskIdentifier = (value) => {
  if (!value) return value;
  const raw = String(value);
  if (raw.length <= 4) return '••••';
  return `${'•'.repeat(Math.max(4, raw.length - 4))}${raw.slice(-4)}`;
};

const Vehicle = db.define('vehicle', {
  id: {
    type: DataTypes.UUID,
    defaultValue: () => uuidv4(),
    primaryKey: true,
    allowNull: false,
  },
  vehicleId: {
    type: DataTypes.INTEGER,
  },
  pickupId: {
    type: DataTypes.UUID,
  },
  vehicleNumber: {
    type: DataTypes.STRING,
  },
  vehicleName: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  vehicleYear: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  // ── Populated from the RC record (Cashfree vehicle-rc) ──────────────────
  // These were previously collected in the wizard but never persisted —
  // `model` in particular was passed to Vehicle.create() with no matching
  // column, so Sequelize silently dropped it.
  model: {
    // RC: maker_model
    type: DataTypes.STRING,
    allowNull: true,
  },
  ownerName: {
    // RC: owner_name
    type: DataTypes.STRING,
    allowNull: true,
  },
  vehicleMaker: {
    // RC: maker_description — the manufacturer as printed on the RC. Kept
    // separate from vehicleBrand, which is our own Brand FK.
    type: DataTypes.STRING,
    allowNull: true,
  },
  vehicleColor: {
    // RC: color
    type: DataTypes.STRING,
    allowNull: true,
  },
  // Captured from the RC record, never typed by the host. Held for dispute /
  // theft verification. Vehicle rows are returned wholesale by the public
  // listing endpoints, so these are masked at the API boundary — the full
  // value stays in the column and is only readable straight from the DB.
  vehicleEngineNumber: {
    type: DataTypes.STRING,
    allowNull: true,
    get() {
      return maskIdentifier(this.getDataValue('vehicleEngineNumber'));
    },
  },
  vehicleChassisNumber: {
    type: DataTypes.STRING,
    allowNull: true,
    get() {
      return maskIdentifier(this.getDataValue('vehicleChassisNumber'));
    },
  },
  vehicleBrand: {
    type: DataTypes.STRING, // Assuming the brand is a string, adjust if it's an integer
    allowNull: false,
  },
  vehicleType: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  vehicleCc: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  vehicleTransmission: {
    type: DataTypes.ENUM,
    values:['manual','automatic'],
    defaultValue:'manual',
    allowNull: false,
  },
  vehicleFuelType: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  vehicleSeats: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue:4
  },
  deposit: {
    type: DataTypes.INTEGER,
    defaultValue:3999
  },
  totalRides: {
    type: DataTypes.INTEGER,
    defaultValue:0
  },
  totalKms: {
    type: DataTypes.INTEGER,
    defaultValue:0
  },
  totalUncleanRides: {
    type: DataTypes.INTEGER,
    defaultValue:0
  },
  ownerType: {
    type: DataTypes.INTEGER, // 0 - Company, 1- Host
    allowNull: false,
  },
  ownerId:{
    // Must match vendors.id (DataTypes.STRING) — it's the FK target via
    // Vehicle.belongsTo(Vendor, { foreignKey: 'ownerId', targetKey: 'id' }).
    // Using UUID here made MySQL reject the FK (ER_FK_INCOMPATIBLE_COLUMNS).
    type:DataTypes.STRING,
    allowNull:true
  },
  hostId:{
    type:DataTypes.UUID,
    allowNull:true
  },
  offerType: {
    type: DataTypes.INTEGER,
  },
  reviews: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue:0
  },
  rating: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue:0
  },
  totalReviews: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue:0
  },
  description : {
    type: DataTypes.TEXT,
    defaultValue:''
  },
  deleted:
  {
    type: DataTypes.BOOLEAN,
    defaultValue:false
  },
  active:{
    type:DataTypes.BOOLEAN,
    defaultValue:true
  },
  availableSoon: {
    type: DataTypes.BOOLEAN,
    defaultValue:false
  },
  features:{
    type:DataTypes.STRING,
  },
  isLuxury:{
    type:DataTypes.BOOLEAN,
    defaultValue:false
  },
  isDeliveryAvailable:{
    type:DataTypes.BOOLEAN,
    defaultValue:false
  },
  isPickupAvailable:{
    type:DataTypes.BOOLEAN,
    defaultValue:true
  },
  isDraft:{
    type:DataTypes.BOOLEAN,
    defaultValue:false
  },
  // Explicit review state. `isAdminApproved` stays in sync with this (approved
  // => true, otherwise false) because the public listing queries in
  // vehicleService gate on that boolean — but it cannot express "rejected",
  // which is why counts of `isAdminApproved: false` used to mean "pending" and
  // would otherwise have silently started including rejected vehicles.
  // ── The host's own photos of the car, reviewed ────────────────────────────
  //
  // Separate from the physical verification, and both are needed. These are the
  // photos the LISTING shows — the ones a rider decides on. They can be honest
  // pictures of the right car and still be unusable: someone else's stock shot,
  // a night photo of a number plate, three angles of the same door. The
  // physical check answers "does this car exist and is this the host"; this one
  // answers "is what a rider will see a fair representation of it".
  //
  // Nothing reviewed them before, so a car went live on whatever was uploaded.
  photosStatus: {
    type: DataTypes.ENUM('pending', 'verified', 'rejected'),
    allowNull: false,
    defaultValue: 'pending',
  },
  photosReason: {
    type: DataTypes.TEXT,
  },
  photosReviewedAt: {
    type: DataTypes.DATE,
  },
  photosReviewedByAdminId: {
    type: DataTypes.UUID,
  },

  approvalStatus:{
    type: DataTypes.ENUM,
    // `maintenance` = a damaged / under-repair car taken off the platform
    // (not live, not bookable) while keeping its approved history. Distinct
    // from `suspended`, which is an ops ban for misconduct — the host sees
    // "in maintenance", not "suspended". Both set isAdminApproved=false.
    values: ['pending', 'approved', 'rejected', 'suspended', 'maintenance'],
    defaultValue: 'pending',
  },
  // Why the car is off the platform for repair, and when it was marked.
  maintenanceReason:{
    type: DataTypes.TEXT,
  },
  maintenanceAt:{
    type: DataTypes.DATE,
  },
  // Suspension hides the vehicle from search and blocks new bookings while
  // keeping every record intact — deliberately NOT a delete. Kept separate
  // from rejectionReason so a suspended vehicle that was previously approved
  // doesn't look like it failed review.
  suspensionReason:{
    type: DataTypes.TEXT,
  },
  suspendedAt:{
    type: DataTypes.DATE,
  },
  // Shown to the host so they know what to fix before resubmitting. Required
  // when rejecting — a rejection with no reason is not actionable.
  rejectionReason:{
    type: DataTypes.TEXT,
  },
  reviewedAt:{
    type: DataTypes.DATE,
  },
  reviewedByAdminId:{
    type: DataTypes.UUID,
  },
  isAdminApproved:{
    type:DataTypes.BOOLEAN,
    defaultValue:false
  }
},{initialAutoIncrement:3200});

Vehicle.belongsTo(Vendor,{foreignKey:'ownerId',targetKey:'id',as:'owner'})
Vehicle.belongsTo(Pickup,{foreignKey:'pickupId',targetKey:'id',as:'pickupPoint'})
Vehicle.belongsTo(Brand,{foreignKey:'vehicleBrand',targetKey:'id',as:'brand'})

Vehicle.hasMany(VehiclePlan, { foreignKey: 'vehicleId', as: 'vehiclePlan' })

module.exports = Vehicle;
