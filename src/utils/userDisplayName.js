// One way to turn a user row into a name a human can read.
//
// WHY THIS EXISTS. `users.name` is populated only for accounts that arrived
// with a Firebase displayName. The OTP signup flow creates a row with nothing
// but a phone number, and the onboarding wizard then writes `firstName` /
// `lastName` — it never touches `name`. So for every user who signed up the
// normal way, `users.name` is NULL forever.
//
// Every screen that reached for `user.name` therefore rendered its own fallback:
// "Unknown", "Friend", "No name". That is what made a perfectly ordinary
// referred user show up as unknown in the admin panel — the name was there the
// whole time, in the columns nobody was reading.
//
// Order: the onboarded name, then the Firebase one, then email, then the phone
// number. The phone is a last resort but it is what support will actually
// search by, so it beats a placeholder.
// The part of the above that is actually a NAME — no email, no phone number.
//
// `displayName` falls back to contact details so a screen always has something
// to print, which is right for rendering and wrong for STORING. A denormalised
// `name` column filled with a phone number is worse than an empty one: it reads
// as a real value, so nothing ever goes back and fixes it, and every screen
// shows a number where a name belongs. Callers that WRITE a name use this and
// leave the column null when there is genuinely no name yet.
const personName = (user) => {
  if (!user) return null;
  const composed = [user.firstName, user.lastName]
    .filter((part) => part && String(part).trim())
    .join(' ')
    .trim();
  if (composed) return composed;
  if (user.name && String(user.name).trim()) return String(user.name).trim();
  return null;
};

const displayName = (user) => {
  if (!user) return null;
  const named = personName(user);
  if (named) return named;
  if (user.email && String(user.email).trim()) return String(user.email).trim();
  if (user.contactNumber && String(user.contactNumber).trim()) return String(user.contactNumber).trim();
  return null;
};

// Same thing, but never null — for places that render straight into a string.
// `fallback` is deliberately a parameter: "Deleted user" and "Unnamed user" are
// different statements and the caller knows which one is true.
const displayNameOr = (user, fallback = 'Unnamed user') => displayName(user) || fallback;

// The columns `displayName` reads. Pass this to `attributes` so a query cannot
// accidentally select too few and silently fall through to the phone number.
const DISPLAY_NAME_ATTRIBUTES = ['firstName', 'lastName', 'name', 'email', 'contactNumber'];

module.exports = { displayName, displayNameOr, personName, DISPLAY_NAME_ATTRIBUTES };
