const FormData = require('form-data');
const { kycHttp } = require('../utils/kycHttp');
const { getSignature } = require('../utils/signature');

// Document OCR via Cashfree's bharat-ocr endpoint.
//
// The same endpoint and credentials already power vehicle-RC scanning in
// hostService; this module exists so Aadhaar and driving-licence capture do not
// each grow their own copy of the request plumbing. There are three document
// verification touchpoints in the product — Aadhaar + licence during user
// onboarding, and PAN + bank details during host onboarding — and only the
// first two go through here.
//
// The contract every caller depends on:
//
//   NEVER THROWS ON A PROVIDER PROBLEM. A timeout, an auth failure, an
//   unreadable photo — all come back as a result object with a status. The
//   caller decides what to do, which is what lets the app fall back to asking
//   the user's consent for manual verification instead of dead-ending them on
//   an outage that is our fault, not theirs.
//
// Only a genuinely malformed request throws.

const KYC_API_VERSION = process.env.KYC_API_VERSION || '2024-12-01';

// Cashfree's `document_type` values.
//
// ── Why this is a list and not a constant ──
// `DRIVING_LICENSE` was a reasonable guess by analogy with the working
// `VEHICLE_RC` call in hostService, and it is wrong — the provider answers
// `document_type_invalid`. Their published docs are not reachable
// programmatically, so the correct token cannot be confirmed from here, and
// guessing a second time would just move the failure.
//
// So each kind carries CANDIDATES, tried in order, and only when the provider
// specifically says the type is invalid. The one that works is remembered for
// the life of the process and logged, so it can be pinned properly afterwards.
// Worst case this costs one extra failed request per kind per boot; the
// alternative is a silent feature outage until somebody reads the log.
//
// An env override wins outright — set it the moment the right value is known
// and no candidate probing happens at all:
//   KYC_OCR_TYPE_AADHAAR, KYC_OCR_TYPE_LICENCE
const DOCUMENT_TYPE_CANDIDATES = {
  // No failure reported for Aadhaar, so the known-good value leads.
  aadhaar: ['AADHAAR', 'AADHAAR_CARD', 'AADHAR'],
  // British spelling first: Cashfree's own product pages call it a "Driving
  // Licence", and `DRIVING_LICENSE` is the value already known to be rejected.
  licence: ['DRIVING_LICENCE', 'DL', 'DRIVING_LICENSE'],
};

const ENV_OVERRIDE = {
  aadhaar: 'KYC_OCR_TYPE_AADHAAR',
  licence: 'KYC_OCR_TYPE_LICENCE',
};

// Remembers the value the provider accepted, per kind, for this process.
const acceptedType = {};

const typeCandidates = (kind) => {
  const override = process.env[ENV_OVERRIDE[kind]];
  if (override) return [override];
  if (acceptedType[kind]) return [acceptedType[kind]];
  return DOCUMENT_TYPE_CANDIDATES[kind] || [];
};

// Kept for callers that only need to know a kind is supported.
const DOCUMENT_TYPES = Object.fromEntries(
  Object.entries(DOCUMENT_TYPE_CANDIDATES).map(([k, v]) => [k, v[0]]),
);

const isPlaceholderUrl = (url) =>
  !url || /example\.(com|org|net)|localhost|changeme|your-/i.test(url);

const kycBase = () => String(process.env.KYC_BASE || process.env.KYC_URL || '').replace(/\/+$/, '');
const ocrUrl = () => `${kycBase()}${process.env.KYC_RC_OCR || '/verification/bharat-ocr'}`;

const isConfigured = () =>
  !isPlaceholderUrl(kycBase()) && !!(process.env.KYC_ID && process.env.KYC_SECRET);

// Cashfree 2FA: the signature is a SECOND factor alongside the client secret,
// not a replacement — sending it alone returns `x-client-secret_missing`.
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

