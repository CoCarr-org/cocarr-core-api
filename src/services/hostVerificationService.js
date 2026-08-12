// HOST VERIFICATION — A CHAIN THAT DID NOT EXIST.
//
// Being a host was never reviewed. `hosts` carried an `isActive` boolean that
// defaults to true and nothing set it, so a host row appeared the moment someone
// listed their first car and was, as far as the platform was concerned, fine.
// Whether they could actually be PAID was decided implicitly and in pieces:
// settlement resolved a bank account, the vehicle gate happened to check the
// PAN, and nobody could answer "is this host verified?" in one place.
//
// A host is verified on three things and nothing else:
//
//   PAN   — the tax identity we need in order to pay them at all.
//   bank  — an account, verified against the registry or by an admin.
//   KYC   — who they are. THE SAME check the rider chain reads, so a host who
//           verified as a rider is already done and is never asked twice.
//
// IT DOES NOT DEPEND ON THE RIDER APPROVAL OF THE SAME PERSON, and that is the
// substance of the change. A driving licence is what lets you BOOK a car; it has
// nothing to do with being paid for lending one out. Hosts were sitting behind a
// review of their ability to drive.
//
// Nor does it depend on their cars. A host is verified or not on their own
// merits; a car has its own chain (vehicleReviewService).
const Host = require('../models/host');
const User = require('../models/user');
const { logActivity } = require('./activityLogService');
const verificationSections = require('./verificationSections');
const { displayNameOr } = require('../utils/userDisplayName');

const httpError = (message, statusCode, code) =>
  Object.assign(new Error(message), { statusCode, code });
const badRequest = (m, code) => httpError(m, 400, code);
const notFound = (m) => httpError(m, 404);

// Everything the ops host screen needs to render the chain and decide whether
// Verify can be pressed. Deliberately the same shape the user and vehicle
// screens get, so one component can render any of the three.
async function getReviewState(hostId) {
  const host = await Host.findByPk(hostId);
  if (!host) throw notFound('Host not found');
  const chain = await verificationSections.chainState('host', hostId);
  return {
    hostId,
    // The stored outcome, which is NOT the same as `chain.complete`: a host can
    // have all three parts green and not yet have been verified by anybody, and
    // an admin can withdraw a verification while the parts stay green. The
    // screen needs both — one is "may I press the button", the other is "what is
    // this host right now".
    verificationStatus: host.verificationStatus,
    verificationReason: host.verificationReason || null,
    verificationReviewedAt: host.verificationReviewedAt || null,
    readyToVerify: chain.complete && host.verificationStatus !== 'verified',
    ...chain,
  };
}

// Records a decision on ONE section of the host chain (pan | bank | kycCheck).
// The section keys and the verified/unverified/rejected vocabulary are shared
// with the other two chains — see verificationSections.js.
async function reviewSection(hostId, sectionKey, decision, admin, reason) {
  const result = await verificationSections.applyDecision('host', hostId, sectionKey, decision, admin, reason);

  await logActivity({
    adminId: admin?.id,
    adminName: admin?.name,
    action: decision,
    entityType: `HostVerification:${sectionKey}`,
    entityId: hostId,
    changes: { decision, reason: reason || null },
  });

  // Reports where this leaves the host WITHOUT moving them. A section decision
  // is about that section; the host's own status only ever changes through an
  // explicit verify or unverify below. The same rule the user chain follows, and
  // for the same reason: verifying a PAN says the PAN is good, not "this host
  // may now be paid", and one click must never silently mean the other.
  const host = await Host.findByPk(hostId);
  return {
    ...result,
    verificationStatus: host?.verificationStatus || null,
    readyToVerify: result.complete && host?.verificationStatus !== 'verified',
  };
}

// The host-level decision. Refuses unless all three parts are verified, naming
// what is outstanding — the same sentence the screen shows, so a refusal never
// tells somebody something they could not already see.
async function verify(hostId, admin) {
  const host = await Host.findByPk(hostId);
  if (!host) throw notFound('Host not found');
  if (host.verificationStatus === 'verified') throw badRequest('This host is already verified');

  const chain = await verificationSections.chainState('host', hostId);
  verificationSections.assertChainComplete(chain, 'Verifying a host');

  const previous = host.verificationStatus;
  await host.update({
    verificationStatus: 'verified',
    verificationReason: null,
    verificationReviewedAt: new Date(),
    verificationReviewedByAdminId: admin?.id || null,
  });

  const user = host.userId ? await User.findByPk(host.userId) : null;
  await logActivity({
    adminId: admin?.id,
    adminName: admin?.name,
    action: 'verified',
    entityType: 'Host',
    entityId: hostId,
    changes: {
      verificationStatus: { from: previous, to: 'verified' },
      host: displayNameOr(user, 'Unnamed host'),
    },
  });

  return getReviewState(hostId);
}

// WITHDRAWING A VERIFICATION IS NOT A REJECTION, exactly as at section level.
//
//   unverify — back to `pending`. Used when something needs looking at again, or
//              when the verification was pressed by mistake. No reason is shown
//              to the host because nothing has been decided against them.
//   reject   — a decision against, with a mandatory reason. The host is expected
//              to fix something.
//
// Both stop payouts, which is the point; they say very different things to the
// person on the other end.
async function setVerification(hostId, decision, admin, reason) {
  if (decision === 'verified') return verify(hostId, admin);

  if (!['unverified', 'rejected'].includes(decision)) {
    throw badRequest(`Unknown host decision '${decision}'. Use verified, unverified or rejected.`);
  }
  const text = String(reason || '').trim();
  if (decision === 'rejected' && !text) {
    throw badRequest('A reason is required when rejecting a host — they are shown it and expected to act on it.');
  }

  const host = await Host.findByPk(hostId);
  if (!host) throw notFound('Host not found');

  const previous = host.verificationStatus;
  await host.update({
    verificationStatus: decision === 'rejected' ? 'rejected' : 'pending',
    verificationReason: decision === 'rejected' ? text : null,
    verificationReviewedAt: new Date(),
    verificationReviewedByAdminId: admin?.id || null,
  });

  await logActivity({
    adminId: admin?.id,
    adminName: admin?.name,
    action: decision,
    entityType: 'Host',
    entityId: hostId,
    changes: {
      verificationStatus: { from: previous, to: decision === 'rejected' ? 'rejected' : 'pending' },
      reason: text || null,
    },
  });

  return getReviewState(hostId);
}

// For settlement and anything else that needs the one-line answer. Kept as a
// named function so the invariant can be pointed at rather than re-derived from
// a column read in five places.
async function isHostVerified(hostId) {
  const host = await Host.findByPk(hostId);
  return host?.verificationStatus === 'verified';
}

module.exports = { getReviewState, reviewSection, verify, setVerification, isHostVerified };
