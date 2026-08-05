const BOOKING_INITIATED = "initiated"
const BOOKING_BOOKED = "booked"
const BOOKING_ONGOING = "ongoing"
const BOOKING_FINISHED = "finished"
const BOOKING_CANCELLED = "cancelled"


const MEMBERSHIP_INITIATED = "initiated"
const MEMBERSHIP_SUBSCRIBED = "subscribed"
const MEMBERSHIP_RENEWED = "renewed"
const MEMBERSHIP_EXPIRED = "finished"
const MEMBERSHIP_CANCELLED = "cancelled"



const EXTENSION_INITIATED = "initiated"
const EXTENSION_DONE = "done"
const EXTENSION_FAILED = "failed"
const EXTENSION_CANCELLED = "cancelled"

const RESCHEDULE_INITIATED = "initiated"
const RESCHEDULE_DONE = "done"
const RESCHEDULE_FAILED = "failed"
const RESCHEDULE_CANCELLED = "cancelled"

const DUE_CREATED = "initiated"
const DUE_PAID = "paid"
const DUE_CANCELLED = "cancelled"


const TRANSACTION_INITIATED = "initiated"
const TRANSACTION_FAILED = "failed"
const TRANSACTION_AUTHORIZED = "authorized"
const TRANSACTION_CAPTURED = "captured"
const TRANSACTION_PAID = "paid"
const TRANSACTION_CANCELLED = "cancelled"


const REFUND_PENDING = "pending"
const REFUND_PROCESSED = "processed"
const REFUND_FAILED = "failed"


// Damage report lifecycle. Must match the lowercase ENUM on the `damage` model
// (['pending','approved','rejected','paid']); the service previously wrote
// uppercase values that MySQL rejected as out-of-range for the ENUM.
const DAMAGE_PENDING = "pending"
const DAMAGE_APPROVED = "approved"
const DAMAGE_ASSESSED = "assessed"
const DAMAGE_REJECTED = "rejected"
const DAMAGE_PAID = "paid"


const TRANSACTION_TYPE_BOOKING = "booking"
const TRANSACTION_TYPE_EXTENSION = "extension"
const TRANSACTION_TYPE_MEMBERSHIP = "membership"
const TRANSACTION_TYPE_RESCHEDULE = "reschedule"
const TRANSACTION_TYPE_DUE = "due"


const HOOK_ORDER_PAID = "order.paid"
const HOOK_PAYMENT_AUTHORIZED = "payment.authorized"
const HOOK_PAYMENT_CAPTURED = "payment.captured"

const DRIVER_FEE = 'driver_fee'
const CONVENIENCE_FEE = 'convenience_fee'
const DEPOSIT_AMOUNT = 'deposit_amount'
const FIRST_TIME_OFFER = 'first_time_offer'
const PICKUP_DROP_FEE = 'pickup_drop_fee'
const MAX_POINTS_USAGE = 'max_points_usage'
const RESCHEDULE_FEE = 'reschedule_fee'
// REMOVED: `const PG_HIDDEN = "test123"`.
//
// It was a placeholder standing in for the Razorpay key secret, and every
// payment-signature check in the codebase was passed it. Verifying a real
// signature against "test123" fails for every legitimate payment — which is
// why all five checks ended up commented out, leaving the payment paths
// unverified entirely.
//
// The secret is `process.env.PG_SEC` (the same one helper/payment.js builds the
// Razorpay instance with, and the only one Razorpay signs with). It is read in
// utils/paymentSignature.js. Do not reintroduce a literal here — a fake secret
// in source is worse than no secret, because it makes the check look wired up.

module.exports = {DAMAGE_PENDING,DAMAGE_APPROVED,DAMAGE_ASSESSED,DAMAGE_REJECTED,DAMAGE_PAID,BOOKING_INITIATED,BOOKING_BOOKED,BOOKING_CANCELLED,BOOKING_FINISHED,BOOKING_ONGOING,TRANSACTION_TYPE_BOOKING,TRANSACTION_TYPE_MEMBERSHIP,TRANSACTION_TYPE_EXTENSION,TRANSACTION_TYPE_DUE,TRANSACTION_INITIATED,TRANSACTION_FAILED,TRANSACTION_PAID,TRANSACTION_CANCELLED,TRANSACTION_CAPTURED,TRANSACTION_AUTHORIZED,HOOK_ORDER_PAID,HOOK_PAYMENT_AUTHORIZED,HOOK_PAYMENT_CAPTURED,MEMBERSHIP_INITIATED,MEMBERSHIP_SUBSCRIBED,MEMBERSHIP_RENEWED,MEMBERSHIP_EXPIRED,MEMBERSHIP_CANCELLED,REFUND_PENDING,REFUND_PROCESSED,REFUND_FAILED,EXTENSION_INITIATED,EXTENSION_DONE,EXTENSION_FAILED,EXTENSION_CANCELLED,DUE_CREATED,DUE_PAID,DUE_CANCELLED,DRIVER_FEE,CONVENIENCE_FEE,DEPOSIT_AMOUNT,FIRST_TIME_OFFER,PICKUP_DROP_FEE,MAX_POINTS_USAGE,RESCHEDULE_FEE,RESCHEDULE_INITIATED,RESCHEDULE_DONE,RESCHEDULE_FAILED,RESCHEDULE_CANCELLED,TRANSACTION_TYPE_RESCHEDULE}