const verificationId = () =>
  `ocr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ── Field extraction ───────────────────────────────────────────────────────
// Cashfree's field names vary by document and have changed between API
// versions, so each value is looked up across the plausible keys rather than
// pinned to one. An unrecognised shape yields nulls, which surface in the admin
// UI as "not read" — never as a wrong value silently presented as right.
const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
};

// Cashfree returns dates in several formats. Normalised to YYYY-MM-DD so the
// column type accepts them and comparisons work.
const toIsoDate = (value) => {
  if (!value) return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/); // DD/MM/YYYY or DD-MM-YYYY
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

const extractAadhaar = (f) => ({
  documentNumber: pick(f, 'aadhaar_number', 'uid', 'id_number', 'document_number'),
  holderName: pick(f, 'name', 'name_on_card', 'full_name'),
  dateOfBirth: toIsoDate(pick(f, 'dob', 'date_of_birth', 'yob', 'year_of_birth')),
  gender: pick(f, 'gender', 'sex'),
  address: pick(f, 'address', 'full_address'),
});

const extractLicence = (f) => ({
  licenceNumber: pick(f, 'dl_number', 'license_number', 'licence_number', 'id_number', 'document_number'),
  holderName: pick(f, 'name', 'name_on_card', 'full_name'),
  dateOfBirth: toIsoDate(pick(f, 'dob', 'date_of_birth')),
  issuedDate: toIsoDate(pick(f, 'issue_date', 'date_of_issue', 'doi')),
  expiryDate: toIsoDate(pick(f, 'expiry_date', 'valid_till', 'date_of_expiry', 'doe')),
  address: pick(f, 'address', 'full_address'),
});

const EXTRACTORS = { aadhaar: extractAadhaar, licence: extractLicence };

/**
 * Runs one document image through OCR.
 *
 * @param {'aadhaar'|'licence'} kind
 * @param {Buffer} fileBuffer
 * @param {string} mimeType
 * @returns {Promise<{status, fields, raw, verificationId, message}>}
 *
 * status is one of:
 *   VALID     — read successfully; `fields` holds the extracted values
 *   INVALID   — the provider read it and says it is not that document
 *   UNCHECKED — provider unreachable / misconfigured. OUR problem, not the
 *               user's, and the reason the consent fallback exists.
 *   FAILED    — provider responded but nothing usable came back
 */
async function runOcr(kind, fileBuffer, mimeType) {
  const candidates = typeCandidates(kind);
  if (!candidates.length) throw Object.assign(new Error(`Unknown OCR document kind: ${kind}`), { statusCode: 400 });
  if (!fileBuffer || !fileBuffer.length) {
    throw Object.assign(new Error('Document image is required'), { statusCode: 400 });
  }

  const id = verificationId();

  if (!isConfigured()) {
    // Not an error the user can act on — do not make it look like one.
    console.error('[ocr] Cashfree is not configured (KYC_BASE/KYC_ID/KYC_SECRET).');
    return {
      status: 'UNCHECKED', fields: {}, raw: null, verificationId: id,
      message: 'Automatic verification is unavailable right now.',
    };
  }

  // The form has to be rebuilt per attempt: a FormData stream can only be sent
  // once, so reusing it across candidates would send an empty body.
  const buildForm = (documentType) => {
    const form = new FormData();
    form.append('document_type', documentType);
    form.append('verification_id', id);
    form.append('file', fileBuffer, {
      filename: `${kind}-${Date.now()}.jpg`,
      contentType: mimeType || 'image/jpeg',
    });
    return form;
  };

  let data;
  try {
    for (let i = 0; i < candidates.length; i += 1) {
      const documentType = candidates[i];
      const form = buildForm(documentType);
      try {
        const res = await kycHttp.post(ocrUrl(), form, {
          headers: { ...kycHeaders(), ...form.getHeaders() },
          maxBodyLength: Infinity,
        });
        data = res.data;
        // Remember it, so later calls in this process go straight there.
        if (acceptedType[kind] !== documentType) {
          acceptedType[kind] = documentType;
          if (i > 0) {
            console.warn(
              `[ocr] ${kind}: document_type "${documentType}" was accepted after `
              + `"${candidates.slice(0, i).join('", "')}" was rejected. `
              + `Pin it with ${ENV_OVERRIDE[kind]}=${documentType} to skip the retry.`,
            );
          }
        }
        break;
      } catch (error) {
        const body = error?.response?.data || {};
        // ONLY an invalid-type verdict is worth another attempt. Any other
        // failure — auth, IP, an unreadable image — means the type was fine and
        // retrying with a different one would just repeat the real error under
        // a misleading label.
        if (body.code === 'document_type_invalid' && i < candidates.length - 1) continue;
        throw error;
      }
    }
  } catch (error) {
    const body = error?.response?.data || {};
    const code = body.code || '';
    const type = body.type || '';

    // Every candidate was rejected. That is our configuration to fix, not the
    // user's document, so it is logged as such and reported as an outage.
    if (code === 'document_type_invalid') {
      console.error(
        `[ocr CONFIG] Cashfree rejected every document_type tried for ${kind}: `
        + `"${candidates.join('", "')}". Check the provider's allowed values and set `
        + `${ENV_OVERRIDE[kind]} to the correct one.`,
      );
      return {
        status: 'UNCHECKED', fields: {}, raw: body, verificationId: id,
        message: 'Automatic verification is temporarily unavailable.',
      };
    }

    // An auth or IP rejection is a server misconfiguration. Logged loudly as
    // ours, and reported to the user as a temporary outage — never as "your
    // document is wrong".
    if (code === 'ip_validation_failed' || type === 'authentication_error') {
      console.error('[ocr CONFIG] Cashfree rejected this request:', body.message || code,
        '\n  → Whitelist the outbound IP, or enable 2FA and supply the account public key.');
      return {
        status: 'UNCHECKED', fields: {}, raw: body, verificationId: id,
        message: 'Automatic verification is temporarily unavailable.',
      };
    }

    console.error(`[ocr] ${kind} failed:`, body || error.message);
    return {
      status: 'UNCHECKED', fields: {}, raw: body || null, verificationId: id,
      message: 'We could not reach the verification service.',
    };
  }

  const providerStatus = String(data?.status || '').toUpperCase();
  const documentFields = data?.document_fields || {};
  const fields = EXTRACTORS[kind](documentFields);

  // The provider read something but says it is not this document type.
  if (providerStatus && providerStatus !== 'VALID') {
    return {
      status: 'INVALID', fields, raw: data, verificationId: id,
      message: `That does not look like a valid ${kind === 'aadhaar' ? 'Aadhaar card' : 'driving licence'}.`,
    };
  }

  // VALID with nothing extracted is not a success — treating it as one would
  // record an empty document as verified.
  const gotAnything = Object.values(fields).some(Boolean);
  if (!gotAnything) {
    return {
      status: 'FAILED', fields, raw: data, verificationId: id,
      message: 'We could not read the details from that image. Try a clearer photo.',
    };
  }

  return { status: 'VALID', fields, raw: data, verificationId: id, message: null };
}

module.exports = { runOcr, isConfigured, DOCUMENT_TYPES };
