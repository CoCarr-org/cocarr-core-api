const { Op } = require('sequelize');
const User = require('../models/user');
const { matchAgainstProfile } = require('./nameMatchService');
const { logActivity } = require('./activityLogService');
const documentStore = require('./documentStoreService');
const { isProviderBypassEnabled } = require('../utils/verificationBypass');
const referralService = require('./referralService');
const walletService = require('./walletService');

// User onboarding / KYC verification workflow (PRD: Signup & KYC).
//
// Status flow:
//   incomplete → pending → active | rejected
//        ↑__________________________|      (fix & resubmit)
//   active → suspended → active            (admin toggle)
//
// The per-document `status` on each document row records whether THAT document
// is approved. `verificationStatus` is the PROFILE's position in the workflow —
// what the admin queue, the booking gate and the apps' complete-your-profile
// prompt key off. The two are deliberately not the same thing.
//
// A submission only reaches `pending` when the licence AND Aadhaar are both
// present. The onboarding wizard lets a user SKIP either, and a skipped
// document leaves the profile `incomplete` — that is the whole point of the
// state, not an edge case.

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const badRequest = (m) => httpError(m, 400);
const notFound = (m) => httpError(m, 404);

// Fields the user may set during onboarding. Anything else in the body is
// dropped — verificationStatus and isSearchable are decided here, never by
// the client. (The same mass-assignment mistake existed in updateKycInfo.)
const PROFILE_FIELDS = [
  'firstName', 'lastName', 'dateOfBirth', 'address', 'city', 'state', 'pincode', 'email',
];

const displayName = (user) => {
  const composed = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return composed || user.name || '';
};

// ── OCR card view ──────────────────────────────────────────────────────────
// Everything read off a document, for the identity card shown to the user
// (app + web) and to the admin reviewer. `extracted` is the subset we model in
// columns; `allFields` is EVERY field the provider returned, taken from
// `ocrRaw.document_fields`, so the card shows the whole reading — father's
// name, pincode, issuing authority, anything else — not only the handful we
// name.
//
// NOTE (product decision): regulated numbers, including the Aadhaar number, are
// shown here IN FULL. The earlier design masked them so an Aadhaar number never
// reached a browser/app; that masking is intentionally removed for these cards
// per an explicit request. The number is still stored, not newly exposed by us.
// Heuristic for an inline image field in the provider payload (base64 or URL) —
// the face/photo printed on the document.
const IMAGE_KEY = /photo|image|face|signature|photograph/i;
const isImageValue = (key, value) =>
  IMAGE_KEY.test(key) && typeof value === 'string'
  && (value.startsWith('data:') || /^https?:\/\//.test(value) || value.length > 100);

const toDataUrl = (value) => {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('data:') || /^https?:\/\//.test(value)) return value;
  return `data:image/jpeg;base64,${value.replace(/\s+/g, '')}`;
};

// The photo printed on the document, pulled out of the OCR payload so the
// photo-verification view can show it next to the live selfie.
const extractOcrPhoto = (documentFields) => {
  for (const [key, value] of Object.entries(documentFields || {})) {
    if (isImageValue(key, value)) return toDataUrl(value);
  }
  return null;
};

// Flatten a fields object to primitive key/values. `images`:
//   'drop' — omit image blobs entirely (user card, shown as a photo separately)
//   'mark' — replace them with a marker so a text card doesn't dump base64
const flattenFields = (fields, images = 'mark') => {
  const out = {};
  Object.entries(fields || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    if (isImageValue(key, value)) {
      if (images === 'drop') return;
      out[key] = '[image]';
      return;
    }
    out[key] = typeof value === 'object' ? JSON.stringify(value) : value;
  });
  return out;
};

// The FULL provider payload, broken into sections for the admin card: each
// top-level object/array becomes its own section; loose primitives collect
// under "Summary". Image blobs are marked, not dumped (the photo is surfaced
// separately as `photo`).
const buildPayloadSections = (raw) => {
  if (!raw || typeof raw !== 'object') return [];
  const sections = [];
  const summary = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    if (Array.isArray(value)) {
      sections.push({ title: key, fields: flattenFields(Object.fromEntries(value.map((v, i) => [String(i + 1), v]))) });
    } else if (typeof value === 'object') {
      sections.push({ title: key, fields: flattenFields(value) });
    } else {
      summary[key] = value;
    }
  });
  if (Object.keys(summary).length) sections.unshift({ title: 'Summary', fields: summary });
  return sections;
};

// `full: true` (admin) adds the entire sectioned payload; the user view carries
// only the document fields plus the extracted photo.
const buildOcrView = (doc, { full = false } = {}) => {
  if (!doc) return null;
  const raw = doc.ocrRaw || {};
  const documentFields = raw.document_fields || raw.documentFields || {};
  const view = {
    status: doc.ocrStatus || null,
    checkedAt: doc.ocrCheckedAt || null,
    verificationId: doc.ocrVerificationId || null,
    manualConsent: !!doc.manualConsent,
    // The subset we parse into columns (unmasked).
    extracted: doc.ocrFields || {},
    // User card: only the document fields (image blobs dropped, shown as photo).
    allFields: flattenFields(documentFields, 'drop'),
    // The photo printed on the document, if the payload carried one.
    photo: extractOcrPhoto(documentFields),
  };
  if (full) view.payload = buildPayloadSections(raw);
  return view;
};

// Recomputes the name comparison across every document the user has supplied.
// Stored on the row so a reviewer sees WHY something was flagged, rather than
// having to re-derive it.
async function buildNameMatch(user) {
  const { kyc, pan, licence } = await documentStore.getAllForUser(user.id);
  return matchAgainstProfile(displayName(user), {
    licence: licence?.holderName || null,
    aadhaar: kyc?.holderName || null,
    pan: pan?.holderName || null,
  });
}

// Fields the verified DOCUMENTS were matched against. Changing any of them
// invalidates that match, because the approval was made against the old values.
// Email and phone are deliberately absent — neither appears on an Aadhaar card
// or a licence, so editing them proves nothing about identity.
const IDENTITY_FIELDS = [
  'firstName', 'lastName', 'dateOfBirth', 'address', 'city', 'state', 'pincode',
];

