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
// EVIDENCE IS THE POINT OF AN IN-PERSON CHECK.
//
// A physical verification with a status and no photograph is indistinguishable
// from someone ticking a box at their desk — which is exactly the thing this
// step exists to rule out. Each item therefore carries its own image list: the
// fleet manager photographs what they are standing in front of, per item, and
// the images are what a later dispute is settled with.
//
// Stored as an array of OBJECT KEYS (`vehicle/<uuid>`), never URLs. Keys survive
// a change of bucket or public host; a stored absolute URL does not, which is
// the mistake `toPublicUrl` exists to undo elsewhere in this codebase. The keys
// are projected to proxy URLs on read.
const STATUS = { type: DataTypes.ENUM, values: ['pending', 'verified', 'rejected'], defaultValue: 'pending' };
const IMAGES = { type: DataTypes.JSON, defaultValue: [] };

const VehiclePhysicalVerification = db.define('vehiclePhysicalVerification', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  vehicleId: { type: DataTypes.UUID, allowNull: false },

  vehicleStatus: STATUS,
  vehicleReason: { type: DataTypes.TEXT },
  vehicleImages: IMAGES,

  rcStatus: STATUS,
  rcReason: { type: DataTypes.TEXT },
  rcImages: IMAGES,

  panStatus: STATUS,
  panReason: { type: DataTypes.TEXT },
  panImages: IMAGES,

  hostStatus: STATUS,
  hostReason: { type: DataTypes.TEXT },
  hostImages: IMAGES,

  // Who physically attended, and when. `reviewedByAdminId` alone says who last
  // touched the row, which is not the same claim.
  inspectedByAdminId: { type: DataTypes.UUID },
  inspectedByName: { type: DataTypes.STRING },
  inspectedAt: { type: DataTypes.DATE },

  reviewedByAdminId: { type: DataTypes.UUID },
}, {
  indexes: [{ unique: true, fields: ['vehicleId'] }],
});

// The four checkable items, so the service and UI share one vocabulary.
VehiclePhysicalVerification.ITEMS = ['vehicle', 'rc', 'pan', 'host'];

// Which items cannot be marked verified without a photograph. Only the car
// itself: that is the one thing the fleet manager travelled to see, and a
// verdict on it with no image is the failure mode this whole step guards
// against. The RC and PAN already have scans on their document rows, and "the
// host was present" is a judgement rather than something a photo settles — so
// images are accepted on all four but demanded only here.
VehiclePhysicalVerification.EVIDENCE_REQUIRED = ['vehicle'];

module.exports = VehiclePhysicalVerification;
