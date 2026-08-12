// THREE CHAINS, ONE VOCABULARY.
//
// User, host and car each become active by their own route, and none of them
// waits on another:
//
//   USER  aadhaar doc + licence doc + kyc check + photo match  → Approve → active
//   HOST  pan doc + bank account + kyc check                   → verified
//   CAR   photos + rc + physical visit                         → Approve → active
//
// THE INDEPENDENCE IS THE POINT, and it is why this file exists rather than the
// gates being three ad-hoc conditions in three services. They had drifted:
// hosting waited on a driving licence (needed to RIDE, irrelevant to being paid)
// and a car waited on the rider approval of the person listing it. Somebody who
// only wanted to list a car was stuck behind a review of their ability to drive.
//
// The KYC check appears in TWO chains deliberately. It is one identity, checked
// once, and both roles read the same answer — a host who verified as a rider is
// already done and is never asked again.
//
// ── verified / unverified / rejected ───────────────────────────────────────
//
// UNVERIFY IS NOT REJECT, and conflating them is what this replaces. The old
// `setUserDocumentStatus` mapped "not verified" onto a rejection with the filler
// reason "Verification withdrawn by admin", so an admin undoing a mis-click sent
// the user a rejection they then had to act on.
//
//   verified    — this section is good.
//   unverified  — back to `pending`. An admin correcting themselves. The user is
//                 told nothing, because nothing has been decided about them.
//   rejected    — a decision AGAINST, with a mandatory reason the user sees and
//                 is expected to fix.
//
// A section must be able to leave `verified`, or the first mis-click is
// permanent — which in practice means people stop using the buttons.
const User = require('../models/user');
const Host = require('../models/host');
const Vehicle = require('../models/vehicle');
const HostPayoutAccount = require('../models/hostPayoutAccount');
const VehiclePhysicalVerification = require('../models/vehiclePhysicalVerification');
const documentStore = require('./documentStoreService');

const httpError = (message, statusCode, code) =>
  Object.assign(new Error(message), { statusCode, code });
const badRequest = (m, code) => httpError(m, 400, code);
const notFound = (m) => httpError(m, 404);

const DECISIONS = ['verified', 'unverified', 'rejected'];

// `unverified` is the ACTION; `pending` is the state it leaves behind. Keeping
// them distinct in the vocabulary stops a caller sending `pending` and meaning
// something subtly different by it.
const stateFor = (decision) => (decision === 'unverified' ? 'pending' : decision);

// ── Section definitions ────────────────────────────────────────────────────
//
// Each section knows how to read its own status and how to write a decision.
// Anything else in the platform asking "is X verified?" should come through
// here rather than reaching for a column, or the answer starts differing by
// caller — which is the state this replaces.

// A section stored as four columns on a row (status/reason/at/byAdminId).
const columnSection = ({ key, label, status, reason, at, by }) => ({
  key,
  label,
  read: (row) => row?.[status] || 'pending',
  reasonOf: (row) => row?.[reason] || null,
  write: async (row, decision, admin, reasonText) => {
    await row.update({
      [status]: stateFor(decision),
      // A reason belongs to a rejection. Carrying one over to a verify or an
      // unverify would leave a stale sentence attached to a section that is now
      // fine, and it would be shown to the user as though it still applied.
      [reason]: decision === 'rejected' ? reasonText : null,
      [at]: new Date(),
      [by]: admin?.id || null,
    });
  },
});

// A section backed by a document row in the document tables.
const documentSection = ({ key, label, type }) => ({
  key,
  label,
  type,
  read: (ctx) => ctx.documents?.[type]?.status || 'missing',
  reasonOf: (ctx) => ctx.documents?.[type]?.rejectionReason || null,
  write: async (ctx, decision, admin, reasonText) => {
    const doc = ctx.documents?.[type];
    if (!doc) throw badRequest(`This ${label.toLowerCase()} has not been submitted yet`, 'NOT_SUBMITTED');
    await documentStore.review(type, doc.id, { status: stateFor(decision), reason: reasonText }, admin);
  },
});

