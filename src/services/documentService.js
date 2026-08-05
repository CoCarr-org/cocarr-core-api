const { Op } = require('sequelize');
const User = require('../models/user');
const Host = require('../models/host');
const Vehicle = require('../models/vehicle');
const HostPayoutAccount = require('../models/hostPayoutAccount');
const { logActivity } = require('./activityLogService');
const documentStore = require('./documentStoreService');
const KycDocument = require('../models/kycDocument');
const PanCard = require('../models/panCard');
const DrivingLicence = require('../models/drivingLicence');
const VehicleRcDocument = require('../models/vehicleRcDocument');

// Identity-document and bank-detail views for the admin panel.
//
// MASKING: Aadhaar and PAN are regulated identifiers — an admin list screen
// has no reason to render them in full, and an unmasked Aadhaar in a browser
// (and therefore in logs, screenshots and support tickets) is a real
// liability. Numbers are masked here, server-side, so the full value never
// reaches the client. The document image is still viewable for the admin who
// actually needs to check the card. Bank account numbers are already stored
// as last-4 only by the payout flow, so nothing to mask there.
const maskAadhaar = (v) => {
  if (!v) return null;
  const s = String(v).replace(/\s/g, '');
  return s.length <= 4 ? `••••${s}` : `•••• •••• ${s.slice(-4)}`;
};

// PAN is AAAAA9999A — first 5 identify the holder type/surname, so only the
// tail is shown.
const maskPan = (v) => {
  if (!v) return null;
  const s = String(v).toUpperCase().replace(/\s/g, '');
  return s.length <= 4 ? `••••${s}` : `••••••${s.slice(-4)}`;
};

const paginate = ({ offset = 0, limit = 20 } = {}) => ({
  offset: Number(offset) || 0,
  limit: Math.min(Number(limit) || 20, 100),
});

const searchWhere = (search, fields) => (search
  ? { [Op.or]: fields.map((f) => ({ [f]: { [Op.like]: `%${search}%` } })) }
  : {});

const invalid = (m) => Object.assign(new Error(m), { statusCode: 400 });
const missing = (m) => Object.assign(new Error(m), { statusCode: 404 });

// ── User identity documents: KYC (Aadhaar), PAN, driving licence ──────────
// Documents live in their own tables (kycDocuments / panCards / drivingLicences).
// The response is flattened back to the legacy field names so the admin screen
// needs no change — see documentStoreService.projectUserDocuments.
async function listUserDocuments(params = {}) {
  const { offset, limit } = paginate(params);
  const { search, status, type } = params;

  const where = { ...searchWhere(search, ['name', 'email', 'contactNumber']) };

  // Filtering now means "which users have a document row in this state", which
  // is a join rather than a column test. Resolved to a user-id set first so the
  // pagination below still counts the right thing.
  const TYPE_MODELS = {
    kyc: { model: KycDocument, has: 'documentNumber' },
    pan: { model: PanCard, has: 'panNumber' },
    license: { model: DrivingLicence, has: 'licenceNumber' },
  };

  if (status) {
    const types = type ? [type] : Object.keys(TYPE_MODELS);
    const idSets = await Promise.all(types.map(async (t) => {
      const def = TYPE_MODELS[t];
      if (!def) return [];
      if (status === 'missing') {
        // Users with NO current document of this type.
        const withDoc = await def.model.findAll({
          where: { isCurrent: true }, attributes: ['userId'], raw: true,
        });
        const ids = [...new Set(withDoc.map((r) => r.userId))];
        return { exclude: ids };
      }
      const rows = await def.model.findAll({
        where: {
          isCurrent: true,
          // "Pending" means submitted-but-undecided. A user who never
          // submitted isn't actionable and shouldn't clutter the queue.
          status: status === 'verified' ? 'verified' : 'pending',
        },
        attributes: ['userId'], raw: true,
      });
      return [...new Set(rows.map((r) => r.userId))];
    }));

    const excludes = idSets.filter((x) => x && x.exclude).flatMap((x) => x.exclude);
    const includes = idSets.filter((x) => Array.isArray(x)).flat();

    if (excludes.length && !includes.length) {
      where.id = { [Op.notIn]: excludes };
    } else {
      where.id = { [Op.in]: includes.length ? [...new Set(includes)] : ['__none__'] };
    }
  }

  const { count, rows } = await User.findAndCountAll({
    where, offset, limit, order: [['createdAt', 'DESC']],
    attributes: ['id', 'name', 'email', 'contactNumber', 'countryCode', 'createdAt'],
  });

  const data = await Promise.all(rows.map(async (u) => {
    const docs = await documentStore.getAllForUser(u.id);
    const flat = documentStore.projectUserDocuments(docs);
    return {
      ...u.toJSON(),
      ...flat,
      kycNumber: maskAadhaar(flat.kycNumber),
      panNumber: maskPan(flat.panNumber),
      hasKyc: !!flat.kycNumber,
      hasPan: !!flat.panNumber,
      hasLicense: !!flat.licenseNumber,
    };
  }));

  return { data, totalCount: count };
}

