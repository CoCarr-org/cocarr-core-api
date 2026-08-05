// Name matching for identity verification.
//
// Two PRDs depend on this and they must agree, so the rule lives in one place:
//   - Signup & KYC   FR-5: profile name vs driving licence vs Aadhaar
//   - Bank & PAN     FR-6: profile name vs bank account holder vs PAN holder
//
// THE RULE (from the Signup PRD, applied to every pair):
//   First name must match EXACTLY.
//   If the last name differs, compare only its first character — if that
//   matches, accept.
//
// The last-name allowance exists because official documents abbreviate
// surnames constantly (initials, expansions, dropped middle names). The first
// name deliberately has no such allowance.

// Documents arrive with punctuation, honorifics, double spaces and mixed case.
// Normalising is what makes "Dr. RAJESH  KUMAR." and "Rajesh Kumar" comparable
// without loosening the rule itself.
const HONORIFICS = ['mr', 'mrs', 'ms', 'miss', 'dr', 'shri', 'smt', 'sri', 'md'];

const normalise = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z\s]/g, ' ')   // drop dots, hyphens, digits
  .replace(/\s+/g, ' ')
  .trim();

const tokenise = (value) => {
  const parts = normalise(value).split(' ').filter(Boolean);
  // Only strip a leading honorific — "Mr" as an actual first token, never a
  // surname that happens to look like one.
  if (parts.length > 1 && HONORIFICS.includes(parts[0])) parts.shift();
  return parts;
};

// Splits a single full-name string into first / last, keeping the middle
// tokens because surname comparison needs them (see below).
const splitName = (fullName) => {
  const parts = tokenise(fullName);
  if (!parts.length) return { first: '', last: '', rest: [] };
  if (parts.length === 1) return { first: parts[0], last: '', rest: [] };
  return {
    first: parts[0],
    last: parts[parts.length - 1],
    // Everything after the first name — used to recognise a surname that has
    // been pushed out of last position by an extra name.
    rest: parts.slice(1),
  };
};

// Compares two names under the rule above.
// `{ matched, reason, firstName: {...}, lastName: {...} }`
function compareNames(nameA, nameB) {
  const a = splitName(nameA);
  const b = splitName(nameB);

  if (!a.first || !b.first) {
    return {
      matched: false,
      reason: 'One of the names is missing or unreadable',
      firstName: { a: a.first, b: b.first, matched: false },
      lastName: { a: a.last, b: b.last, matched: false },
    };
  }

  const firstMatched = a.first === b.first;

  // A missing surname on either side cannot be compared. Treated as matching
  // rather than failing: many documents carry a single-word name, and failing
  // those would reject legitimate users on a technicality the rule never
  // intended to cover.
  let lastMatched;
  let lastReason;
  if (!a.last || !b.last) {
    lastMatched = true;
    lastReason = 'Last name absent on one side — not compared';
  } else if (a.last === b.last) {
    lastMatched = true;
    lastReason = 'Exact match';
  } else if (a.rest.includes(b.last) || b.rest.includes(a.last)) {
    // "Rajesh Kumar" vs "Rajesh Kumar Singh" — the surname is present but no
    // longer in last position because the document carries an extra name.
    // Extremely common on Indian identity documents, and a strict last-token
    // comparison would reject the same person. NOTE: this is an
    // interpretation; the PRD does not address multi-token names.
    lastMatched = true;
    lastReason = 'Surname present, displaced by an additional name';
  } else if (a.last[0] === b.last[0]) {
    // The PRD's explicit allowance: differing surnames pass on first initial.
    lastMatched = true;
    lastReason = 'Differs, but first character matches';
  } else {
    lastMatched = false;
    lastReason = 'Differs, and first character does not match';
  }

  const matched = firstMatched && lastMatched;
  return {
    matched,
    reason: matched
      ? 'Names match'
      : !firstMatched
        ? 'First name does not match exactly'
        : 'Last name does not match',
    firstName: { a: a.first, b: b.first, matched: firstMatched },
    lastName: { a: a.last, b: b.last, matched: lastMatched, reason: lastReason },
  };
}

// Compares a profile name against every document name supplied.
// `sources` is `{ licence: 'x', aadhaar: 'y', bank: 'z', pan: 'w' }` — absent
// or empty entries are skipped rather than counted as failures, so this works
// mid-onboarding when only some documents are in.
function matchAgainstProfile(profileName, sources = {}) {
  const comparisons = {};
  const mismatches = [];

  for (const [key, value] of Object.entries(sources)) {
    if (!value || !String(value).trim()) continue;
    const result = compareNames(profileName, value);
    comparisons[key] = result;
    if (!result.matched) mismatches.push(key);
  }

  const compared = Object.keys(comparisons);
  return {
    matched: compared.length > 0 && mismatches.length === 0,
    compared,
    mismatches,
    comparisons,
    checkedAt: new Date().toISOString(),
    summary: !compared.length
      ? 'No document names available to compare'
      : mismatches.length
        ? `Name mismatch against: ${mismatches.join(', ')}`
        : 'All supplied names match the profile',
  };
}

module.exports = { compareNames, matchAgainstProfile, splitName, normalise };