// Whole years by calendar. The naive `(now - dob) / 365.25 days` version this
// replaced reports 17 for someone who turned 18 this morning — and disagreed
// with the clients, which already do it properly.
const ageInYears = (dateOfBirth) => {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age;
};

const sameValue = (a, b) => {
  const norm = (v) => (v === null || v === undefined ? '' : String(v).trim().toLowerCase());
  return norm(a) === norm(b);
};

async function saveProfile(userId, body) {
  const user = await User.findByPk(userId);
  if (!user) throw notFound('User not found');

  // A suspended account is the one state that cannot be edited — it is an
  // access decision, and letting someone quietly change their identity details
  // while suspended would defeat it. Every other state is editable; an edit to
  // an approved profile invalidates the approval rather than being refused,
  // which is what makes "edit profile" usable at all.
  if (user.verificationStatus === 'suspended') {
    throw badRequest('This account is suspended. Contact support to change your details.');
  }

  const data = {};
  for (const field of PROFILE_FIELDS) {
    if (body[field] !== undefined) data[field] = body[field];
  }
  if (!Object.keys(data).length) throw badRequest('Nothing to update');

  if (data.firstName !== undefined && !String(data.firstName).trim()) {
    throw badRequest('First name is required');
  }
  if (data.dateOfBirth) {
    const dob = new Date(data.dateOfBirth);
    if (Number.isNaN(dob.getTime())) throw badRequest('Invalid date of birth');
    if (dob > new Date()) throw badRequest('Date of birth cannot be in the future');
    const age = ageInYears(data.dateOfBirth);
    // 18 is the legal minimum to hold a driving licence in India, so anyone
    // younger cannot complete this flow regardless.
    if (age < 18) throw badRequest('You must be at least 18 years old');
    if (age > 120) throw badRequest('Invalid date of birth');
  }

  // Did anything the documents were checked against actually change? Compared
  // against the stored value so re-submitting an unchanged form is not treated
  // as an identity change — otherwise simply opening and saving the edit screen
  // would throw away a good approval.
  const identityChanged = IDENTITY_FIELDS.some(
    (f) => data[f] !== undefined && !sameValue(data[f], user[f]),
  );

  // Editing after a rejection returns the profile to `incomplete` so the stale
  // rejection reason stops being shown as the current state.
  if (user.verificationStatus === 'rejected') {
    data.verificationStatus = 'incomplete';
    // Only the CURRENT reason. `previousRejectionReason` and
    // `previousRejectedAt` deliberately survive — clearing them here is what
    // made a resubmission indistinguishable from a first submission.
    data.verificationRejectionReason = null;
  }

  const invalidating = identityChanged
    && ['pending', 'active'].includes(user.verificationStatus);

  if (invalidating) {
    // Back into the queue. The documents are still on file and still readable,
    // but nobody has checked them against THESE details, so the profile is not
    // active any more and cannot book until it is re-approved.
    data.verificationStatus = 'pending';
    data.verificationSubmittedAt = new Date();
    data.verificationReviewedAt = null;
    data.verificationReviewedByAdminId = null;
    data.verificationRejectionReason = null;
    data.isSearchable = false;
  }

  await user.update(data);

  if (invalidating) {
    // Un-verify the documents themselves. Their `verified` status asserted that
    // a human compared them against the profile — which is no longer true.
    const { kyc, licence } = await documentStore.getAllForUser(userId);
    for (const doc of [kyc, licence]) {
      if (doc && doc.status === 'verified') {
        await doc.update({
          status: 'pending',
          verifiedAt: null,
          reviewedByAdminId: null,
          rejectionReason: null,
        });
      }
    }
  }

  const updated = await User.findByPk(userId);
  await updated.update({ nameMatchResult: await buildNameMatch(updated) });

  const result = (await User.findByPk(userId)).toJSON();
  // The client needs to know the approval was withdrawn, so it can say so
  // rather than silently showing a downgraded badge.
  result.verificationInvalidated = invalidating;
  return result;
}

// What the review screen needs to decide whether the profile can be submitted.
//
// `missingProfile` and `missingDocuments` are kept apart on purpose. The
// onboarding wizard's first step is mandatory and the document steps are
// skippable, so "you cannot submit at all" and "you can submit but it stays
// incomplete" are different answers and the clients need both.
async function readiness(user) {
  const { kyc, licence } = await documentStore.getAllForUser(user.id);

  const missingProfile = [];
  if (!user.firstName) missingProfile.push('First name');
  if (!user.lastName) missingProfile.push('Last name');
  if (!user.dateOfBirth) missingProfile.push('Date of birth');
  if (!user.address) missingProfile.push('Address');
  if (!user.city) missingProfile.push('City');
  if (!user.state) missingProfile.push('State');
  if (!user.pincode) missingProfile.push('PIN code');

  const missingDocuments = [];
  // ── What "ready" measures, and what it deliberately does not ──────────────
  //
  // It measures whether the USER finished their side of onboarding: a number
  // and a scan for each identity document. It does NOT measure whether the
  // automatic checks succeeded.
  //
  // That distinction is the whole point. OCR can fail, the Aadhaar OTP can fail,
  // the provider can be down for a week — none of which is the user's fault, and
  // all of which are exactly what a human reviewer is for. Gating `pending` on a
  // provider verdict left those users stranded at `incomplete`, staring at a
  // finished wizard with nothing left to do and no way to reach anybody. They
  // now land in the queue, flagged, where an admin can look at the scans.
  //
  // This is not a way to self-verify. `pending` means only that somebody will
  // look. Nothing but an explicit admin approval produces `active`, and `active`
  // is the sole state that can book — so the worst a made-up number achieves is
  // wasting a reviewer's time, which is what the review is for.
  if (!licence?.licenceNumber || !licence?.frontImageKey) missingDocuments.push('Driving licence');
  if (!kyc?.documentNumber || !kyc?.imageKey) missingDocuments.push('Aadhaar');

  const nameMatch = await buildNameMatch(user);
  return {
    // Profile complete — the wizard's mandatory step is done.
    profileComplete: missingProfile.length === 0,
    // Everything present — this is what earns `pending` rather than staying
    // `incomplete`.
    ready: missingProfile.length === 0 && missingDocuments.length === 0,
    missingProfile,
    missingDocuments,
    missing: [...missingProfile, ...missingDocuments],
    nameMatch,
    documents: { kyc, licence },
  };
}

