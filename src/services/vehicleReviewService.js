const { Op } = require('sequelize');
const Vehicle = require('../models/vehicle');
const Host = require('../models/host');
const User = require('../models/user');
const Image = require('../models/image');
const Brand = require('../models/brand');
const Pickup = require('../models/pickuppoint');
const City = require('../models/city');
const Schedule = require('../models/schedule');
const VehiclePhysicalVerification = require('../models/vehiclePhysicalVerification');
const FeatureFlag = require('../models/featureFlag');
const documentStore = require('./documentStoreService');
const { logActivity } = require('./activityLogService');
const { toPublicUrl, extractKey } = require('../utils/publicUrl');

// Vehicle approval — the counterpart of userVerificationService, built to the
// same rule: a vehicle goes live ONLY when an admin presses Approve, and Approve
// refuses unless every required check is verified. The checks are the RC
// document, the host's PAN and the host's identity, plus — when the
// `vehicle.physicalVerification` feature flag is on — a four-part in-person
// inspection. Verifying a document says "this scan is good"; it never silently
// means "this car may now be booked".

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const badRequest = (m) => httpError(m, 400);
const notFound = (m) => httpError(m, 404);

// ── Feature flag ───────────────────────────────────────────────────────────
const PHYSICAL_FLAG_KEY = 'vehicle.physicalVerification';

// Env override wins outright (VEHICLE_PHYSICAL_VERIFICATION=true|false); otherwise
// the featureFlag row decides; default OFF when neither is set, so approvals stay
// document-only until an admin turns it on.
async function isPhysicalVerificationEnabled() {
  const env = process.env.VEHICLE_PHYSICAL_VERIFICATION;
  if (env === 'true') return true;
  if (env === 'false') return false;
  try {
    const flag = await FeatureFlag.findOne({ where: { key: PHYSICAL_FLAG_KEY } });
    return !!flag?.isEnabled;
  } catch (e) {
    return false;
  }
}

// ── Loading ────────────────────────────────────────────────────────────────
async function loadVehicle(id) {
  const vehicle = await Vehicle.findOne({
    where: { id },
    include: [
      { model: Host, as: 'host', include: [{ model: User, as: 'user' }] },
      { model: Image, as: 'images' },
      { model: Brand, as: 'brand' },
      { model: Pickup, as: 'pickupPoint', include: [{ model: City, as: 'city' }] },
    ],
  });
  if (!vehicle) throw notFound('Vehicle not found');
  return vehicle;
}

const hostUserIdOf = (vehicle) => vehicle.host?.userId || vehicle.host?.user?.id || null;

// A vehicle is LIVE when it is approved, active, and the current time falls
// inside one of its available schedule windows. Booking availability layers
// schedule-blocks and existing bookings on top of this; "live" here is the
// simpler "is it on the platform right now" the review screen shows.
async function computeLive(vehicle) {
  if (vehicle.approvalStatus !== 'approved' || !vehicle.active) {
    return { isLive: false, liveReason: vehicle.approvalStatus !== 'approved' ? `Vehicle is ${vehicle.approvalStatus}` : 'Vehicle is inactive' };
  }
  const now = new Date();
  const window = await Schedule.findOne({
    where: {
      vehicleId: vehicle.id,
      deleted: false,
      status: 'available',
      startTime: { [Op.lte]: now },
      endTime: { [Op.gte]: now },
    },
  });
  if (!window) return { isLive: false, liveReason: 'No active schedule window covers the current time' };
  return { isLive: true, liveReason: 'Approved, active and within an available schedule window' };
}

// ── Physical verification row ───────────────────────────────────────────────
async function getPhysicalRow(vehicleId) {
  return VehiclePhysicalVerification.findOne({ where: { vehicleId } });
}

async function ensurePhysicalRow(vehicleId) {
  const [row] = await VehiclePhysicalVerification.findOrCreate({ where: { vehicleId }, defaults: { vehicleId } });
  return row;
}

