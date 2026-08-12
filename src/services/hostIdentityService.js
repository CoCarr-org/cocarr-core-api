// A HOST IS A USER. THE HOST ROW MUST NOT DISAGREE WITH THEM.
//
// `hosts` keeps its own copy of name/email/contactNumber, written once by
// `createHost` from the user row and never touched again. That copy has been
// wrong for essentially every host on the platform, for one reason:
//
//   createHost did `name: userInfo.name`, and `users.name` is NULL for anyone
//   who signed up the normal way. The OTP flow creates a row holding nothing but
//   a phone number, and the onboarding wizard then writes `firstName`/`lastName`
//   and never touches `name` — see utils/userDisplayName.js, which exists
//   because every screen had independently tripped over this.
//
// So the host row was created with a NULL name, and the ops panel rendered its
// fallback: "Unnamed host", about someone who had completed onboarding and whose
// name was sitting in the user row the whole time. The same NULL reaches the
// vehicle screens, damage claims, settlements and bank accounts, which all print
// `host.name` and mostly fall back to `host.user.name` — the same empty column.
//
// TWO HALVES, AND BOTH ARE NEEDED.
//   1. Write it correctly at creation (hostService.createHost).
//   2. Keep it correct afterwards. A name entered or corrected during onboarding
//      lands AFTER the user became a host as often as before, so a create-time
//      copy alone would still be blank for them.
//
// This is (2), and it is called from a hook on User rather than from each write
// path (models/association.js), because there are four places a user's name or
// contact details can change and a fifth will be added by someone who has never
// read this file.
//
// WHY NOT DROP THE COLUMN AND READ THROUGH THE ASSOCIATION. Because `getAllHosts`
// sorts and searches on hosts.name in SQL, across a paginated set — resolving the
// name after the page is selected cannot sort or filter it, and pushing both
// through a join changes the shape of a query that four screens depend on. The
// copy is legitimate denormalisation; it was simply never maintained.
const Host = require('../models/host');
const { personName } = require('../utils/userDisplayName');

// The user columns whose value the host row mirrors. A change to any of them is
// what makes a sync worth doing; anything else on the user is irrelevant here.
const MIRRORED_USER_FIELDS = ['firstName', 'lastName', 'name', 'email', 'contactNumber', 'countryCode'];

// `personName`, not `displayName`: displayName falls back to email and then the
// phone number, which is right for a screen and wrong for a stored column —
// see utils/userDisplayName.js. A user with no name yet leaves host.name NULL,
// and the ops panel's "Unnamed host" is then a true statement.
const hostPatchFor = (user, host) => {
  const patch = {};
  const name = personName(user);

  // Only ever fills in or corrects. A null from the user never blanks a value
  // the host row already holds — a host who typed their details into the
  // become-a-host form before the wizard existed still has them there, and
  // overwriting that with an empty user field would destroy the better data.
  if (name && name !== host.name) patch.name = name;
  for (const field of ['email', 'contactNumber', 'countryCode']) {
    const value = user[field];
    if (value && value !== host[field]) patch[field] = value;
  }
  return patch;
};

// Returns the fields it changed, or null when there was nothing to do (which is
// the common case — most user updates touch neither the name nor the contact
// details, and most hosts are already in step).
//
// NEVER THROWS. This is a follow-on write: a failure here must not take down the
// profile save or the onboarding step that triggered it. The user's own row is
// the source of truth and is already committed by the time this runs, so the
// worst case is a host row that stays stale until the next edit or the backfill.
async function syncHostIdentity(user, { log = console } = {}) {
  try {
    if (!user?.id) return null;
    const host = await Host.findOne({ where: { userId: user.id } });
    if (!host) return null; // not a host — the overwhelmingly common case

    const patch = hostPatchFor(user, host);
    if (!Object.keys(patch).length) return null;

    await host.update(patch);
    return Object.keys(patch);
  } catch (error) {
    log.error?.(`[host-identity] could not sync host row for user ${user?.id}: ${error.message}`);
    return null;
  }
}

module.exports = { syncHostIdentity, hostPatchFor, MIRRORED_USER_FIELDS };