async function getStatus(userId) {
  const user = await User.findByPk(userId);
  if (!user) throw notFound('User not found');
  const check = await readiness(user);
  const { kyc, pan, licence } = await documentStore.getAllForUser(userId);

  return {
    verificationStatus: user.verificationStatus,
    suspensionReason: user.suspensionReason,
    suspendedAt: user.suspendedAt,
    rejectionReason: user.verificationRejectionReason,
    // Kept across a resubmission. The clients show the CURRENT reason while the
    // profile is rejected; this is what lets them also say "your last
    // submission was turned down for X" once the user has started fixing it.
    previousRejectionReason: user.previousRejectionReason || null,
    previousRejectedAt: user.previousRejectedAt || null,
    attempts: user.verificationAttempts || 0,
    submittedAt: user.verificationSubmittedAt,
    reviewedAt: user.verificationReviewedAt,
    isSearchable: user.isSearchable,
    canSubmit: check.profileComplete && ['incomplete', 'rejected'].includes(user.verificationStatus),
    // ── The development bypass, told to the client ──
    //
    // Both wizards already call this endpoint, so the flag rides along rather
    // than needing a second request on every screen that cares. The clients use
    // it for ONE thing: not showing an OTP box when no OTP is going to be sent.
    // They never use it to decide whether something is verified — that is the
    // server's answer and stays on the document rows.
    //
    // Absent from an older server's response reads as `undefined`, which is
    // falsy, so a client talking to a server that predates this gets the real
    // flow. That is the correct failure direction.
    providerBypass: await isProviderBypassEnabled(),
    profileComplete: check.profileComplete,
    missing: check.missing,
    missingProfile: check.missingProfile,
    missingDocuments: check.missingDocuments,
    nameMatch: check.nameMatch,
    profile: {
      firstName: user.firstName, lastName: user.lastName,
      dateOfBirth: user.dateOfBirth, address: user.address,
      city: user.city, state: user.state, pincode: user.pincode,
      // Both are needed so the onboarding wizard can prefill itself when it is
      // reopened from the complete-your-profile prompt.
      email: user.email, profilePhoto: user.profilePhoto,
    },
    // Rejection reasons come from the document rows, so a user can see which
    // specific document was turned down and why.
    // Each document carries enough for its capture screen to prefill what was
    // already submitted, so a resubmission doesn't force re-uploading a face
    // that was fine. Numbers are NOT included — the capture screens don't need
    // to display them back, and Aadhaar/PAN are regulated identifiers.
    documents: {
      licence: {
        submitted: !!licence?.licenceNumber, verified: licence?.status === 'verified',
        status: licence?.status || null, rejectionReason: licence?.rejectionReason || null,
        frontImageKey: licence?.frontImageKey || null,
        backImageKey: licence?.backImageKey || null,
        // Readable, unlike Aadhaar/PAN — it is not a regulated identifier and
        // the capture screen prefills it on a resubmission.
        licenceNumber: licence?.licenceNumber || null,
        holderName: licence?.holderName || null,
        expiryDate: licence?.expiryDate || null,
        providerStatus: licence?.providerStatus || null,
        // The same three the Aadhaar block carries, and for the same reason:
        // the wizard uploads the licence before it has a number, so it needs to
        // know how far the step got without inferring it from `submitted`.
        scanned: !!licence?.frontImageKey,
        documentVerified: !!licence?.frontImageKey && licence?.ocrStatus === 'VALID',
        ocrStatus: licence?.ocrStatus || null,
        manualConsent: !!licence?.manualConsent,
        // Everything OCR read off the licence, for the identity card.
        ocr: buildOcrView(licence),
      },
      aadhaar: {
        submitted: !!kyc?.documentNumber, verified: kyc?.status === 'verified',
        status: kyc?.status || null, rejectionReason: kyc?.rejectionReason || null,
        imageKey: kyc?.imageKey || null,
        backImageKey: kyc?.backImageKey || null,
        holderName: kyc?.holderName || null,
        // ── The two ticks the capture screen shows, and they mean different
        // things. Neither is `verified` above: that stays the admin's decision.
        //
        // documentVerified — the scans are in and OCR read the card. Proves the
        // document is legible and genuine-looking, nothing about who holds it.
        documentVerified: !!kyc?.imageKey && kyc?.ocrStatus === 'VALID',
        ocrStatus: kyc?.ocrStatus || null,
        // The scans are stored. Distinct from `submitted` above, which needs a
        // number as well — the wizard uploads the card several steps before the
        // number is confirmed, and needs to know the upload step is done.
        scanned: !!kyc?.imageKey,
        // A number has been settled on, so the OTP has something to prove.
        numberConfirmed: !!kyc?.documentNumber,
        // otpVerified — the holder controls the Aadhaar-linked phone. This is
        // the real proof of identity, which is why `readiness()` still refuses
        // an Aadhaar without it no matter how clean the scan was.
        otpVerified: !!kyc?.referenceId,
        otpVerifiedAt: kyc?.otpVerifiedAt || null,
        // Flags the row for human review — OCR could not read it and the user
        // typed the number instead.
        manualConsent: !!kyc?.manualConsent,
        // The full Aadhaar OCR reading (all fields), for the identity card.
        ocr: buildOcrView(kyc),
      },
      pan: {
        submitted: !!pan?.panNumber, verified: pan?.status === 'verified',
        status: pan?.status || null, rejectionReason: pan?.rejectionReason || null,
        imageKey: pan?.imageKey || null,
        holderName: pan?.holderName || null,
        providerStatus: pan?.providerStatus || null,
        ocr: buildOcrView(pan),
      },
    },
  };
}