const physicalItemsVerified = (row) =>
  !!row && VehiclePhysicalVerification.ITEMS.every((item) => row[`${item}Status`] === 'verified');

// ── The review payload ───────────────────────────────────────────────────────
async function getForReview(vehicleId) {
  const vehicle = await loadVehicle(vehicleId);
  const hostUserId = hostUserIdOf(vehicle);

  const [rcDoc, panDoc, physicalRow, physicalRequired, live] = await Promise.all([
    documentStore.getCurrent('rc', vehicle.id),
    hostUserId ? documentStore.getCurrent('pan', hostUserId) : Promise.resolve(null),
    getPhysicalRow(vehicle.id),
    isPhysicalVerificationEnabled(),
    computeLive(vehicle),
  ]);

  const hostUser = vehicle.host?.user || null;
  const hostVerificationStatus = hostUser?.verificationStatus || 'unknown';

  // What still stands between this vehicle and Approve.
  const outstanding = [];
  if (!rcDoc) outstanding.push('RC (not submitted)');
  else if (rcDoc.status !== 'verified') outstanding.push(`RC (${rcDoc.status})`);
  if (!panDoc) outstanding.push('Host PAN (not submitted)');
  else if (panDoc.status !== 'verified') outstanding.push(`Host PAN (${panDoc.status})`);
  if (hostVerificationStatus !== 'active') outstanding.push(`Host identity (${hostVerificationStatus})`);
  if (physicalRequired && !physicalItemsVerified(physicalRow)) {
    const pending = VehiclePhysicalVerification.ITEMS
      .filter((item) => (physicalRow?.[`${item}Status`] || 'pending') !== 'verified')
      .map((item) => `${item} (${physicalRow?.[`${item}Status`] || 'pending'})`);
    outstanding.push(`Physical checks: ${pending.join(', ')}`);
  }

  return {
    ...vehicle.toJSON(),
    ...documentStore.projectVehicleRc(rcDoc),
    // Review-shaped documents so the ops UI reads the same shape as user review.
    review: {
      rc: rcDoc ? rcDoc.toJSON() : null,
      pan: panDoc ? panDoc.toJSON() : null,
      host: hostUser
        ? { userId: hostUserId, name: hostUser.name, verificationStatus: hostVerificationStatus }
        : null,
      // Keys are stored; URLs are what a client can put in an <img src>.
      physical: projectPhysical(physicalRow),
      physicalRequired,
      physicalItems: VehiclePhysicalVerification.ITEMS,
      outstanding,
      readyToApprove:
        vehicle.approvalStatus === 'pending'
        && !outstanding.length,
      ...live,
    },
  };
}

// ── Per-document review (RC + host PAN) ──────────────────────────────────────
async function reviewDocument(vehicleId, docType, { status, reason }, admin) {
  if (!['verified', 'rejected'].includes(status)) throw badRequest(`Invalid status: ${status}`);
  const vehicle = await loadVehicle(vehicleId);

  let type;
  let ownerId;
  if (docType === 'rc') { type = 'rc'; ownerId = vehicle.id; }
  else if (docType === 'pan') {
    type = 'pan';
    ownerId = hostUserIdOf(vehicle);
    if (!ownerId) throw badRequest('This vehicle has no host on file');
  } else {
    throw badRequest(`Unknown document type: ${docType} (expected rc or pan)`);
  }

  const doc = await documentStore.getCurrent(type, ownerId);
  if (!doc) throw badRequest(`This vehicle has no ${docType.toUpperCase()} on file`);

  await documentStore.review(type, doc.id, { status, reason }, admin);
  return getForReview(vehicleId);
}

