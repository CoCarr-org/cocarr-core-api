const { Op } = require('sequelize');
const documentStore = require('./documentStoreService');
const ocrService = require('./documentOcrService');
const imageService = require('./imageService');
const userVerification = require('./userVerificationService');
const User = require('../models/user');
const KycDocument = require('../models/kycDocument');

// Aadhaar and driving-licence capture during user onboarding.
//
// Both follow the same shape, which is why they share a file:
//   1. store the images
//   2. run the front image through OCR
//   3. write a document row carrying BOTH what the user typed and what OCR read
//   4. decide whether the submission stands on its own or needs consent
//
// The extracted values are stored ALONGSIDE the typed ones, never instead of
// them. The admin's job is to compare the two, and overwriting the user's entry
// with the provider's would destroy the very discrepancy they are looking for.
//
// PAN and bank verification live on the host side and do not come through here.

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const badRequest = (m) => httpError(m, 400);

// ── Format validation ──────────────────────────────────────────────────────
// Typos are rejected outright. A provider verdict is never used to reject —
// that is advisory everywhere in this codebase.
const AADHAAR_RE = /^\d{12}$/;
const LICENCE_RE = /^[A-Z]{2}[0-9]{2}[0-9A-Z]{10,12}$/;

const normaliseAadhaar = (v) => String(v || '').replace(/[\s-]/g, '');
const normaliseLicence = (v) => String(v || '').toUpperCase().replace(/[\s-]/g, '');

// Stores a base64 / data-URI image and returns its object key.
const storeImage = async (image, folder) => {
  if (!image) return null;
  // Already a stored key or proxied URL — nothing to upload.
  if (typeof image === 'string' && !image.startsWith('data:')) return image;

  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(image);
  if (!match) throw badRequest('Image must be a base64 data URI');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw badRequest('Image is empty');
  return imageService.putObject(buffer, match[1], folder);
};

const bufferOf = (image) => {
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(String(image || ''));
  if (!match) return null;
  return { buffer: Buffer.from(match[2], 'base64'), mimeType: match[1] };
};

// A submission stands on its own when OCR read the document. When it did not,
// the user must explicitly agree to manual verification — otherwise we would be
// silently queueing something nobody has checked.
const requiresConsent = (ocrStatus) => ocrStatus !== 'VALID';

function consentError(ocr) {
  const err = badRequest(
    ocr.message || 'We could not verify that document automatically.',
  );
  // The client branches on this to show the consent prompt rather than a plain
  // error, so it is part of the contract, not decoration.
  err.needsConsent = true;
  err.ocrStatus = ocr.status;
  return err;
}