// ── The KYC section: satisfied by the OTP, or by an admin saying so ────────
//
// TWO WAYS IN, AND BOTH ARE LEGITIMATE.
//
//   the OTP passed        — `kycDocuments.referenceId` is written ONLY by a
//                           successful Aadhaar OTP. That is the strongest proof
//                           of identity the platform can get, and when it exists
//                           this section needs no human at all.
//   an admin verified it  — because the OTP cannot always run. A provider
//                           outage, or `verification.providerBypass` on in a
//                           development environment, leaves a user who has done
//                           everything asked of them with no way to be
//                           verified. Before this, nothing recorded that ops had
//                           satisfied themselves some other way.
//
// A REJECTION OUTRANKS THE OTP. If an admin has actively rejected the KYC — a
// suspected impersonation, a mismatch they can see and the machine cannot — a
// passing OTP must not quietly override that judgement.
const kycCheckSection = {
  key: 'kycCheck',
  label: 'KYC verification',
  read: (ctx) => {
    const user = ctx.user || ctx;
    // AN EXPLICIT ADMIN DECISION WINS OUTRIGHT, and `kycCheckedAt` is how we
    // know one was made — it is stamped on every write, including an unverify.
    //
    // Without this, an unverify would appear to do nothing: the status goes back
    // to `pending`, `read` falls through to the OTP, the OTP has passed, and the
    // section reports `verified` again. The admin presses the button, the row
    // changes, and the screen does not — which reads as a broken button and is
    // the reason nobody trusts them afterwards.
    if (user?.kycCheckedAt) return user.kycCheckStatus || 'pending';
    // No human has touched it, so the OTP answers on its own. This is the
    // ordinary path and it needs no admin at all.
    return ctx.documents?.kyc?.referenceId ? 'verified' : 'pending';
  },
  reasonOf: (ctx) => (ctx.user || ctx)?.kycCheckReason || null,
  // Where the OTP already passed, an admin action is still recorded — it is how
  // a rejection gets expressed, and how an unverify is undone afterwards.
  write: async (ctx, decision, admin, reasonText) => {
    const user = ctx.user || ctx;
    if (!user?.update) throw notFound('User not found for this KYC check');
    await user.update({
      kycCheckStatus: stateFor(decision),
      kycCheckReason: decision === 'rejected' ? reasonText : null,
      kycCheckedAt: new Date(),
      kycCheckedByAdminId: admin?.id || null,
    });
  },
};

const USER_SECTIONS = [
  documentSection({ key: 'aadhaar', label: 'Aadhaar', type: 'kyc' }),
  documentSection({ key: 'licence', label: 'Driving licence', type: 'licence' }),
  kycCheckSection,
  columnSection({
    key: 'photoMatch',
    label: 'Photo / identity match',
    status: 'photoMatchStatus',
    reason: 'photoMatchReason',
    at: 'photoMatchedAt',
    by: 'photoMatchedByAdminId',
  }),
];

const HOST_SECTIONS = [
  documentSection({ key: 'pan', label: 'PAN', type: 'pan' }),
  // Bank lives on hostPayoutAccount, not on the host, because a host replaces
  // accounts over time and the verification belongs to the ACCOUNT — verifying
  // the host would silently bless whichever account came next.
  {
    key: 'bank',
    label: 'Bank account',
    read: (ctx) => {
      if (!ctx.bankAccount) return 'missing';
      return ctx.bankAccount.isVerified ? 'verified' : 'pending';
    },
    reasonOf: () => null,
    write: async (ctx, decision, admin) => {
      if (!ctx.bankAccount) throw badRequest('This host has no active payout account', 'NOT_SUBMITTED');
      await ctx.bankAccount.update({
        isVerified: decision === 'verified',
        // An admin saying yes is not the same fact as a penny-drop against the
        // registry, and settlement needs to be able to tell them apart.
        isManuallyVerified: decision === 'verified',
      });
    },
  },
  // THE SAME OBJECT the user chain uses — not a copy of it.
  //
  // One identity, checked once, read identically by both roles: a host who
  // verified as a rider is already done here and is never asked again. It works
  // unchanged because the section reads `ctx.user`, which both loaders provide.
  kycCheckSection,
];

