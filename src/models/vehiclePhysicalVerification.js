const { DataTypes } = require('sequelize');
const db = require('../configs/db');

// Physical (in-person) verification of a vehicle before approval.
//
// One row per vehicle. Four things are checked in person by an ops manager (or
// any role granted the `vehicles` module): the vehicle itself, its RC card, the
// host's PAN card, and the host. Each carries its own status + reject reason so
// the reviewer can accept some and send back others, exactly like the per-item
// document review on the user side.
//
// This is only consulted when the `vehicle.physicalVerification` feature flag is
// on; when off, approval is document-only and these rows are ignored.
const STATUS = { type: DataTypes.ENUM, values: ['pending', 'verified', 'rejected'], defaultValue: 'pending' };

const VehiclePhysicalVerification = db.define('vehiclePhysicalVerification', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  vehicleId: { type: DataTypes.UUID, allowNull: false },

  vehicleStatus: STATUS,
  vehicleReason: { type: DataTypes.TEXT },

  rcStatus: STATUS,
  rcReason: { type: DataTypes.TEXT },

  panStatus: STATUS,
  panReason: { type: DataTypes.TEXT },

  hostStatus: STATUS,
  hostReason: { type: DataTypes.TEXT },

  reviewedByAdminId: { type: DataTypes.UUID },
}, {
  indexes: [{ unique: true, fields: ['vehicleId'] }],
});

// The four checkable items, so the service and UI share one vocabulary.
VehiclePhysicalVerification.ITEMS = ['vehicle', 'rc', 'pan', 'host'];

module.exports = VehiclePhysicalVerification;