// ── Aadhaar: step 1, read the scans ────────────────────────────────────────
//
// The capture order is scans FIRST, OTP second:
//   1. POST /user/verification/aadhaar/scan (here) — store both faces, OCR the
//      front, and hand the extracted number back so the client can prefill it
//   2. POST /user/check-kyc   — provider sends an OTP to the Aadhaar-linked phone
//   3. POST /user/verify-kyc  — writes `referenceId` + `otpVerifiedAt`
//
// Storing the scans before the OTP does NOT weaken the guarantee the old
// ordering protected. `referenceId` is still written only by a successful OTP,
// `readiness()` still treats a row without one as not submitted, and nothing
// here sets `status` — that stays the admin's decision. A row produced by this
// step alone is an unproven draft and counts for nothing.
//
// OCR failing is not a dead end: the client falls back to asking the user to
// type the number, and `manualConsent` records that they agreed to a human
// checking the card. The OTP still has to pass either way, so a manual number
// is no less proven than an extracted one.
async function scanAadhaar(userId, body = {}) {
  // Consent-only call. The user has already uploaded a card OCR could not read
  // and has now chosen "let your team verify it for me" instead of retrying.
  // Nothing to re-upload — the scans are already stored, and re-posting several
  // megabytes of base64 to record a checkbox would be absurd.
  if (!body.frontImage && !body.backImage && body.manualConsent === true) {
    const stored = await documentStore.getCurrent('kyc', userId);
    if (!stored?.imageKey) throw badRequest('Upload photos of your Aadhaar card first');
    await documentStore.update('kyc', stored, {
      manualConsent: true,
      manualConsentAt: stored.manualConsentAt || new Date(),
    });
    return {
      ocrStatus: stored.ocrStatus || null,
      aadhaarNumber: null,
      holderName: stored.holderName || null,
      dateOfBirth: stored.dateOfBirth || null,
      gender: stored.gender || null,
      address: stored.address || null,
      needsManualEntry: true,
      manualVerification: true,
      message: null,
    };
  }

  if (!body.frontImage) throw badRequest('Upload the front of your Aadhaar card');
  if (!body.backImage) throw badRequest('Upload the back of your Aadhaar card');

  const front = bufferOf(body.frontImage);
  const ocr = front
    ? await ocrService.runOcr('aadhaar', front.buffer, front.mimeType)
    : { status: 'UNCHECKED', fields: {}, raw: null, verificationId: null, message: 'No image to read' };

  const [imageKey, backImageKey] = await Promise.all([
    storeImage(body.frontImage, 'kyc'),
    storeImage(body.backImage, 'kyc'),
  ]);

  const ocrNumber = normaliseAadhaar(ocr.fields.documentNumber);
  const readNumber = AADHAAR_RE.test(ocrNumber) ? ocrNumber : null;

  const fields = {
    imageKey,
    backImageKey,
    ocrStatus: ocr.status,
    ocrVerificationId: ocr.verificationId,
    ocrFields: ocr.fields,
    ocrRaw: ocr.raw,
    ocrCheckedAt: new Date(),
    providerStatus: ocr.status,
    providerCheckedAt: new Date(),
  };
  // Only what OCR actually read. A failed read must not blank values a previous
  // scan found, so nulls are never written over existing data.
  if (readNumber) fields.documentNumber = readNumber;
  // A retry that finally reads cleanly withdraws the earlier request for a
  // manual check — the user asked for one because automatic reading had failed,
  // and leaving the flag set would queue a card the machine has now read.
  if (readNumber) { fields.manualConsent = false; fields.manualConsentAt = null; }
  if (ocr.fields.holderName) fields.holderName = ocr.fields.holderName;
  if (ocr.fields.dateOfBirth) fields.dateOfBirth = ocr.fields.dateOfBirth;
  if (ocr.fields.gender) fields.gender = ocr.fields.gender;
  if (ocr.fields.address) fields.address = ocr.fields.address;

  const existing = await documentStore.getCurrent('kyc', userId);

  // Re-scanning a row an admin has already decided on starts a NEW submission,
  // so their verdict is not silently attached to scans they never saw. The OTP
  // proof carries forward — it is about the number, not the photographs.
  if (!existing || existing.status === 'verified' || existing.status === 'rejected') {
    await documentStore.submit('kyc', userId, {
      ...fields,
      documentNumber: fields.documentNumber || existing?.documentNumber || null,
      holderName: fields.holderName || existing?.holderName || null,
      referenceId: existing?.referenceId || null,
      otpVerifiedAt: existing?.otpVerifiedAt || null,
    });
  } else {
    // Still an open draft — update in place so repeated attempts at a readable
    // photo do not each leave a row behind in the review history.
    await documentStore.update('kyc', existing, fields);
  }

  return {
    ocrStatus: ocr.status,
    // Handed straight back to the owner of the document so the client can
    // prefill the field — this is the user's own number, and it is the whole
    // point of the scan. It is masked everywhere it is read back later.
    aadhaarNumber: readNumber,
    holderName: ocr.fields.holderName || null,
    dateOfBirth: ocr.fields.dateOfBirth || null,
    gender: ocr.fields.gender || null,
    address: ocr.fields.address || null,
    // The client shows the retry / manual-verification choice on this, rather
    // than deciding for itself which statuses count as failure.
    needsManualEntry: !readNumber,
    // True once the user has opted into a human checking the card. Carried back
    // so a client reopening the step knows the choice was already made.
    manualVerification: !readNumber && !!existing?.manualConsent,
    message: readNumber ? null : (ocr.message || 'We could not read your Aadhaar card automatically.'),
  };
}

