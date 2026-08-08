const KycDocument = require('../models/kycDocument');
const PanCard = require('../models/panCard');
const DrivingLicence = require('../models/drivingLicence');
const VehicleRcDocument = require('../models/vehicleRcDocument');
const OtherDocument = require('../models/otherDocument');
const { logActivity } = require('./activityLogService');

// Single access point for the identity/vehicle document tables.
//
// Everything else should go through here rather than touching the models, so
// the "one row per submission, exactly one isCurrent" rule is enforced in one
// place. Getting that wrong means two current documents and a review queue
// that shows stale data.

const DOC_TYPES = {
  kyc:     { model: KycDocument,       owner: 'userId',    label: 'Aadhaar / KYC' },
  pan:     { model: PanCard,           owner: 'userId',    label: 'PAN card' },
  licence: { model: DrivingLicence,    owner: 'userId',    label: 'Driving licence' },
  rc:      { model: VehicleRcDocument, owner: 'vehicleId', label: 'Vehicle RC' },
};

const httpError = (m, s) => Object.assign(new Error(m), { statusCode: s });
const badRequest = (m) => httpError(m, 400);
const notFound = (m) => httpError(m, 404);

const resolve = (type) => {
  const def = DOC_TYPES[type];
  if (!def) throw badRequest(`Unknown document type: ${type}`);
  return def;
};

// The current document of a given type for an owner.
async function getCurrent(type, ownerId) {
  const { model, owner } = resolve(type);
  return model.findOne({
    where: { [owner]: ownerId, isCurrent: true },
    order: [['createdAt', 'DESC']],
  });
}

// Every document of a type for an owner, newest first — the resubmission trail.
async function getHistory(type, ownerId) {
  const { model, owner } = resolve(type);
  return model.findAll({ where: { [owner]: ownerId }, order: [['createdAt', 'DESC']] });
}

// Fetches the current document of every user-owned type in one go.
async function getAllForUser(userId) {
  const [kyc, pan, licence] = await Promise.all([
    getCurrent('kyc', userId),
    getCurrent('pan', userId),
    getCurrent('licence', userId),
  ]);
  return { kyc, pan, licence };
}

// Records a new submission. The previous current row is demoted rather than
// overwritten, so a rejection and its reason survive the resubmission.
async function submit(type, ownerId, data) {
  const { model, owner } = resolve(type);

  const previous = await getCurrent(type, ownerId);
  if (previous) await previous.update({ isCurrent: false });

  return model.create({
    ...data,
    [owner]: ownerId,
    status: 'pending',
    isCurrent: true,
    // Never accept a verification decision from the caller — that is the
    // admin's alone, and this is the same mass-assignment mistake that let
    // users self-verify through updateLicenseInfo.
    verifiedAt: null,
    reviewedByAdminId: null,
    rejectionReason: null,
  });
}

// Amends the CURRENT document in place, for when a re-attempt is part of the
// same submission rather than a new one — repeated tries at a readable photo
// should not each leave a row behind in the review history.
//
// Use `submit()` whenever the previous row carries an admin decision worth
// preserving; this deliberately keeps the same row and therefore the same id.
async function update(type, document, data) {
  if (!document) throw notFound('Document not found');
  const patch = { ...data };
  // Same mass-assignment guard as submit(): a verification decision is the
  // admin's alone and can never arrive through a capture path.
  delete patch.status;
  delete patch.verifiedAt;
  delete patch.reviewedByAdminId;
  delete patch.rejectionReason;
  delete patch.isCurrent;
  return document.update(patch);
}

// Admin decision. Rejection requires a reason so the owner knows what to fix.
async function review(type, documentId, { status, reason }, admin) {
  const { model } = resolve(type);
  if (!['verified', 'rejected'].includes(status)) {
    throw badRequest(`Invalid review status: ${status}`);
  }
  const text = String(reason || '').trim();
  if (status === 'rejected' && !text) {
    throw badRequest('A reason is required when rejecting a document');
  }

  const doc = await model.findByPk(documentId);
  if (!doc) throw notFound('Document not found');

  const previousStatus = doc.status;
  await doc.update({
    status,
    rejectionReason: status === 'rejected' ? text : null,
    verifiedAt: status === 'verified' ? new Date() : null,
    reviewedByAdminId: admin?.id || null,
  });

  await logActivity({
    adminId: admin?.id, adminName: admin?.name, action: status,
    entityType: `Document:${type}`, entityId: documentId,
    changes: { status: { from: previousStatus, to: status }, reason: text || null },
  });

  return doc;
}