// Finishing the onboarding wizard.
//
// The profile step is mandatory, so a missing profile field is a hard 400.
// The licence and Aadhaar steps are skippable, and skipping either leaves the
// profile `incomplete` rather than queueing a submission an admin cannot
// action. Only a complete submission reaches `pending`.
async function submitForReview(userId) {
  const user = await User.findByPk(userId);
  if (!user) throw notFound('User not found');

  if (user.verificationStatus === 'pending') throw badRequest('Your details are already under review');
  if (user.verificationStatus === 'active') throw badRequest('Your profile is already active');
  if (user.verificationStatus === 'suspended') throw badRequest('This account is suspended');

  const check = await readiness(user);
  if (!check.profileComplete) {
    throw badRequest(`Complete these before continuing: ${check.missingProfile.join(', ')}`);
  }

  if (!check.ready) {
    // Documents skipped. Keep the profile editable and keep prompting, but
    // never stamp verificationSubmittedAt — nothing has been submitted.
    await user.update({
      verificationStatus: 'incomplete',
      verificationRejectionReason: null,
      nameMatchResult: check.nameMatch,
    });
    return getStatus(userId);
  }

  await user.update({
    verificationStatus: 'pending',
    verificationSubmittedAt: new Date(),
    verificationRejectionReason: null,
    // Which attempt this is. Incremented here rather than on rejection, so it
    // counts submissions the reviewer actually has to look at.
    verificationAttempts: (user.verificationAttempts || 0) + 1,
    // Recomputed at submission so the reviewer sees the match as it stands
    // now, not as it was when a document was first uploaded.
    nameMatchResult: check.nameMatch,
  });

  return getStatus(userId);
}

// Called after any document write. A user who skipped a step in the wizard and
// comes back later to upload it should not have to find a "submit" button
// again — the moment the submission is complete it goes into the queue by
// itself. Only ever promotes `incomplete` → `pending`; it never touches a
// profile an admin has already decided on.
async function refreshAfterDocument(userId) {
  const user = await User.findByPk(userId);
  if (!user || user.verificationStatus !== 'incomplete') return null;

  const check = await readiness(user);
  if (!check.ready) {
    // Still short of something — just keep the name match current.
    await user.update({ nameMatchResult: check.nameMatch });
    return null;
  }

  await user.update({
    verificationStatus: 'pending',
    verificationSubmittedAt: new Date(),
    verificationRejectionReason: null,
    verificationAttempts: (user.verificationAttempts || 0) + 1,
    nameMatchResult: check.nameMatch,
  });
  return 'pending';
}

// One count per state, plus the total. Shared by the queue's filter chips and
// the admin User Management dashboard, so the two can never disagree.
async function statusCounts() {
  const states = ['incomplete', 'pending', 'active', 'rejected', 'suspended'];
  const counts = {};
  for (const state of states) {
    counts[state] = await User.count({ where: { verificationStatus: state } });
  }
  counts.total = await User.count();
  return counts;
}

// Everything the User Management landing dashboard shows, in one call.
//
// Counted here rather than assembled from several list requests on the client:
// the numbers are meant to agree with each other, and six separate paginated
// reads taken at slightly different moments would not.
async function managementOverview() {
  const counts = await statusCounts();

  // Documents awaiting a decision. `pending` on a document row means submitted
  // but not yet reviewed — a user who never submitted has no row and is
  // correctly not counted, since there is nothing to action.
  const KycDocument = require('../models/kycDocument');
  const DrivingLicence = require('../models/drivingLicence');
  const PanCard = require('../models/panCard');

  const pendingDocs = async (Model) =>
    Model.count({ where: { status: 'pending', isCurrent: true } });

  const [aadhaar, licence, pan] = await Promise.all([
    pendingDocs(KycDocument), pendingDocs(DrivingLicence), pendingDocs(PanCard),
  ]);

  // Signups over the last 30 days — the one trend worth showing next to the
  // queues, since a spike explains a growing pending count.
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const recentSignups = await User.count({ where: { createdAt: { [Op.gte]: since } } });

  return {
    counts,
    documents: { aadhaar, licence, pan, total: aadhaar + licence + pan },
    recentSignups,
  };
}

