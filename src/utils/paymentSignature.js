const { validatePaymentVerification } = require('razorpay/dist/utils/razorpay-utils');
const { CustomError } = require('../middlewares/error');

// Razorpay payment-signature verification, in one place.
//
// ── What was wrong ───────────────────────────────────────────────────────────
// Five confirmation paths — booking, extension, reschedule, membership, dues —
// each computed `isValid` and then **threw the answer away**:
//
//     const isValid = validatePaymentVerification({...}, signature, PG_HIDDEN);
//     // if(!isValid) throw new CustomError(...)          ← commented out
//     if (tinfo) { ...mark authorised, confirm the booking... }
//
// So any authenticated user who knew an `orderId` could post any signature at
// all and have the transaction marked authorised and the booking confirmed,
// without a successful payment.
//
// And it could not have been simply uncommented, which is almost certainly why
// it was commented out in the first place: `PG_HIDDEN` was the literal string
// `"test123"` in `configs/constants.js`, not the Razorpay key secret. Enabling
// the check against the wrong secret rejects EVERY legitimate payment — so
// somebody hit that, commented the throw out, and the placeholder stayed.
//
// The secret is `PG_SEC`, the same one `helper/payment.js` builds the Razorpay
// instance with. It has to be: Razorpay signs `order_id|payment_id` with the
// secret belonging to the key that created the order.
//
// ── Why this does not simply throw when the secret is missing ────────────────
// A signature cannot be checked without the secret. If `PG_SEC` is unset — a
// local machine, a half-configured environment — refusing every payment would
// turn a configuration gap into a total outage of the booking flow.
//
// So: with a secret, verification is REAL and a bad signature is refused. With
// no secret, the behaviour is what it is today (allowed) but it says so loudly
// on every single call, because a payment path running unverified is not
// something that should be discoverable only by reading the source.
const secret = () => process.env.PG_SEC || '';

/**
 * Verifies a Razorpay payment signature, or throws.
 *
 * @param {string} label   the flow, for the log line ('booking', 'membership'…)
 * @param {object} args    { paymentId, orderId, signature }
 * @throws {CustomError}   400 when the signature does not match
 */
function assertPaymentSignature(label, { paymentId, orderId, signature }) {
  const key = secret();

  if (!key) {
    console.error(
      `[payment] PG_SEC is not set — the ${label} payment signature was NOT verified. `
      + 'Anyone who can reach this endpoint can confirm a payment that never happened. '
      + 'Set PG_SEC to the Razorpay key secret.',
    );
    return;
  }

  // A missing signature is a failed check, not a reason to skip one. The
  // clients all send it; its absence means either a bug or somebody probing.
  if (!signature || !paymentId || !orderId) {
    console.warn(`[payment] ${label}: refused — missing payment_id, order_id or signature.`);
    throw new CustomError('Invalid payment information.', 400, 'INVALID_PAYMENT_SIGNATURE');
  }

  let valid = false;
  try {
    valid = validatePaymentVerification(
      { payment_id: paymentId, order_id: orderId }, signature, key,
    );
  } catch (error) {
    // The library throws on malformed input. That is a failed verification, not
    // a server error — treating it as a 500 would let a malformed signature
    // read as "our fault, try again".
    console.warn(`[payment] ${label}: signature check threw — ${error.message}`);
    valid = false;
  }

  if (!valid) {
    console.warn(`[payment] ${label}: REFUSED — signature does not match order ${orderId}.`);
    throw new CustomError('Invalid payment information.', 400, 'INVALID_PAYMENT_SIGNATURE');
  }
}

module.exports = { assertPaymentSignature };