// Maps the admin screen's document keys onto documentStore types.
// Both spellings map to the same document. The admin UI sends 'licence' (UK)
// while this map only accepted 'license' (US), so every licence verify/reject
// threw "Unknown document type: licence" and the button silently did nothing.
// Accepting both is the fix that cannot regress if another caller picks the
// other spelling. 'aadhaar' is likewise an alias for 'kyc'.
const DOC_TYPE_MAP = {
  kyc: 'kyc', aadhaar: 'kyc',
  pan: 'pan',
  license: 'licence', licence: 'licence',
};

// Manual verify/unverify. Writes to the document row, not the user, so the
// decision and its reason live with the document it applies to.
async function setUserDocumentStatus(userId, docType, verified, admin, reason) {
  const type = DOC_TYPE_MAP[docType];
  if (!type) throw invalid(`Unknown document type: ${docType}`);

  const doc = await documentStore.getCurrent(type, userId);
  if (!doc) throw missing(`This user has no ${docType} document on file`);

  if (verified) {
    await documentStore.review(type, doc.id, { status: 'verified' }, admin);
  } else {
    // Un-verifying is a rejection and needs a reason like any other, but the
    // existing admin UI sends none — fall back to something honest rather than
    // silently recording an empty reason.
    await documentStore.review(type, doc.id, {
      status: 'rejected',
      reason: String(reason || '').trim() || 'Verification withdrawn by admin',
    }, admin);
  }

  // Report where this leaves the profile — WITHOUT moving it. A document
  // decision is about the document; the profile's own status is only ever
  // changed by an explicit Approve or Reject. Kept in a try/catch so a failure
  // to read the profile can never undo the document decision that already
  // landed.
  let profileStatus = null;
  let readyToApprove = false;
  try {
    const userVerification = require('./userVerificationService');
    const state = await userVerification.profileReviewState(userId);
    profileStatus = state?.verificationStatus || null;
    readyToApprove = !!state?.readyToApprove;
  } catch (error) {
    console.error('[documentService] could not read profile review state:', error.message);
  }

  return {
    success: true, userId, document: docType, verified: !!verified,
    profileStatus, readyToApprove,
  };
}

// ── Vehicle RC details ────────────────────────────────────────────────────
// RC now lives in vehicleRcDocuments; the response is flattened back to the
// legacy field names so the admin RC screen needs no change.
async function listVehicleRc(params = {}) {
  const { offset, limit } = paginate(params);
  const { search, status } = params;

  const where = { deleted: false, ...searchWhere(search, ['vehicleName', 'vehicleNumber']) };

  // Status is a property of the document, so resolve matching vehicle ids first.
  if (status === 'verified' || status === 'pending') {
    const docs = await VehicleRcDocument.findAll({
      where: { isCurrent: true, status: status === 'verified' ? 'verified' : 'pending' },
      attributes: ['vehicleId'], raw: true,
    });
    const ids = [...new Set(docs.map((d) => d.vehicleId))];
    where.id = { [Op.in]: ids.length ? ids : ['__none__'] };
  }

  const { count, rows } = await Vehicle.findAndCountAll({
    where, offset, limit, order: [['createdAt', 'DESC']],
    attributes: ['id', 'vehicleId', 'vehicleName', 'vehicleNumber',
      'hostId', 'isAdminApproved', 'approvalStatus', 'isDraft', 'createdAt'],
  });

  // There is no Vehicle→Host association defined on the model, so the host is
  // fetched separately rather than via `include`.
  const hostIds = [...new Set(rows.map((r) => r.hostId).filter(Boolean))];
  const hosts = hostIds.length
    ? await Host.findAll({ where: { id: { [Op.in]: hostIds } }, attributes: ['id', 'name', 'contactNumber'] })
    : [];
  const byId = Object.fromEntries(hosts.map((h) => [h.id, h.toJSON()]));

  const data = await Promise.all(rows.map(async (r) => {
    const rc = await documentStore.getCurrent('rc', r.id);
    return {
      ...r.toJSON(),
      ...documentStore.projectVehicleRc(rc),
      // The RC-derived details the screen shows, now sourced from the document.
      ownerName: rc?.ownerName ?? null,
      vehicleMaker: rc?.makerDescription ?? null,
      model: rc?.makerModel ?? null,
      vehicleYear: rc?.manufacturedYear ?? null,
      vehicleColor: rc?.colour ?? null,
      vehicleFuelType: rc?.fuelType ?? null,
      vehicleEngineNumber: rc?.engineNumber ?? null,
      vehicleChassisNumber: rc?.chassisNumber ?? null,
      host: byId[r.hostId] || null,
    };
  }));

  return { data, totalCount: count };
}