// ── Aadhaar: step 2, confirm the number ────────────────────────────────────
//
// Sits between the scan and the OTP. Its job is to settle WHICH Aadhaar is
// about to be verified, and to hand back what we know about it, before a code
// is sent to a phone the user may not be holding.
//
// It does three things the OTP call cannot do on its own:
//   - proves the number is well formed, so a typo is caught here rather than
//     surfacing as an opaque provider rejection
//   - refuses a number already linked to another account
//   - refuses a number that disagrees with the card that was uploaded — the
//     scans on file must belong to the Aadhaar being verified, or the pair
//     proves nothing
//
// The number is NOT validated against the Verhoeff checksum Aadhaar uses.
// Provider sandboxes issue test numbers that fail it, and a checksum rejection
// on a real card the user has in their hand is worse than letting the OTP be
// the arbiter.
async function confirmAadhaarNumber(userId, body = {}) {
  const typed = normaliseAadhaar(body.aadhaarNumber);
  if (body.aadhaarNumber !== undefined && !AADHAAR_RE.test(typed)) {
    throw badRequest('Enter the 12-digit Aadhaar number');
  }

  const doc = await documentStore.getCurrent('kyc', userId);
  if (!doc?.imageKey) {
    const err = badRequest('Upload photos of your Aadhaar card before confirming the number');
    // Sends the client back to the upload step instead of showing a dead end.
    err.needsScan = true;
    throw err;
  }

  // An admin has already ruled on this row. Editing the number under a verdict
  // would attach their decision to an Aadhaar they never saw; a new number means
  // a new submission, which is what re-scanning the card produces.
  if (doc.status === 'verified') throw badRequest('Your Aadhaar is already verified');
  if (doc.status === 'rejected') {
    const err = badRequest('This Aadhaar was rejected. Upload your card again to resubmit it.');
    err.needsScan = true;
    throw err;
  }

  // What OCR read off the card, if it read anything. `ocrFields` is the parsed
  // subset; the row's own `documentNumber` may have been typed on an earlier
  // attempt, so it is not the right thing to compare against.
  const readNumber = normaliseAadhaar(doc.ocrFields?.documentNumber);
  const ocrRead = AADHAAR_RE.test(readNumber);

  // Nothing typed. That is the normal case when OCR read the card and the client
  // no longer holds the number — it is handed back once, at scan time, and
  // masked in every response after that, so a client returning to this step has
  // nothing to send. The card is the source of truth; use what it says.
  const number = typed || (ocrRead ? readNumber : '');
  if (!AADHAAR_RE.test(number)) throw badRequest('Enter the 12-digit Aadhaar number');

  const clash = await KycDocument.findOne({
    where: { documentNumber: number, isCurrent: true, userId: { [Op.ne]: userId } },
  });
  if (clash) throw badRequest('That Aadhaar number is already linked to another account');

  if (ocrRead && readNumber !== number) {
    throw badRequest(
      'That number does not match the Aadhaar card you uploaded. Check the number, '
      + 'or go back and upload the right card.',
    );
  }

  // Typed because OCR could not read the card, so a human has to look at it.
  // Recording the consent here — at the point the user commits to the number —
  // is what marks the row for review.
  const manual = !ocrRead;

  await documentStore.update('kyc', doc, {
    documentNumber: number,
    ...(manual
      ? { manualConsent: true, manualConsentAt: doc.manualConsentAt || new Date() }
      : {}),
  });

  return {
    // Masked on the way back out. The client already has what the user typed;
    // echoing a full Aadhaar into a response body only creates another place
    // for it to be logged.
    aadhaarNumber: `•••• •••• ${number.slice(-4)}`,
    // Where the number came from, so the client can say "read from your card"
    // rather than implying the user typed something they did not.
    source: ocrRead ? 'document' : 'entered',
    manualVerification: manual,
    holderName: doc.holderName || null,
    dateOfBirth: doc.dateOfBirth || null,
    gender: doc.gender || null,
    address: doc.address || null,
    otpVerified: !!doc.referenceId,
  };
}