// ── Other documents (polymorphic) ─────────────────────────────────────────
async function listOther(ownerType, ownerId, { includeSuperseded = false } = {}) {
  const where = { ownerType, ownerId };
  if (!includeSuperseded) where.isCurrent = true;
  return OtherDocument.findAll({ where, order: [['createdAt', 'DESC']] });
}

async function submitOther(ownerType, ownerId, data) {
  if (!data.documentType) throw badRequest('documentType is required');

  // Supersede only the same documentType — an address proof must not demote
  // an insurance certificate.
  const existing = await OtherDocument.findOne({
    where: { ownerType, ownerId, documentType: data.documentType, isCurrent: true },
  });
  if (existing) await existing.update({ isCurrent: false });

  return OtherDocument.create({
    ...data,
    ownerType,
    ownerId,
    status: 'pending',
    isCurrent: true,
    verifiedAt: null,
    reviewedByAdminId: null,
    rejectionReason: null,
  });
}

async function reviewOther(documentId, { status, reason }, admin) {
  if (!['verified', 'rejected'].includes(status)) {
    throw badRequest(`Invalid review status: ${status}`);
  }
  const text = String(reason || '').trim();
  if (status === 'rejected' && !text) {
    throw badRequest('A reason is required when rejecting a document');
  }

  const doc = await OtherDocument.findByPk(documentId);
  if (!doc) throw notFound('Document not found');

  const previousStatus = doc.status;
  await doc.update({
    status,
    rejectionReason: status === 'rejected' ? text : null,
    verifiedAt: status === 'verified' ? new Date() : null,
    reviewedByAdminId: admin?.id || null,
  });

  await logActivity({
    adminId: admin?.id, adminName: admin?.name, action: status,
    entityType: `Document:${doc.documentType}`, entityId: documentId,
    changes: { status: { from: previousStatus, to: status }, reason: text || null },
  });

  return doc;
}

// ── Legacy projection ─────────────────────────────────────────────────────
// Flattens the document rows back into the shape the inline columns had.
//
// This is what makes the migration invisible to the three clients: the API
// keeps emitting `kycNumber`, `licenseVerified`, `panImage` and friends, so
// no frontend has to change and the inline columns can be dropped safely.
// Delete this only when every client has moved to the nested document shape.
function projectUserDocuments({ kyc, pan, licence }) {
  return {
    kycNumber: kyc?.documentNumber ?? null,
    kycRef: kyc?.referenceId ?? null,
    kycName: kyc?.holderName ?? null,
    kycImage: kyc?.imageKey ?? null,
    kycVerified: kyc ? kyc.status === 'verified' : false,

    panNumber: pan?.panNumber ?? null,
    panName: pan?.holderName ?? null,
    panImage: pan?.imageKey ?? null,
    panVerified: pan ? pan.status === 'verified' : false,
    panProviderStatus: pan?.providerStatus ?? null,
    panProviderName: pan?.providerName ?? null,
    panNameMatch: pan?.nameMatch ?? null,

    licenseNumber: licence?.licenceNumber ?? null,
    licenseName: licence?.holderName ?? null,
    licenseFrontImage: licence?.frontImageKey ?? null,
    licenseBackImage: licence?.backImageKey ?? null,
    licenseVerified: licence ? licence.status === 'verified' : false,

    // The document rows themselves, for anything that wants the real shape
    // (rejection reasons, review history, per-document status).
    documents: {
      kyc: kyc ? kyc.toJSON() : null,
      pan: pan ? pan.toJSON() : null,
      licence: licence ? licence.toJSON() : null,
    },
  };
}

function projectVehicleRc(rc) {
  return {
    vehicleRcNumber: rc?.rcNumber ?? null,
    vehicleRcImage: rc?.imageKey ?? null,
    vehicleRcBackImage: rc?.backImageKey ?? null,
    vehicleRcVerified: rc ? rc.status === 'verified' : false,
    rcVerified: rc?.providerStatus === 'VERIFIED',
    rcVerificationId: rc?.verificationId ?? null,
    rcDocument: rc ? rc.toJSON() : null,
  };
}

// Convenience: user row + its documents, already flattened.
async function withUserDocuments(user) {
  if (!user) return null;
  const docs = await getAllForUser(user.id);
  return { ...(user.toJSON ? user.toJSON() : user), ...projectUserDocuments(docs) };
}

module.exports = {
  DOC_TYPES,
  getCurrent, getHistory, getAllForUser, submit, update, review,
  listOther, submitOther, reviewOther,
  projectUserDocuments, projectVehicleRc, withUserDocuments,
};