// ── Physical verification (one item at a time) ───────────────────────────────
// Stored image KEYS -> proxy URLs, per item. Everything else on the row passes
// through untouched, so adding a column does not mean editing this function.
function projectPhysical(row) {
  if (!row) return null;
  const out = row.toJSON();
  VehiclePhysicalVerification.ITEMS.forEach((item) => {
    const keys = Array.isArray(out[`${item}Images`]) ? out[`${item}Images`] : [];
    out[`${item}Images`] = keys;
    out[`${item}ImageUrls`] = keys.map((k) => toPublicUrl(k) || k);
  });
  return out;
}

async function setPhysicalCheck(vehicleId, { item, status, reason, images }, admin) {
  if (!VehiclePhysicalVerification.ITEMS.includes(item)) {
    throw badRequest(`Unknown physical check: ${item}`);
  }
  if (!['verified', 'rejected', 'pending'].includes(status)) throw badRequest(`Invalid status: ${status}`);
  const text = String(reason || '').trim();
  if (status === 'rejected' && !text) throw badRequest('A reason is required when rejecting a physical check');

  await loadVehicle(vehicleId); // 404s if the vehicle is gone
  const row = await ensurePhysicalRow(vehicleId);

  // Images arrive as object keys or as already-proxied URLs, depending on which
  // upload helper the client used; `extractKey` normalises both to a bare key
  // and is the same function the proxy route resolves with. Storing a URL would
  // pin the row to today's public host — the exact breakage toPublicUrl exists
  // to repair.
  //
  // `undefined` means "not supplied, leave what is there"; an explicit `[]`
  // clears. Conflating them would make a status change silently discard the
  // photographs taken on the previous call.
  const supplied = images === undefined
    ? undefined
    : (Array.isArray(images) ? images : [images])
      .map((v) => extractKey(String(v || '')))
      .filter(Boolean);

  const nextImages = supplied === undefined ? (row[`${item}Images`] || []) : supplied;

  if (
    status === 'verified'
    && VehiclePhysicalVerification.EVIDENCE_REQUIRED.includes(item)
    && nextImages.length === 0
  ) {
    throw badRequest(
      'Add at least one photograph of the vehicle before marking the physical check verified.',
    );
  }

  const previous = row[`${item}Status`];
  await row.update({
    [`${item}Status`]: status,
    [`${item}Reason`]: status === 'rejected' ? text : null,
    ...(supplied === undefined ? {} : { [`${item}Images`]: nextImages }),
    // Stamped on the first real verdict, so the record says who attended rather
    // than only who last edited the row.
    inspectedByAdminId: row.inspectedByAdminId || admin?.id || null,
    inspectedByName: row.inspectedByName || admin?.name || null,
    inspectedAt: row.inspectedAt || new Date(),
    reviewedByAdminId: admin?.id || null,
  });

  await logActivity({
    adminId: admin?.id, adminName: admin?.name, action: `physical-${status}`,
    entityType: 'VehiclePhysical', entityId: vehicleId,
    changes: {
      [`${item}Status`]: { from: previous, to: status },
      reason: text || null,
      images: nextImages.length,
    },
  });

  return getForReview(vehicleId);
}