// ── Aadhaar: legacy single-shot submit ─────────────────────────────────────
//
// Superseded by scanAadhaar + the OTP pair, and kept only for clients still on
// the old order. It requires the OTP to have happened FIRST, which is exactly
// what the new flow inverts — do not route new work through it.
async function submitAadhaar(userId, body = {}) {
  const number = normaliseAadhaar(body.aadhaarNumber);
  if (!AADHAAR_RE.test(number)) throw badRequest('Enter the 12-digit Aadhaar number');
  if (!body.frontImage) throw badRequest('Upload the front of your Aadhaar card');
  if (!body.backImage) throw badRequest('Upload the back of your Aadhaar card');

  // `referenceId` is the provider's e-KYC transaction id, written only by a
  // successful OTP verification — its presence IS the proof.
  const otpDoc = await documentStore.getCurrent('kyc', userId);
  if (!otpDoc?.referenceId) {
    const err = badRequest('Verify your Aadhaar with the OTP before submitting your documents');
    err.needsOtp = true;
    throw err;
  }
  // The OTP proved a specific number. Submitting a different one would attach
  // scans to an identity nobody verified.
  if (normaliseAadhaar(otpDoc.documentNumber) !== number) {
    const err = badRequest(
      'This Aadhaar number is different from the one you verified. Verify the new number with an OTP first.',
    );
    err.needsOtp = true;
    throw err;
  }

  const front = bufferOf(body.frontImage);
  const ocr = front
    ? await ocrService.runOcr('aadhaar', front.buffer, front.mimeType)
    : { status: 'UNCHECKED', fields: {}, raw: null, verificationId: null, message: 'No image to read' };

  // Consent is checked BEFORE anything is stored, so a refusal leaves no
  // half-written document row behind.
  if (requiresConsent(ocr.status) && body.manualConsent !== true) {
    throw consentError(ocr);
  }

  // OCR read a different number than the user typed — that is a mismatch for
  // the admin to judge, not something to silently accept or reject here.
  const ocrNumber = normaliseAadhaar(ocr.fields.documentNumber);

  const [imageKey, backImageKey] = await Promise.all([
    storeImage(body.frontImage, 'kyc'),
    storeImage(body.backImage, 'kyc'),
  ]);

  await documentStore.submit('kyc', userId, {
    documentNumber: number,
    // Carried forward from the OTP row. `submit()` creates a new row and demotes
    // the previous one, so omitting these would throw away the very proof the
    // check above insists on — and the provider's name, which is what the KYC
    // name-matching rule compares the profile against.
    referenceId: otpDoc.referenceId,
    otpVerifiedAt: otpDoc.otpVerifiedAt || otpDoc.providerCheckedAt || new Date(),
    // The provider's name outranks OCR: it comes from the Aadhaar database
    // itself, not from reading a photograph.
    holderName: otpDoc.holderName || ocr.fields.holderName || null,
    dateOfBirth: ocr.fields.dateOfBirth || null,
    gender: ocr.fields.gender || null,
    address: ocr.fields.address || null,
    imageKey,
    backImageKey,
    ocrStatus: ocr.status,
    ocrVerificationId: ocr.verificationId,
    ocrFields: { ...ocr.fields, numberMatchesTyped: ocrNumber ? ocrNumber === number : null },
    ocrRaw: ocr.raw,
    ocrCheckedAt: new Date(),
    manualConsent: requiresConsent(ocr.status),
    manualConsentAt: requiresConsent(ocr.status) ? new Date() : null,
    providerStatus: ocr.status,
    providerCheckedAt: new Date(),
  });

  await userVerification.refreshAfterDocument(userId);
  return userVerification.getStatus(userId);
}