async function setVehicleRcStatus(vehicleId, verified, admin, reason) {
  const rc = await documentStore.getCurrent('rc', vehicleId);
  if (!rc) throw missing('This vehicle has no RC document on file');

  if (verified) {
    await documentStore.review('rc', rc.id, { status: 'verified' }, admin);
  } else {
    await documentStore.review('rc', rc.id, {
      status: 'rejected',
      reason: String(reason || '').trim() || 'Verification withdrawn by admin',
    }, admin);
  }

  return { success: true, vehicleId, verified: !!verified };
}

// ── Host bank / payout accounts ───────────────────────────────────────────
async function listHostBankAccounts(params = {}) {
  const { offset, limit } = paginate(params);
  const { search, status, method } = params;

  const where = { ...searchWhere(search, ['accountHolderName', 'hostProvidedName', 'bankName', 'ifscCode', 'upiId']) };
  if (status === 'verified') where.isVerified = true;
  else if (status === 'pending') where.isVerified = false;
  if (method === 'bank' || method === 'upi') where.paymentMethod = method;

  const { count, rows } = await HostPayoutAccount.findAndCountAll({
    where, offset, limit, order: [['createdAt', 'DESC']],
  });

  // Attach the host so the screen shows who an account belongs to.
  const hostIds = [...new Set(rows.map((r) => r.hostId).filter(Boolean))];
  const hosts = hostIds.length
    ? await Host.findAll({ where: { id: { [Op.in]: hostIds } }, attributes: ['id', 'name', 'email', 'contactNumber'] })
    : [];
  const byId = Object.fromEntries(hosts.map((h) => [h.id, h.toJSON()]));

  const data = rows.map((r) => {
    const j = r.toJSON();
    return {
      ...j,
      // Stored as last-4 already; formatted so the UI can't imply it holds more.
      accountNumberMasked: j.accountNumber ? `•••• ${String(j.accountNumber).slice(-4)}` : null,
      // A name mismatch between what the host typed and what the bank returned
      // is the main fraud signal on this screen, so surface it directly.
      nameMismatch: !!(j.hostProvidedName && j.accountHolderName
        && j.hostProvidedName.trim().toLowerCase() !== j.accountHolderName.trim().toLowerCase()),
      host: byId[j.hostId] || null,
    };
  });

  return { data, totalCount: count };
}

// Manual override for when penny-drop verification fails but the admin has
// confirmed the account out of band. Recorded as `isManuallyVerified` so it
// stays distinguishable from a provider-verified account.
async function setHostBankVerification(accountId, verified, admin) {
  const account = await HostPayoutAccount.findByPk(accountId);
  if (!account) throw missing('Payout account not found');

  const previous = { isVerified: account.isVerified, isManuallyVerified: account.isManuallyVerified };
  await account.update({ isVerified: !!verified, isManuallyVerified: !!verified });

  await logActivity({
    adminId: admin?.id, adminName: admin?.name,
    action: verified ? 'verify' : 'unverify',
    entityType: 'HostPayoutAccount', entityId: accountId,
    changes: { from: previous, to: { isVerified: !!verified, isManuallyVerified: !!verified } },
  });

  return { success: true, accountId, verified: !!verified };
}

module.exports = {
  listUserDocuments, setUserDocumentStatus,
  listVehicleRc, setVehicleRcStatus,
  listHostBankAccounts, setHostBankVerification,
};