// ── Approve — the gated last step ────────────────────────────────────────────
async function approve(vehicleId, admin) {
  const vehicle = await loadVehicle(vehicleId);
  if (vehicle.isAdminApproved && vehicle.approvalStatus === 'approved') {
    throw badRequest('Vehicle is already approved');
  }
  // Only a vehicle awaiting review can be approved. A rejected vehicle becomes
  // pending again when the host edits and resubmits (hostService.updateVehicle),
  // so it too passes here once resubmitted.
  if (vehicle.approvalStatus !== 'pending') {
    throw badRequest(`Only a vehicle awaiting review can be approved — this one is ${vehicle.approvalStatus}`);
  }

  const hostUserId = hostUserIdOf(vehicle);
  const [rcDoc, panDoc, physicalRow, physicalRequired] = await Promise.all([
    documentStore.getCurrent('rc', vehicle.id),
    hostUserId ? documentStore.getCurrent('pan', hostUserId) : Promise.resolve(null),
    getPhysicalRow(vehicle.id),
    isPhysicalVerificationEnabled(),
  ]);

  const outstanding = [];
  if (rcDoc?.status !== 'verified') outstanding.push(`RC (${rcDoc?.status || 'not submitted'})`);
  if (panDoc?.status !== 'verified') outstanding.push(`Host PAN (${panDoc?.status || 'not submitted'})`);
  const hostStatus = vehicle.host?.user?.verificationStatus || 'unknown';
  if (hostStatus !== 'active') outstanding.push(`Host identity (${hostStatus})`);
  if (physicalRequired && !physicalItemsVerified(physicalRow)) outstanding.push('Physical verification incomplete');

  if (outstanding.length) {
    throw badRequest(`Verify every check before approving. Outstanding: ${outstanding.join(', ')}`);
  }

  await vehicle.update({
    approvalStatus: 'approved',
    isAdminApproved: true,
    active: true,
    rejectionReason: null,
    reviewedAt: new Date(),
    reviewedByAdminId: admin?.id || null,
  });

  await logActivity({
    adminId: admin?.id, adminName: admin?.name, action: 'approve',
    entityType: 'Vehicle', entityId: vehicleId,
    changes: { approvalStatus: { from: 'pending', to: 'approved' } },
  });

  return getForReview(vehicleId);
}

// ── Maintenance (damaged / under repair) ─────────────────────────────────────
// Takes an approved car off the platform without it looking rejected or
// suspended, and puts it back when repairs are done. Reversible, data intact.
async function setMaintenance(vehicleId, { maintenance, reason }, admin) {
  const vehicle = await loadVehicle(vehicleId);

  if (maintenance) {
    const text = String(reason || '').trim();
    if (!text) throw badRequest('A reason is required when marking a vehicle for maintenance');
    if (vehicle.approvalStatus !== 'approved') {
      throw badRequest(`Only an approved vehicle can be put into maintenance — this one is ${vehicle.approvalStatus}`);
    }
    await vehicle.update({
      approvalStatus: 'maintenance',
      maintenanceReason: text,
      maintenanceAt: new Date(),
      // Drops it out of every public listing query, which all gate on this.
      isAdminApproved: false,
      reviewedByAdminId: admin?.id || null,
    });
  } else {
    if (vehicle.approvalStatus !== 'maintenance') throw badRequest('This vehicle is not in maintenance');
    await vehicle.update({
      approvalStatus: 'approved',
      maintenanceReason: null,
      maintenanceAt: null,
      isAdminApproved: true,
      reviewedByAdminId: admin?.id || null,
    });
  }

  await logActivity({
    adminId: admin?.id, adminName: admin?.name,
    action: maintenance ? 'maintenance-on' : 'maintenance-off',
    entityType: 'Vehicle', entityId: vehicleId,
    changes: { approvalStatus: { from: vehicle.approvalStatus, to: maintenance ? 'maintenance' : 'approved' },
               reason: maintenance ? String(reason || '').trim() : null },
  });

  return getForReview(vehicleId);
}

// Seed the physical-verification flag (default OFF) so it shows up in the
// Feature Flags admin screen without anyone creating it by hand. Idempotent.
async function ensureDefaultFlag() {
  await FeatureFlag.findOrCreate({
    where: { key: PHYSICAL_FLAG_KEY },
    defaults: {
      key: PHYSICAL_FLAG_KEY,
      label: 'Vehicle physical verification',
      description: 'Require an in-person check of the vehicle, RC, PAN card and host before a vehicle can be approved.',
      isEnabled: false,
    },
  });
}

module.exports = {
  PHYSICAL_FLAG_KEY,
  isPhysicalVerificationEnabled,
  ensureDefaultFlag,
  getForReview,
  reviewDocument,
  setPhysicalCheck,
  approve,
  setMaintenance,
};