// ── Driving licence: step 1, read the scans ────────────────────────────────
//
// Mirrors `scanAadhaar`, and for the same reason: the images are stored FIRST,
// so a failed read can be retried against them without asking the user to
// photograph the licence again. The number is not required here — OCR reads it
// off the front — and when it cannot be read, `confirmLicenceNumber` collects
// it instead.
//
// This reverses the old "consent before anything is stored" rule for the
// licence. That rule bought a clean database at the cost of throwing the photo
// away on every failed read, which is precisely the retry this flow needs. A
// draft row with no `licenceNumber` is not submitted as far as `readiness()` is
// concerned, so nothing reaches the review queue on the strength of it.
async function scanLicence(userId, body = {}) {
  // Consent-only call: the user has already uploaded a licence OCR could not
  // read and has chosen a manual check. Nothing to re-upload.
  if (!body.frontImage && !body.backImage && body.manualConsent === true) {
    const stored = await documentStore.getCurrent('licence', userId);
    if (!stored?.frontImageKey) throw badRequest('Upload photos of your licence first');
    await documentStore.update('licence', stored, {
      manualConsent: true,
      manualConsentAt: stored.manualConsentAt || new Date(),
    });
    return {
      ocrStatus: stored.ocrStatus || null,
      licenceNumber: stored.licenceNumber || null,
      needsManualEntry: !stored.licenceNumber,
      manualVerification: true,
      message: null,
    };
  }

  if (!body.frontImage) throw badRequest('Upload the front of your driving licence');
  if (!body.backImage) throw badRequest('Upload the back of your driving licence');

  const front = bufferOf(body.frontImage);
  const ocr = front
    ? await ocrService.runOcr('licence', front.buffer, front.mimeType)
    : { status: 'UNCHECKED', fields: {}, raw: null, verificationId: null, message: 'No image to read' };

  const [frontImageKey, backImageKey] = await Promise.all([
    storeImage(body.frontImage, 'license'),
    storeImage(body.backImage, 'license'),
  ]);

  const ocrNumber = normaliseLicence(ocr.fields.licenceNumber);
  const readNumber = LICENCE_RE.test(ocrNumber) ? ocrNumber : null;

  // The user's DOB is the fallback when OCR could not read one — the licence
  // check and the profile should agree, and a null here loses the comparison.
  const user = await User.findByPk(userId);

  const fields = {
    frontImageKey,
    backImageKey,
    ocrStatus: ocr.status,
    ocrVerificationId: ocr.verificationId,
    ocrFields: ocr.fields,
    ocrRaw: ocr.raw,
    ocrCheckedAt: new Date(),
    providerStatus: ocr.status,
    providerCheckedAt: new Date(),
  };
  // Only what OCR actually read. A failed read must not blank values an earlier
  // scan found, so nulls are never written over existing data.
  if (readNumber) fields.licenceNumber = readNumber;
  // A retry that finally reads cleanly withdraws the earlier request for a
  // manual check.
  if (readNumber) { fields.manualConsent = false; fields.manualConsentAt = null; }
  if (ocr.fields.holderName) fields.holderName = ocr.fields.holderName;
  if (ocr.fields.issuedDate) fields.issuedDate = ocr.fields.issuedDate;
  if (ocr.fields.expiryDate) fields.expiryDate = ocr.fields.expiryDate;
  fields.dateOfBirth = ocr.fields.dateOfBirth || user?.dateOfBirth || null;

  const existing = await documentStore.getCurrent('licence', userId);

  // Re-scanning a row an admin has already decided on starts a NEW submission,
  // so their verdict is not silently attached to scans they never saw.
  if (!existing || existing.status === 'verified' || existing.status === 'rejected') {
    await documentStore.submit('licence', userId, {
      ...fields,
      licenceNumber: fields.licenceNumber || existing?.licenceNumber || null,
      holderName: fields.holderName || existing?.holderName || null,
    });
  } else {
    await documentStore.update('licence', existing, fields);
  }

  if (readNumber) await userVerification.refreshAfterDocument(userId);

  return {
    ocrStatus: ocr.status,
    licenceNumber: readNumber,
    holderName: ocr.fields.holderName || null,
    expiryDate: ocr.fields.expiryDate || null,
    needsManualEntry: !readNumber,
    manualVerification: !readNumber && !!existing?.manualConsent,
    message: readNumber ? null : (ocr.message || 'We could not read your driving licence automatically.'),
  };
}