const VEHICLE_SECTIONS = [
  columnSection({
    key: 'photos',
    label: 'Car photos',
    status: 'photosStatus',
    reason: 'photosReason',
    at: 'photosReviewedAt',
    by: 'photosReviewedByAdminId',
  }),
  {
    key: 'rc',
    label: 'RC',
    read: (ctx) => ctx.rcDocument?.status || 'missing',
    reasonOf: (ctx) => ctx.rcDocument?.rejectionReason || null,
    write: async (ctx, decision, admin, reasonText) => {
      if (!ctx.rcDocument) throw badRequest('This vehicle has no RC on file', 'NOT_SUBMITTED');
      await documentStore.review('rc', ctx.rcDocument.id, { status: stateFor(decision), reason: reasonText }, admin);
    },
  },
  // The in-person visit. Its own model already carries per-item statuses and
  // per-item photographs — see vehiclePhysicalVerification.js. This section is
  // the roll-up: verified only when every item the visit covers is verified,
  // which is what "the fleet manager went and it all checked out" means.
  {
    key: 'physical',
    label: 'Physical verification',
    read: (ctx) => {
      const row = ctx.physicalVerification;
      if (!row) return 'missing';
      const items = VehiclePhysicalVerification.ITEMS;
      if (items.some((i) => row[`${i}Status`] === 'rejected')) return 'rejected';
      return items.every((i) => row[`${i}Status`] === 'verified') ? 'verified' : 'pending';
    },
    reasonOf: (ctx) => {
      const row = ctx.physicalVerification;
      if (!row) return null;
      const failed = VehiclePhysicalVerification.ITEMS
        .filter((i) => row[`${i}Status`] === 'rejected')
        .map((i) => row[`${i}Reason`] || i);
      return failed.length ? failed.join('; ') : null;
    },
    // Deliberately NOT writable as one action. The visit is recorded item by
    // item, each with its own photographs, through the existing physical-check
    // endpoint — a single "mark the visit verified" button would let somebody
    // tick off a site visit they did not make, which is the entire failure mode
    // that step exists to rule out.
    write: async () => {
      throw badRequest(
        'The physical verification is recorded item by item, with photographs, on the vehicle review screen — '
        + 'it cannot be marked verified in one action.',
        'ITEMWISE_ONLY',
      );
    },
  },
];

const REGISTRY = {
  user: { sections: USER_SECTIONS, label: 'user' },
  host: { sections: HOST_SECTIONS, label: 'host' },
  vehicle: { sections: VEHICLE_SECTIONS, label: 'vehicle' },
};

const sectionsFor = (subject) => {
  const entry = REGISTRY[subject];
  if (!entry) throw badRequest(`Unknown verification subject: ${subject}`);
  return entry.sections;
};

const findSection = (subject, key) => {
  const section = sectionsFor(subject).find((s) => s.key === key);
  if (!section) {
    const known = sectionsFor(subject).map((s) => s.key).join(', ');
    throw badRequest(`Unknown ${subject} verification section '${key}'. Known: ${known}`);
  }
  return section;
};

// ── Loading the context each subject's sections read from ──────────────────
//
// One loader per subject so a section never issues its own query — the whole
// set is read once and every section answers from the same snapshot. Two
// sections disagreeing because they read at different moments is the kind of
// bug that only shows up under load.
async function loadUserContext(userId) {
  const user = await User.findByPk(userId);
  if (!user) throw notFound('User not found');
  const documents = await documentStore.getAllForUser(userId);
  // The column sections read the user row directly; the document sections read
  // `documents`. One object carries both.
  return Object.assign(user, { documents, user });
}

