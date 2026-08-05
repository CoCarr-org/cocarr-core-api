const { default: axios } = require('axios');
const { CustomError } = require('../middlewares/error');
const { getSignature } = require('../utils/signature');
const { compareNames } = require('./nameMatchService');

// Driving licence verification / extraction (PRD Signup FR-3: "Upload driving
// license and extract relevant details").
//
// Uses the same Cashfree account as RC, Aadhaar and bank verification, with the
// same 2FA header convention — see the notes in hostService. Endpoints are
// configurable because Cashfree's paths differ between products and sandbox:
//   KYC_BASE                e.g. https://sandbox.cashfree.com
//   KYC_LICENCE_VERIFY      default /verification/driving-licence
const kycBase = () => String(process.env.KYC_BASE || process.env.KYC_URL || '').replace(/\/+$/, '');
const licenceUrl = () => `${kycBase()}${process.env.KYC_LICENCE_VERIFY || '/verification/driving-licence'}`;

const KYC_API_VERSION = process.env.KYC_API_VERSION || '2024-12-01';

const kycHeaders = () => {
  const headers = {
    'x-client-id': `${process.env.KYC_ID}`,
    'x-client-secret': `${process.env.KYC_SECRET}`,
    'x-api-version': KYC_API_VERSION,
  };
  const signature = getSignature();
  if (signature) headers['x-cf-signature'] = signature;
  return headers;
};

const isConfigured = () => !!(kycBase() && process.env.KYC_ID && process.env.KYC_SECRET);

// Indian licence numbers vary by state but are consistently 15-16 alphanumeric
// characters, often written with spaces or hyphens. Normalise before sending.
const normaliseLicence = (value) => String(value || '').toUpperCase().replace(/[\s-]/g, '');

const LICENCE_RE = /^[A-Z]{2}[0-9]{2}[0-9A-Z]{10,12}$/;

// Cashfree returns dates as DD-MM-YYYY or DD/MM/YYYY; Sequelize DATEONLY wants
// YYYY-MM-DD. Returning null rather than an Invalid Date keeps a bad parse from
// silently becoming 1970.
const toIsoDate = (value) => {
  if (!value) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

// Verifies a licence and extracts its details.
//
// The provider needs the licence number AND date of birth — DOB is the second
// factor that proves the submitter holds the licence rather than merely knowing
// its number, so it is required rather than optional.
//
// NEVER throws on a provider failure: the result is advisory, and verification
// is the admin's decision. Callers get `{ status: 'UNCHECKED' }` and the
// submission proceeds to manual review.
async function verifyLicence({ licenceNumber, dateOfBirth, profileName }) {
  const number = normaliseLicence(licenceNumber);
  if (!number) throw new CustomError('Licence number is required', 400);
  if (!LICENCE_RE.test(number)) {
    throw new CustomError('That does not look like a valid licence number', 400);
  }
  if (!dateOfBirth) {
    throw new CustomError('Date of birth is required to verify a licence', 400);
  }

  if (!isConfigured()) {
    return { status: 'UNCHECKED', reason: 'Licence verification is not configured', licenceNumber: number };
  }

  let data;
  try {
    const res = await axios.post(licenceUrl(), {
      licence_number: number,
      // Cashfree expects the DOB the licence was issued against.
      date_of_birth: String(dateOfBirth).slice(0, 10),
    }, { headers: kycHeaders(), timeout: 20000 });
    data = res.data || {};
  } catch (error) {
    const payload = error?.response?.data || {};
    const type = payload.type || '';
    const code = payload.code || '';

    // Auth/IP problems are OUR misconfiguration, not the user's licence being
    // wrong — the same distinction the RC path makes.
    if (code === 'ip_validation_failed' || type === 'authentication_error') {
      console.error('[KYC CONFIG] Cashfree rejected the licence request:', payload.message || code,
        '\n  → Whitelist this server\'s outbound IP, or enable 2FA + signature.');
    } else {
      console.error('[licence-verify] provider call failed:', payload.message || error.message);
    }
    return { status: 'UNCHECKED', reason: payload.message || 'Provider unreachable', licenceNumber: number };
  }

  // Field names differ across Cashfree versions; accept the common variants
  // rather than silently extracting nothing.
  const holderName = data.name || data.holder_name || data.applicant_name || null;
  const extracted = {
    licenceNumber: number,
    holderName,
    dateOfBirth: toIsoDate(data.dob || data.date_of_birth),
    issuedDate: toIsoDate(data.doi || data.issue_date || data.date_of_issue),
    expiryDate: toIsoDate(data.doe || data.expiry_date || data.valid_upto || data.date_of_expiry),
    status: data.status || (data.valid === false ? 'INVALID' : 'VALID'),
    raw: data,
  };

  // Expiry is worth surfacing even when the provider calls the licence valid —
  // an expired licence should not let someone book a car.
  if (extracted.expiryDate) {
    extracted.expired = new Date(extracted.expiryDate) < new Date();
  }

  // FR-5 name matching, so a mismatch is visible to the reviewer immediately
  // rather than being discovered later.
  if (profileName && holderName) {
    const match = compareNames(profileName, holderName);
    extracted.nameMatch = match.matched;
    extracted.nameMatchReason = match.reason;
  }

  return extracted;
}

module.exports = { verifyLicence, isConfigured, normaliseLicence, toIsoDate };