// ── Driving licence: step 2, confirm the number ────────────────────────────
// The counterpart of `confirmAadhaarNumber`, and reached the same way: OCR
// could not read the licence, so the user types the number and a human checks
// the scan. Support cannot look up a licence with no number, which is why the
// manual path collects one rather than simply recording consent.
async function confirmLicenceNumber(userId, body = {}) {
  const number = normaliseLicence(body.licenceNumber);
  if (!LICENCE_RE.test(number)) {
    throw badRequest('Enter a valid licence number, for example KA0520190001234');
  }

  const doc = await documentStore.getCurrent('licence', userId);
  if (!doc?.frontImageKey) {
    const err = badRequest('Upload photos of your driving licence before entering the number');
    err.needsScan = true;
    throw err;
  }
  if (doc.status === 'verified') throw badRequest('Your licence is already verified');
  if (doc.status === 'rejected') {
    const err = badRequest('This licence was rejected. Upload it again to resubmit.');
    err.needsScan = true;
    throw err;
  }

  const readNumber = normaliseLicence(doc.ocrFields?.licenceNumber);
  const ocrRead = LICENCE_RE.test(readNumber);
  // Typed because OCR could not read the licence, so a human has to look at it.
  const manual = !ocrRead;

  await documentStore.update('licence', doc, {
    licenceNumber: number,
    // Kept so the reviewer can see the two side by side. Only meaningful when
    // there are two numbers to compare.
    ocrFields: { ...(doc.ocrFields || {}), numberMatchesTyped: ocrRead ? readNumber === number : null },
    ...(manual
      ? { manualConsent: true, manualConsentAt: doc.manualConsentAt || new Date() }
      : {}),
  });

  await userVerification.refreshAfterDocument(userId);

  return {
    licenceNumber: number,
    source: ocrRead ? 'document' : 'entered',
    manualVerification: manual,
    holderName: doc.holderName || null,
    expiryDate: doc.expiryDate || null,
  };
}

// ── Retrying OCR on a document already uploaded ────────────────────────────
//
// The point of this endpoint is that a failed read does NOT cost the user their
// photographs. OCR fails for reasons that have nothing to do with the image —
// a provider timeout, an IP that fell off the allowlist, a transient 5xx — and
// the honest response to those is to try reading the same scan again, not to
// send someone back to re-photograph a document that was fine.
//
// Re-reads the STORED scan, so it works even in a session that no longer holds
// the images. Never touches the admin's `status`.
async function retryDocumentOcr(userId, kind) {
  if (!['aadhaar', 'licence'].includes(kind)) {
    throw badRequest(`Cannot retry OCR for "${kind}"`);
  }

  const type = kind === 'aadhaar' ? 'kyc' : 'licence';
  const doc = await documentStore.getCurrent(type, userId);
  const key = kind === 'aadhaar' ? doc?.imageKey : doc?.frontImageKey;
  if (!key) {
    const err = badRequest('Upload your document first');
    err.needsScan = true;
    throw err;
  }

  // Re-reads the stored image and writes the OCR columns. Shared with the admin
  // re-run so both produce identical results from identical input.
  const result = await reRunOcr(userId, kind);

  const fresh = await documentStore.getCurrent(type, userId);
  const numberField = kind === 'aadhaar' ? 'documentNumber' : 'licenceNumber';
  const normalise = kind === 'aadhaar' ? normaliseAadhaar : normaliseLicence;
  const pattern = kind === 'aadhaar' ? AADHAAR_RE : LICENCE_RE;

  const read = normalise(
    kind === 'aadhaar' ? result.fields?.documentNumber : result.fields?.licenceNumber,
  );
  const readNumber = pattern.test(read) ? read : null;

  // The read succeeded this time. Record the number and withdraw the manual
  // check the earlier failure prompted — nobody needs to eyeball a card the
  // machine has now read.
  if (readNumber) {
    await documentStore.update(type, fresh, {
      [numberField]: readNumber,
      manualConsent: false,
      manualConsentAt: null,
    });
    await userVerification.refreshAfterDocument(userId);
  }

  return {
    kind,
    ocrStatus: result.status,
    // The owner's own document, same as the scan response. Masked everywhere
    // it is read back later.
    [kind === 'aadhaar' ? 'aadhaarNumber' : 'licenceNumber']: readNumber,
    holderName: result.fields?.holderName || null,
    needsManualEntry: !readNumber,
    message: readNumber
      ? null
      : (result.message || 'We still could not read that document.'),
  };
}

