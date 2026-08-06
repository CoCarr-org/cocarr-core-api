const Razorpay = require('razorpay');

// Razorpay client, constructed LAZILY on first use.
//
// It used to be built at module load:
//
//     var RazorpayInstance = new Razorpay({ key_id: process.env.PG_KEY, ... });
//
// The Razorpay constructor throws "`key_id` is mandatory" when the key is
// absent, and this module is required (transitively) from index.js — so a
// missing PG_KEY did not disable payments, it made the ENTIRE API unbootable.
// Every route, including /health and the image proxy, went down because one
// integration was unconfigured. That is a crash loop, not a degradation.
//
// This is the same rule the rest of the payment code already follows:
// `assertPaymentSignature` logs loudly and allows when PG_SEC is unset,
// precisely because "refusing every payment would turn a config gap into a total
// outage of the booking flow". Constructing the client eagerly contradicted that
// and turned the same config gap into an outage of everything.
//
// Now: the process boots, every non-payment route works, and a payment call
// fails with a message that names the missing variables. Nothing is faked —
// there is no placeholder key. A fake credential would be worse than none,
// because it makes the signature check look wired up when it cannot pass.

let instance = null;

function client() {
  if (instance) return instance;
  const key_id = process.env.PG_KEY;
  const key_secret = process.env.PG_SEC;
  if (!key_id || !key_secret) {
    throw new Error(
      'Razorpay is not configured: set PG_KEY and PG_SEC. '
      + '(Note the names — they are not RAZORPAY_*.)',
    );
  }
  instance = new Razorpay({ key_id, key_secret });
  return instance;
}

// A Proxy so every existing call site keeps working unchanged —
// `RazorpayInstance.orders.create(...)`, `.payments.fetch(...)`,
// `.transfers.create(...)` — across the eight services that import this.
// Deferring construction without it would mean editing all of them.
module.exports = new Proxy({}, {
  get(_target, prop) {
    const value = client()[prop];
    return typeof value === 'function' ? value.bind(instance) : value;
  },
  has(_target, prop) {
    return prop in client();
  },
});