async function loadHostContext(hostId) {
  const host = await Host.findByPk(hostId);
  if (!host) throw notFound('Host not found');
  const user = host.userId ? await User.findByPk(host.userId) : null;
  const documents = user ? await documentStore.getAllForUser(user.id) : {};
  const bankAccount = await HostPayoutAccount.findOne({
    where: { hostId: host.id, isActive: true },
  });
  return Object.assign(host, { host, user, documents, bankAccount });
}

async function loadVehicleContext(vehicleId) {
  const vehicle = await Vehicle.findByPk(vehicleId);
  if (!vehicle) throw notFound('Vehicle not found');
  // getCurrent takes (type, ownerId) only — the owner COLUMN is resolved from
  // the type, and rc is keyed by vehicleId.
  const rcDocument = await documentStore.getCurrent('rc', vehicleId);
  const physicalVerification = await VehiclePhysicalVerification.findOne({
    where: { vehicleId },
  });
  return Object.assign(vehicle, { vehicle, rcDocument, physicalVerification });
}

const LOADERS = { user: loadUserContext, host: loadHostContext, vehicle: loadVehicleContext };

async function loadContext(subject, id) {
  const loader = LOADERS[subject];
  if (!loader) throw badRequest(`Unknown verification subject: ${subject}`);
  return loader(id);
}

// ── Reading the whole chain ────────────────────────────────────────────────
//
// `outstanding` is what the ops screen shows and what a refusal quotes back, so
// the reason a gate is closed is always the same sentence in both places.
async function chainState(subject, id, ctx = null) {
  const context = ctx || await loadContext(subject, id);
  const sections = sectionsFor(subject).map((s) => {
    const status = s.read(context);
    return {
      key: s.key,
      label: s.label,
      status,
      reason: s.reasonOf(context) || null,
      // 'missing' means never submitted, and stays distinct from 'pending'
      // (submitted, awaiting a decision) everywhere in this platform: they call
      // for opposite actions — chase the person, or review what they sent.
      satisfied: status === 'verified',
    };
  });
  const outstanding = sections
    .filter((s) => !s.satisfied)
    .map((s) => `${s.label} (${s.status})`);
  return {
    subject,
    id,
    sections,
    outstanding,
    complete: outstanding.length === 0,
  };
}

// The one sentence every gate refuses with.
function assertChainComplete(state, action) {
  if (state.complete) return;
  throw badRequest(
    `${action} needs every verification section complete. Outstanding: ${state.outstanding.join(', ')}`,
    'VERIFICATION_INCOMPLETE',
  );
}

// ── Applying a decision ────────────────────────────────────────────────────
async function applyDecision(subject, id, sectionKey, decision, admin, reasonText) {
  if (!DECISIONS.includes(decision)) {
    throw badRequest(`Unknown decision '${decision}'. Use one of: ${DECISIONS.join(', ')}`);
  }
  // A rejection with no reason is not actionable by the person receiving it,
  // and it is the only decision the user is shown — so it is the only one that
  // demands an explanation.
  const reason = String(reasonText || '').trim();
  if (decision === 'rejected' && !reason) {
    throw badRequest('A reason is required when rejecting — the user is shown it and expected to act on it.');
  }

  const context = await loadContext(subject, id);
  const section = findSection(subject, sectionKey);
  await section.write(context, decision, admin, reason || null);

  // Re-read rather than patching the snapshot in memory: `write` may have
  // created a NEW document row (documentStore.submit demotes and replaces), so
  // the object this function is holding can already be stale.
  const state = await chainState(subject, id);
  return { subject, id, section: sectionKey, decision, ...state };
}

module.exports = {
  DECISIONS,
  sectionsFor,
  loadContext,
  chainState,
  assertChainComplete,
  applyDecision,
  USER_SECTIONS,
  HOST_SECTIONS,
  VEHICLE_SECTIONS,
};