// ── Admin side ────────────────────────────────────────────────────────────
async function listForReview(params = {}) {
  const offset = Number(params.offset) || 0;
  const limit = Math.min(Number(params.limit) || 20, 100);
  const where = {};

  // Two callers with opposite defaults: the review QUEUE wants only what needs
  // actioning, the customers LIST wants everyone. `status=all` is the list's
  // opt-out; omitting it entirely keeps the queue's behaviour.
  if (params.status === 'all') {
    // no status filter
  } else if (params.status) {
    where.verificationStatus = params.status;
  } else {
    where.verificationStatus = 'pending';
  }

  // The queue orders by how long someone has been waiting; a list of everyone
  // has no submission date for most rows, so it orders by signup instead.
  const order = params.status === 'all'
    ? [['createdAt', 'DESC']]
    : [['verificationSubmittedAt', 'ASC']];

  if (params.search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${params.search}%` } },
      { firstName: { [Op.like]: `%${params.search}%` } },
      { lastName: { [Op.like]: `%${params.search}%` } },
      { email: { [Op.like]: `%${params.search}%` } },
      { contactNumber: { [Op.like]: `%${params.search}%` } },
    ];
  }

  const { count, rows } = await User.findAndCountAll({
    where, offset, limit, order,
    attributes: [
      'id', 'name', 'firstName', 'lastName', 'email', 'contactNumber', 'dateOfBirth',
      'address', 'city', 'state', 'pincode', 'createdAt',
      'verificationStatus', 'verificationRejectionReason', 'verificationSubmittedAt',
      'verificationAttempts', 'previousRejectionReason', 'previousRejectedAt',
      'suspensionReason', 'suspendedAt',
      'isSearchable', 'nameMatchResult',
    ],
  });

  // Aadhaar and PAN are regulated identifiers — same masking rule as the
  // documents screen. The reviewer checks the scan, not the raw number.
  const mask = (v, keep = 4) => (v ? `••••${String(v).slice(-keep)}` : null);

  // Documents live in their own tables now. Fetched per row and flattened back
  // into the shape the admin page already consumes, so the UI needs no change.
  const data = await Promise.all(rows.map(async (u) => {
    const docs = await documentStore.getAllForUser(u.id);
    const flat = documentStore.projectUserDocuments(docs);
    return {
      ...u.toJSON(),
      ...flat,
      kycNumber: mask(flat.kycNumber),
      panNumber: mask(flat.panNumber),
      // Flattened per-document review state, so the KYC & Documents list can
      // render a column per document without each row digging into
      // `documents.*.status` and having to cope with a null row.
      documentStatus: {
        licence: flat.documents.licence?.status || 'missing',
        aadhaar: flat.documents.kyc?.status || 'missing',
        pan: flat.documents.pan?.status || 'missing',
      },
    };
  }));

  const counts = await statusCounts();

  return { data, totalCount: count, counts };
}

// FR-9: approval verifies the profile and makes it searchable. It grants no
// additional application access — the PRD is explicit about that, so nothing
// here touches roles or permissions.
// Becoming ACTIVE is the moment the referral programme turns on for a user:
// their own shareable code is minted and switched on, and — if they signed up
// with somebody else's code — the deferred sign-up reward is released.
//
// THIS IS THE ONLY PLACE REFERRAL POINTS ARE RELEASED, and `approve()` is its
// only caller. Reactivating a suspended account deliberately does NOT call it:
// only an active account can be suspended, so anyone being reactivated was
// approved once already and has been paid. Reactivation restores access; it is
// not a second approval.
//
// It stays a named function rather than inline code because that invariant is
// worth being able to point at. If a third way to reach `active` ever appears,
// the question to answer is whether it is an APPROVAL — if so, call this; if it
// merely restores access to a profile that was approved before, do not.
//
// Idempotent regardless: `ensureReferralCode` returns the existing code and
// `creditSignupRewardOnActivation` no-ops once `signupRewarded` is set.
//
// Deliberately best-effort. A referral hiccup must never block an approval —
// the points are recoverable, the access decision is what the admin came to
// make.
async function releaseReferralOnActivation(userId) {
  try {
    await referralService.ensureReferralCode(userId, { activate: true });
  } catch (err) {
    console.log('[referral] code activation skipped:', err?.message);
  }
  try {
    await referralService.creditSignupRewardOnActivation(userId);
  } catch (err) {
    console.log('[referral] signup reward on activation skipped:', err?.message);
  }
}

async function approve(userId, admin) {
  const user = await User.findByPk(userId);
  if (!user) throw notFound('User not found');
  if (user.verificationStatus === 'active') throw badRequest('This profile is already active');

  // Approval is the LAST step, not a shortcut through the document review.
  //
  // This used to mark every document verified as a side effect, which meant an
  // admin could approve a profile without having looked at a single scan — and
  // the per-document status then claimed a human had checked it. Each document
  // must be verified on its own first; approval only records the overall
  // decision. If something does not match, the admin rejects with a reason
  // instead.
  if (user.verificationStatus !== 'pending') {
    throw badRequest(
      `Only a profile awaiting review can be approved — this one is ${user.verificationStatus}`,
    );
  }

  const { kyc: kycDoc, licence: licenceDoc } = await documentStore.getAllForUser(userId);
  const unverified = [];
  if (!kycDoc) unverified.push('Aadhaar (not submitted)');
  else if (kycDoc.status !== 'verified') unverified.push(`Aadhaar (${kycDoc.status})`);
  if (!licenceDoc) unverified.push('Driving licence (not submitted)');
  else if (licenceDoc.status !== 'verified') unverified.push(`Driving licence (${licenceDoc.status})`);

  if (unverified.length) {
    throw badRequest(
      `Verify every document before approving. Outstanding: ${unverified.join(', ')}`,
    );
  }

  // ── KYC IS A SECOND, DIFFERENT GATE ────────────────────────────────────────
  //
  // Document verification and KYC answer different questions, and a profile
  // needs BOTH before it can go active:
  //
  //   document verification — an admin looked at the scan and it is a real,
  //                           legible Aadhaar whose details match the profile.
  //                           It says nothing about who is holding it.
  //   KYC                   — the person controls the mobile number registered
  //                           against that Aadhaar. That is the identity proof,
  //                           and no amount of looking at a photograph is a
  //                           substitute for it.
  //
  // So a scan can be approved by an admin — genuinely, carefully — for somebody
  // holding a photo of someone else's card. `referenceId` is written ONLY by a
  // successful OTP verification, which is why it is what this checks rather than
  // any status an admin can set.
  //
  // The bypass does not weaken this: a bypassed run still writes referenceId,
  // because with the provider unreachable the alternative is that nothing can be
  // approved at all in a development environment.
  if (!kycDoc.referenceId) {
    throw badRequest(
      'KYC is not verified for this profile. The Aadhaar scan has been reviewed, but the '
      + 'holder has not proved control of the registered mobile number. Run the KYC check '
      + 'before approving.',
    );
  }

  const previous = user.verificationStatus;
  await user.update({
    // Approval makes the profile ACTIVE — that is the state the rest of the
    // app treats as "this person is good to go".
    verificationStatus: 'active',
    isSearchable: true,
    verificationRejectionReason: null,
    verificationReviewedAt: new Date(),
    verificationReviewedByAdminId: admin?.id || null,
  });

  // Nothing to do to the documents — the gate above guarantees they are all
  // already verified. PAN is deliberately not part of this check: it is a
  // payout prerequisite reviewed on its own, not part of the identity check.

  // Every ACTIVE user gets a wallet — their points account, one row per user
  // (unique id, keyed by userId). It is created here rather than lazily on the
  // first credit so a newly approved user with no referral still has an account
  // to view. `createWallet` is idempotent (returns the existing row) and this is
  // best-effort: a wallet hiccup must never block the access decision, exactly
  // like the referral release below.
  try {
    await walletService.createWallet(userId, displayName(user));
  } catch (err) {
    console.log('[wallet] ensure on activation skipped:', err?.message);
  }

  await releaseReferralOnActivation(userId);

  await logActivity({
    adminId: admin?.id, adminName: admin?.name, action: 'approve',
    entityType: 'UserVerification', entityId: userId,
    changes: { verificationStatus: { from: previous, to: 'active' }, isSearchable: { from: user.isSearchable, to: true } },
  });

  return getStatus(userId);
}

// FR-10: rejection requires a reason and leaves the profile non-searchable.
async function reject(userId, reason, admin) {
  const text = String(reason || '').trim();
  if (!text) throw badRequest('A reason is required when rejecting — the user needs to know what to fix');

  const user = await User.findByPk(userId);
  if (!user) throw notFound('User not found');

  // Rejection is available from BOTH sides of the decision.
  //
  //   pending — the ordinary case: this submission is not acceptable.
  //   active  — an approval being withdrawn. Something came to light after the
  //             fact (a forged scan, a mismatch spotted later), and the admin
  //             needs a way to undo their own decision without reaching for
  //             suspension, which is an access ban for misconduct and says
  //             something quite different to the user.
  //
  // The other three states are refused rather than silently accepted:
  // `incomplete` never submitted anything to reject, `rejected` is already
  // there, and `suspended` is a separate lifecycle that reject() would quietly
  // overwrite — losing the suspension reason and letting the account sign in
  // again, which is the opposite of what suspending it meant.
  if (!['pending', 'active'].includes(user.verificationStatus)) {
    throw badRequest(
      `Only a profile awaiting review or already active can be rejected — this one is ${user.verificationStatus}`,
    );
  }

  const previous = user.verificationStatus;
  await user.update({
    verificationStatus: 'rejected',
    isSearchable: false,
    verificationRejectionReason: text,
    // Kept after the user resubmits, unlike the field above which is cleared
    // the moment they edit. This is what lets a reviewer see what the profile
    // was turned down for last time.
    previousRejectionReason: text,
    previousRejectedAt: new Date(),
    verificationReviewedAt: new Date(),
    verificationReviewedByAdminId: admin?.id || null,
  });

  await logActivity({
    adminId: admin?.id, adminName: admin?.name, action: 'reject',
    entityType: 'UserVerification', entityId: userId,
    changes: { verificationStatus: { from: previous, to: 'rejected' }, reason: text },
  });

  return getStatus(userId);
}

// Everything the reviewer needs for one user, on one screen.
async function getForReview(userId) {
  const user = await User.findByPk(userId, {
    attributes: [
      'id', 'name', 'firstName', 'lastName', 'email', 'contactNumber', 'countryCode',
      'dateOfBirth', 'address', 'city', 'state', 'pincode', 'createdAt', 'profilePhoto',
      'verificationStatus', 'verificationRejectionReason', 'verificationSubmittedAt',
      'verificationAttempts', 'previousRejectionReason', 'previousRejectedAt',
      'suspensionReason', 'suspendedAt',
      'verificationReviewedAt', 'isSearchable', 'nameMatchResult',
    ],
  });
  if (!user) throw notFound('User not found');

  const { kyc, pan, licence } = await documentStore.getAllForUser(userId);

  // Regulated identifiers stay masked even here — the reviewer confirms the
  // number from the document image, not from a field they could copy out.
  const mask = (v, keep = 4) => (v ? `••••${String(v).slice(-keep)}` : null);

  // `ocrRaw` is the untouched provider payload. It is deliberately NOT sent to
  // any client: it repeats the full Aadhaar number in plaintext, which would
  // defeat the masking two lines up. It stays in the database for support and
  // debugging, reachable only by someone querying it directly.
  // `ocrFields` is dropped for the same reason as `ocrRaw`: it carries the
  // Aadhaar number OCR read, in plaintext. Everything a reviewer needs from it
  // comes back through the `ocr` summary below, with the number masked.
  const shape = (doc, extra = {}) => {
    if (!doc) return null;
    // `backOcrRaw`/`backOcrFields` are stripped for the same reason as the front
    // pair: the raw provider payload can repeat regulated identifiers in
    // plaintext. Everything the reviewer needs comes back through the masked
    // `ocrBack` summary below.
    const {
      ocrRaw, ocrFields, backOcrRaw, backOcrFields, ...rest
    } = doc.toJSON();
    return {
      ...rest,
      ocrRawStored: !!ocrRaw,
      backOcrRawStored: !!backOcrRaw,
      ...extra,
    };
  };

  // What OCR read, compared against what the user typed and what is on the
  // profile. This is the reviewer's actual job, so it is computed once here
  // rather than re-derived differently on each screen.
  const compare = (a, b) => {
    if (!a || !b) return null;
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  };
  const profileName = displayName(user);

  // Fields the summary names explicitly. Anything outside this set goes into
  // `additional` rather than being dropped.
  const NAMED_OCR_FIELDS = new Set([
    'documentNumber', 'licenceNumber', 'holderName', 'dateOfBirth',
    'issuedDate', 'expiryDate', 'gender', 'address', 'numberMatchesTyped',
  ]);
  // 12 digits, with or without spacing. Deliberately loose: a false positive
  // masks a harmless value, a false negative leaks an Aadhaar number.
  const looksLikeAadhaar = (v) => /^\s*(\d[\s-]?){12}\s*$/.test(String(v));

  const ocrSummary = (doc, typedNumberField, ocrNumberField) => {
    if (!doc) return null;
    const f = doc.ocrFields || {};
    return {
      status: doc.ocrStatus || null,
      checkedAt: doc.ocrCheckedAt || null,
      // Consent is only recorded when OCR could not read the document, so its
      // presence is itself the signal that this one needs human eyes.
      manualConsent: !!doc.manualConsent,
      manualConsentAt: doc.manualConsentAt || null,
      nameMatchesProfile: compare(f.holderName, profileName),
      numberMatchesTyped: f.numberMatchesTyped ?? compare(f[ocrNumberField], doc[typedNumberField]),
      extracted: {
        // Shown in full by product decision (previously masked).
        ...(f.documentNumber ? { documentNumber: f.documentNumber } : {}),
        ...(f.licenceNumber ? { licenceNumber: f.licenceNumber } : {}),
        holderName: f.holderName || null,
        dateOfBirth: f.dateOfBirth || null,
        issuedDate: f.issuedDate || null,
        expiryDate: f.expiryDate || null,
        gender: f.gender || null,
        address: f.address || null,
      },
      // The document fields (image blobs dropped — the photo is surfaced below).
      allFields: flattenFields(doc.ocrRaw?.document_fields || doc.ocrRaw?.documentFields, 'drop'),
      // The ENTIRE provider payload, broken into sections, so the reviewer sees
      // the whole response — not only document_fields — as a card per section.
      payload: buildPayloadSections(doc.ocrRaw),
      // The face/photo the payload carried, for the photo-verification view.
      photo: extractOcrPhoto(doc.ocrRaw?.document_fields || doc.ocrRaw?.documentFields),
      // Everything ELSE the provider returned, so a reviewer sees the whole
      // reading rather than the seven fields this code happens to name.
      //
      // The named list above is a whitelist, and a whitelist silently discards
      // whatever it does not know about — father's name, pincode, the issuing
      // authority. Those are exactly the details that settle a borderline
      // verification, and they were being thrown away before reaching the one
      // person who needed them.
      //
      // Keys are passed through as the provider named them; anything that looks
      // like an Aadhaar number is masked wherever it appears, because the
      // provider repeats it under several names.
      additional: Object.entries(f)
        .filter(([k]) => !NAMED_OCR_FIELDS.has(k))
        .reduce((acc, [k, v]) => {
          if (v === null || v === undefined || v === '') return acc;
          if (typeof v === 'object') return acc; // nested payloads are not readable here
          acc[k] = looksLikeAadhaar(v) ? mask(String(v)) : v;
          return acc;
        }, {}),
    };
  };

  // The BACK of the Aadhaar reads into its own columns, so it gets its own
  // masked summary. There is no number to match on the back — its whole value is
  // the address (and occasionally the name) — so the number/name-match markers
  // are omitted and the address leads.
  const ocrBackSummary = (doc) => {
    if (!doc || !doc.backOcrStatus) return null;
    const f = doc.backOcrFields || {};
    return {
      status: doc.backOcrStatus || null,
      checkedAt: doc.backOcrCheckedAt || null,
      nameMatchesProfile: f.holderName ? compare(f.holderName, profileName) : null,
      extracted: {
        holderName: f.holderName || null,
        address: f.address || null,
      },
      allFields: flattenFields(doc.backOcrRaw?.document_fields || doc.backOcrRaw?.documentFields, 'drop'),
      payload: buildPayloadSections(doc.backOcrRaw),
      photo: extractOcrPhoto(doc.backOcrRaw?.document_fields || doc.backOcrRaw?.documentFields),
      additional: Object.entries(f)
        .filter(([k]) => !NAMED_OCR_FIELDS.has(k))
        .reduce((acc, [k, v]) => {
          if (v === null || v === undefined || v === '') return acc;
          if (typeof v === 'object') return acc;
          acc[k] = looksLikeAadhaar(v) ? mask(String(v)) : v;
          return acc;
        }, {}),
    };
  };

  return {
    user: user.toJSON(),
    nameMatch: await buildNameMatch(user),
    documents: {
      licence: shape(licence, { ocr: ocrSummary(licence, 'licenceNumber', 'licenceNumber') }),
      aadhaar: shape(kyc, {
        // Shown in full by product decision (previously masked).
        documentNumber: kyc?.documentNumber || null,
        ocr: ocrSummary(kyc, 'documentNumber', 'documentNumber'),
        // The address side. Null until the back has been read at least once.
        ocrBack: ocrBackSummary(kyc),
      }),
      pan: shape(pan, { panNumber: pan?.panNumber || null }),
    },
  };
}

// Re-runs the provider check on demand, from the review screen.
//
// The user's submission already triggered one, but a reviewer needs to be able
// to re-run it: the first attempt may have returned UNCHECKED because the
// provider was down, and re-verifying is cheaper than rejecting a good user.
async function recheckDocument(userId, type, admin) {
  if (!['licence', 'pan'].includes(type)) {
    throw badRequest(`Cannot re-check "${type}" — only licence and PAN have a provider lookup`);
  }

  const user = await User.findByPk(userId);
  if (!user) throw notFound('User not found');

  const doc = await documentStore.getCurrent(type, userId);
  if (!doc) throw notFound(`This user has no ${type} on file`);

  const profileName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name;

  if (type === 'licence') {
    const licenceVerification = require('./licenceVerificationService');
    const dob = doc.dateOfBirth || user.dateOfBirth;
    if (!doc.licenceNumber) throw badRequest('No licence number on file to check');
    if (!dob) throw badRequest('A date of birth is required to check a licence');

    const result = await licenceVerification.verifyLicence({
      licenceNumber: doc.licenceNumber,
      dateOfBirth: dob,
      profileName,
    });

    await doc.update({
      providerStatus: result.status || null,
      providerCheckedAt: new Date(),
      // Extracted values win — the document is the source of truth.
      holderName: result.holderName || doc.holderName,
      dateOfBirth: result.dateOfBirth || doc.dateOfBirth,
      issuedDate: result.issuedDate || doc.issuedDate,
      expiryDate: result.expiryDate || doc.expiryDate,
    });

    await logActivity({
      adminId: admin?.id, adminName: admin?.name, action: 'recheck',
      entityType: 'Document:licence', entityId: doc.id,
      changes: { providerStatus: result.status || null, nameMatch: result.nameMatch ?? null },
    });

    return { type, result, document: await documentStore.getCurrent('licence', userId) };
  }

  // PAN
  const { default: axios } = require('axios');
  if (!doc.panNumber) throw badRequest('No PAN on file to check');
  if (!process.env.KYC_URL || !process.env.KYC_ID || !process.env.KYC_SECRET) {
    throw badRequest('PAN verification is not configured on this server');
  }

  let result;
  try {
    const res = await axios.post(`${process.env.KYC_URL}/verification/pan`, {
      pan: doc.panNumber, name: doc.holderName || profileName,
    }, {
      headers: {
        'x-client-id': `${process.env.KYC_ID}`,
        'x-client-secret': `${process.env.KYC_SECRET}`,
      },
      timeout: 15000,
    });
    const provider = res.data || {};
    result = {
      status: provider.status || (String(provider.valid) === 'false' ? 'INVALID' : 'VALID'),
      registeredName: provider.registered_name || null,
    };
  } catch (error) {
    console.error('[pan-recheck] provider call failed:', error.message);
    result = { status: 'UNCHECKED', reason: error.message };
  }

  const patch = { providerStatus: result.status, providerCheckedAt: new Date() };
  if (result.registeredName) {
    patch.providerName = result.registeredName;
    const { compareNames } = require('./nameMatchService');
    const match = compareNames(profileName, result.registeredName);
    patch.nameMatch = match.matched;
    patch.nameMismatchReason = match.matched ? null : match.reason;
  }
  await doc.update(patch);

  await logActivity({
    adminId: admin?.id, adminName: admin?.name, action: 'recheck',
    entityType: 'Document:pan', entityId: doc.id,
    changes: { providerStatus: result.status },
  });

  return { type, result, document: await documentStore.getCurrent('pan', userId) };
}

// Suspend / reactivate. An access decision, NOT a re-review: every document
// and every approval is kept, so reactivating returns the profile straight to
// active rather than back through the queue.
async function setSuspension(userId, suspended, reason, admin) {
  const user = await User.findByPk(userId);
  if (!user) throw notFound('User not found');

  if (suspended) {
    const text = String(reason || '').trim();
    if (!text) throw badRequest('A reason is required when suspending an account');
    if (user.verificationStatus === 'suspended') throw badRequest('This account is already suspended');
    // ONLY an active account can be suspended.
    //
    // Suspension withdraws access that approval granted, so there has to be
    // something to withdraw. Suspending a `pending` or `incomplete` profile
    // took away access it never had, and — because reactivation returns a
    // profile straight to `active` without a re-review — handed it back as
    // full access it had never earned, skipping the queue entirely. That was
    // the actual hole: suspend-then-reactivate was a way to approve somebody
    // without approving them.
    //
    // `rejected` is excluded for the same reason. To block a rejected or
    // pending account, reject it with a reason — that is the state that says
    // "not accepted" and the user is told why.
    if (user.verificationStatus !== 'active') {
      throw badRequest(
        `Only an active account can be suspended — this one is ${user.verificationStatus}. `
        + 'Reject it with a reason instead.',
      );
    }

    await user.update({
      verificationStatus: 'suspended',
      suspensionReason: text,
      suspendedAt: new Date(),
      // Drops them out of platform search for as long as the suspension lasts.
      isSearchable: false,
    });
  } else {
    if (user.verificationStatus !== 'suspended') throw badRequest('This account is not suspended');
    await user.update({
      verificationStatus: 'active',
      suspensionReason: null,
      suspendedAt: null,
      isSearchable: true,
    });

    // NO referral points here, deliberately. Only an active account can be
    // suspended, so anyone reaching this line was approved before — which means
    // their code was minted and their referrer paid at that approval. Paying
    // again on reactivation would either double-credit or, at best, rely on an
    // idempotency flag to do nothing. Reactivation restores access; it is not a
    // second approval and must not behave like one.
  }

  await logActivity({
    adminId: admin?.id, adminName: admin?.name,
    action: suspended ? 'suspend' : 'reactivate',
    entityType: 'UserVerification', entityId: userId,
    changes: { verificationStatus: { to: suspended ? 'suspended' : 'active' },
               reason: suspended ? String(reason || '').trim() : null },
  });

  return getStatus(userId);
}

// Hide or restore an active profile without disturbing its documents.
async function setSearchable(userId, searchable, admin) {
  const user = await User.findByPk(userId);
  if (!user) throw notFound('User not found');
  if (searchable && user.verificationStatus !== 'active') {
    throw badRequest('Only an active profile can be made searchable');
  }

  await user.update({ isSearchable: !!searchable });
  await logActivity({
    adminId: admin?.id, adminName: admin?.name,
    action: searchable ? 'make-searchable' : 'hide-from-search',
    entityType: 'UserVerification', entityId: userId,
    changes: { isSearchable: { from: !searchable, to: !!searchable } },
  });
  return getStatus(userId);
}

// Reports where a per-document decision leaves the PROFILE — and changes
// nothing.
//
// It used to move the profile itself: verifying the last identity document
// flipped it to `active`, rejecting one flipped it to `rejected`. Both are gone.
// A profile becomes active ONLY when an admin presses Approve, and rejected ONLY
// when they press Reject with a reason. Verifying a document says "this scan is
// good"; it does not say "this person may now book", and one click should never
// silently mean the other. It also made the outcome depend on the ORDER
// documents happened to be reviewed in, and let a profile go live without anyone
// ever seeing the decision screen.
//
// The return value tells the admin UI whether the profile is now ready for that
// explicit decision, so it can say so without a second round-trip.
async function profileReviewState(userId) {
  const user = await User.findByPk(userId);
  if (!user) return null;

  const { kyc, licence } = await documentStore.getAllForUser(userId);
  const docState = (doc) => (doc ? doc.status : 'missing');

  return {
    verificationStatus: user.verificationStatus,
    aadhaar: docState(kyc),
    licence: docState(licence),
    // Both identity documents verified and the profile still awaiting a
    // decision — i.e. Approve would now succeed. PAN is deliberately excluded:
    // it is a payout prerequisite reviewed on its own, not part of the identity
    // gate.
    readyToApprove:
      user.verificationStatus === 'pending'
      && kyc?.status === 'verified'
      && licence?.status === 'verified',
  };
}

module.exports = {
  saveProfile, getStatus, submitForReview, setSuspension, refreshAfterDocument, statusCounts, managementOverview,
  listForReview, getForReview, recheckDocument,
  approve, reject, setSearchable, profileReviewState,
  buildNameMatch, readiness,
};