// ── Driving licence: legacy single-shot submit ─────────────────────────────
// The licence number is OPTIONAL on the way in — the step is an upload, and
// OCR reads the number off the front. A typed number is still accepted and
// still stored as what the user claimed, because the reviewer's job is to
// compare the two.
//
// When OCR reads nothing AND nothing was typed, the response asks for the
// number (`needsNumber`) alongside the usual consent prompt: the user either
// retries with a clearer photo, or supplies the number and agrees to a human
// checking the licence. Support cannot action a licence with no number on it,
// which is why the manual path still asks for one.
async function submitLicence(userId, body = {}) {
  const typed = normaliseLicence(body.licenceNumber);
  if (typed && !LICENCE_RE.test(typed)) {
    throw badRequest('Enter a valid licence number, for example KA0520190001234');
  }
  if (!body.frontImage) throw badRequest('Upload the front of your driving licence');
  if (!body.backImage) throw badRequest('Upload the back of your driving licence');

  const front = bufferOf(body.frontImage);
  const ocr = front
    ? await ocrService.runOcr('licence', front.buffer, front.mimeType)
    : { status: 'UNCHECKED', fields: {}, raw: null, verificationId: null, message: 'No image to read' };

  const ocrNumber = normaliseLicence(ocr.fields.licenceNumber);
  const readNumber = LICENCE_RE.test(ocrNumber) ? ocrNumber : null;
  const number = typed || readNumber;

  if (requiresConsent(ocr.status) && body.manualConsent !== true) {
    const err = consentError(ocr);
    // Nothing legible and nothing typed — the consent prompt has to collect the
    // number too, or agreeing to it would submit a licence nobody can look up.
    if (!number) err.needsNumber = true;
    throw err;
  }

  if (!number) {
    const err = badRequest(
      'We could not read the licence number from that photo. Enter it so our team can check it.',
    );
    err.needsNumber = true;
    throw err;
  }

  const [frontImageKey, backImageKey] = await Promise.all([
    storeImage(body.frontImage, 'license'),
    storeImage(body.backImage, 'license'),
  ]);

  // The user's DOB is the fallback when OCR could not read one — the licence
  // check and the profile should agree, and a null here loses the comparison.
  const user = await User.findByPk(userId);

  await documentStore.submit('licence', userId, {
    licenceNumber: number,
    holderName: ocr.fields.holderName || null,
    dateOfBirth: ocr.fields.dateOfBirth || user?.dateOfBirth || null,
    issuedDate: ocr.fields.issuedDate || null,
    expiryDate: ocr.fields.expiryDate || null,
    frontImageKey,
    backImageKey,
    ocrStatus: ocr.status,
    ocrVerificationId: ocr.verificationId,
    // Only meaningful when there are two numbers to compare. A number that came
    // from OCR alone is not "matching what the user typed" — nothing was typed.
    ocrFields: { ...ocr.fields, numberMatchesTyped: (ocrNumber && typed) ? ocrNumber === typed : null },
    ocrRaw: ocr.raw,
    ocrCheckedAt: new Date(),
    manualConsent: requiresConsent(ocr.status),
    manualConsentAt: requiresConsent(ocr.status) ? new Date() : null,
    providerStatus: ocr.status,
    providerCheckedAt: new Date(),
  });

  await userVerification.refreshAfterDocument(userId);
  return userVerification.getStatus(userId);
}

// ── Live selfie ────────────────────────────────────────────────────────────
// Captured from the front camera only; the clients never offer a file picker,
// which is the whole point of calling it live. Becomes the profile photo.
//
// MANDATORY in the onboarding wizard — there is no skip, and a blocked camera
// gets a permission request rather than a way past. It is deliberately NOT part
// of `readiness()` though: a photo is not an identity document, and gating the
// review queue on it would strand anyone whose device camera genuinely fails.
async function submitSelfie(userId, body = {}) {
  if (!body.image) throw badRequest('No selfie was captured');
  const profilePhoto = await storeImage(body.image, 'profile');

  const user = await User.findByPk(userId);
  if (!user) throw httpError('User not found', 404);
  await user.update({ profilePhoto });

  return userVerification.getStatus(userId);
}

// ── Admin: re-run OCR on an already-submitted document ────────────────────
// Distinct from `userVerificationService.recheckDocument`, which re-queries the
// licence REGISTRY by number. This re-reads the stored SCAN, which is what an
// admin wants when the first attempt returned UNCHECKED because the provider
// was down, or when the user consented to manual verification and the admin
// would rather have the machine's reading first.
//
// Never overwrites the admin's `status` — only the OCR columns.
async function reRunOcr(userId, kind) {
  if (!['aadhaar', 'licence'].includes(kind)) {
    throw badRequest(`Cannot OCR "${kind}" — only aadhaar and licence are scanned documents`);
  }

  const type = kind === 'aadhaar' ? 'kyc' : 'licence';
  const doc = await documentStore.getCurrent(type, userId);
  if (!doc) throw httpError(`This user has no ${kind} on file`, 404);

  const key = kind === 'aadhaar' ? doc.imageKey : doc.frontImageKey;
  if (!key) throw badRequest('There is no scan stored for this document');

  // The stored value may be a full proxy URL; the bucket wants the bare key.
  const objectKey = String(key).includes('/image/')
    ? String(key).split('/image/').pop()
    : String(key);

  let buffer;
  let mimeType = 'image/jpeg';
  try {
    const object = await imageService.getObject(objectKey);
    buffer = Buffer.concat(await object.Body.toArray());
    if (object.ContentType) mimeType = object.ContentType;
  } catch (error) {
    console.error('[ocr-rerun] could not read stored image:', error.message);
    throw httpError('Could not read the stored document image', 502);
  }

  const ocr = await ocrService.runOcr(kind, buffer, mimeType);

  const patch = {
    ocrStatus: ocr.status,
    ocrVerificationId: ocr.verificationId,
    ocrFields: ocr.fields,
    ocrRaw: ocr.raw,
    ocrCheckedAt: new Date(),
    providerStatus: ocr.status,
    providerCheckedAt: new Date(),
  };

  // Fill in extracted values, but never clobber a value already on the row with
  // a null — a failed re-read must not erase what the first read found.
  const merge = (field, value) => { if (value) patch[field] = value; };
  if (kind === 'aadhaar') {
    merge('holderName', ocr.fields.holderName);
    merge('dateOfBirth', ocr.fields.dateOfBirth);
    merge('gender', ocr.fields.gender);
    merge('address', ocr.fields.address);
  } else {
    merge('holderName', ocr.fields.holderName);
    merge('dateOfBirth', ocr.fields.dateOfBirth);
    merge('issuedDate', ocr.fields.issuedDate);
    merge('expiryDate', ocr.fields.expiryDate);
  }

  await doc.update(patch);

  // `fields` is deliberately NOT returned raw. It repeats the Aadhaar number in
  // plaintext, which would defeat the masking applied everywhere else the admin
  // sees this document — the same reason `ocrRaw`/`ocrFields` are stripped from
  // every other response.
  //
  // The row has been updated, so the review screen's next load renders the new
  // reading through the usual masked summary. This returns only what the toast
  // needs to say whether it worked.
  return {
    kind,
    status: ocr.status,
    message: ocr.message,
    // Enough for the UI to refresh in place rather than telling the admin to
    // reload, without restating the document's contents.
    read: !!(ocr.fields && (ocr.fields.documentNumber || ocr.fields.licenceNumber)),
    holderName: ocr.fields?.holderName || null,
    checkedAt: patch.ocrCheckedAt,
  };
}

module.exports = {
  scanAadhaar, confirmAadhaarNumber,
  scanLicence, confirmLicenceNumber,
  retryDocumentOcr,
  submitAadhaar, submitLicence, submitSelfie, reRunOcr,
};
