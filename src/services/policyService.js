const Settings = require('../models/settings');
const ProtectionPlan = require('../models/protectionplan');
const {
  DRIVER_FEE, CONVENIENCE_FEE, DEPOSIT_AMOUNT, FIRST_TIME_OFFER,
  PICKUP_DROP_FEE, MAX_POINTS_USAGE, RESCHEDULE_FEE,
} = require('../configs/constants');

// A catalogue of every business rule the platform actually enforces, for
// review in the admin panel.
//
// This is deliberately DESCRIPTIVE, not a config store. Each entry records
// where the rule really lives, so nobody has to guess whether changing a
// number in Settings will do anything:
//   source: 'settings'  → editable in the admin, read from the settings table
//   source: 'code'      → hardcoded; changing it needs a deploy
//   source: 'per-record'→ stored per vehicle/host row, not globally
//
// `review` flags rules that are inconsistent, unreachable or unenforced. Those
// are findings from reading the code, not opinions about what the policy
// should be — the numbers themselves are yours to decide.

const POLICIES = [
  // ── Cancellation ────────────────────────────────────────────────
  {
    key: 'rider-cancellation-tiers',
    category: 'Cancellation',
    name: 'Rider cancellation refund tiers',
    rule: 'More than 24h before start: refund the booking total minus deposit and convenience fee. '
        + 'Between 12h and 24h: 50% of that amount. Under 12h: nothing. '
        + 'The security deposit is added back on top in every tier.',
    source: 'code',
    location: 'bookingService.js — userCancelBooking',
    review: 'The refund QUOTE shown to the rider is computed by a different function '
          + '(calculateRefundSummary) using a different formula — it deducts the protection-plan fee '
          + 'rather than the convenience fee, and its 50% tier is unreachable because the tier '
          + 'selector tests "timeDifference > 24" twice. A rider can be quoted one number and refunded another.',
  },
  {
    key: 'cancellation-status-gate',
    category: 'Cancellation',
    name: 'Which bookings can be cancelled',
    rule: 'Only bookings in the "booked" state can be cancelled by the rider.',
    source: 'code',
    location: 'bookingService.js — userCancelBooking',
    review: 'Bookings stuck in "initiated" (payment captured but confirm never completed) cannot be '
          + 'cancelled at all, so a rider who paid but never got confirmed has no self-service way out.',
  },
  {
    key: 'host-cancellation',
    category: 'Cancellation',
    name: 'Host cancellation',
    rule: 'The host can cancel a booking with a reason. The booking is marked cancelled and attributed to the host.',
    source: 'code',
    location: 'hostService.js — cancelBooking',
    review: 'No refund is issued, no penalty is applied to the host, and no alternate vehicle is offered. '
          + 'The rider simply loses the booking with their money still captured.',
  },
  {
    key: 'protection-plan-refundability',
    category: 'Cancellation',
    name: 'Protection plan is non-refundable',
    rule: 'The protection-plan fee is excluded from the refundable amount on cancellation.',
    source: 'code',
    location: 'bookingService.js — calculateRefundSummary',
  },

  // ── Fees, all configurable ──────────────────────────────────────
  {
    key: 'convenience-fee', category: 'Fees & Charges', name: 'Convenience fee',
    rule: 'Flat fee added to every booking. Non-refundable on cancellation.',
    source: 'settings', settingsKey: CONVENIENCE_FEE,
  },
  {
    key: 'deposit-amount', category: 'Fees & Charges', name: 'Security deposit',
    rule: 'Refundable deposit collected with the booking.',
    source: 'settings', settingsKey: DEPOSIT_AMOUNT,
    review: 'Refunded on cancellation, but NOT on normal ride completion — endRide has no deposit '
          + 'refund step. The commented-out earlier version of endRide did refund it.',
  },
  {
    key: 'driver-fee', category: 'Fees & Charges', name: 'Driver fee',
    rule: 'Charged when the booking includes a driver.',
    source: 'settings', settingsKey: DRIVER_FEE,
  },
  {
    key: 'pickup-drop-fee', category: 'Fees & Charges', name: 'Pickup / delivery fee',
    rule: 'Charged when the rider chooses delivery instead of self-pickup.',
    source: 'settings', settingsKey: PICKUP_DROP_FEE,
  },
  {
    key: 'reschedule-fee', category: 'Fees & Charges', name: 'Reschedule fee',
    rule: 'Charged when a rider reschedules a booking. Any fare difference is paid or refunded separately.',
    source: 'settings', settingsKey: RESCHEDULE_FEE,
  },
  {
    key: 'first-time-offer', category: 'Fees & Charges', name: 'First-booking discount',
    rule: 'Percentage discount applied to a rider\'s first booking.',
    source: 'settings', settingsKey: FIRST_TIME_OFFER, unit: '%',
  },

  // ── Wallet ──────────────────────────────────────────────────────
  {
    key: 'wallet-earn-rate', category: 'Wallet & Rewards', name: 'Points earned per ride',
    rule: '10 points per hour of the booking, credited when the ride is completed.',
    source: 'code',
    location: 'bookingService.js — endRide (hoursBooked * 10)',
    review: 'The multiplier is hardcoded and cannot be changed without a deploy.',
  },
  {
    key: 'wallet-redemption-cap', category: 'Wallet & Rewards', name: 'Maximum points per booking',
    rule: 'Caps how many points a rider may redeem against a single booking.',
    source: 'settings', settingsKey: MAX_POINTS_USAGE,
    fallback: '100 (used when the setting is absent)',
  },

  // ── Ride handshake ──────────────────────────────────────────────
  {
    key: 'ride-otp-handshake', category: 'Rides', name: 'Start / end OTP handshake',
    rule: 'The start OTP is issued when the booking is confirmed; the end OTP when the ride starts. '
        + 'Both are shown only to the host, who reads the code aloud. The rider enters it on their own '
        + 'app, and only that moves the booking to ongoing / finished. The host recording odometer, '
        + 'fuel and photos does not by itself start or end the ride.',
    source: 'code',
    location: 'rideOtpService.js',
  },
  {
    key: 'ride-capture-requirements', category: 'Rides', name: 'Handover evidence required',
    rule: 'Odometer reading, fuel level and photos must be captured at both pickup and return.',
    source: 'code',
    location: 'hostService.js / bookingService.js',
  },

  // ── Damage ──────────────────────────────────────────────────────
  {
    key: 'damage-report-window', category: 'Damage', name: 'Damage reporting window',
    rule: 'A host may report damage up to 240 hours (10 days) after the booking end time.',
    source: 'code',
    location: 'damageService.js — createDamage',
    review: 'The 240-hour window is hardcoded.',
  },
  {
    key: 'damage-approval', category: 'Damage', name: 'Damage approval and charging',
    rule: 'Claims start as pending. An admin approves or rejects and sets the amount owed. '
        + '"Paid" is only reachable through the payment flow, never set by hand.',
    source: 'code',
    location: 'adminDamageService.js',
    review: 'An approved claim does not yet create a charge or adjust any settlement — the amount is '
          + 'recorded but never collected.',
  },

  // ── Usage limits, per vehicle ───────────────────────────────────
  {
    key: 'km-allowance', category: 'Usage Limits', name: 'Kilometre allowance and excess rate',
    rule: 'Each vehicle plan sets an included kilometre allowance and a per-km rate beyond it.',
    source: 'per-record',
    location: 'vehiclePlan.kmAlloted / extraKmFee',
    review: 'Excess kilometres are never actually charged — nothing compares end odometer against the '
          + 'allowance at ride completion.',
  },
  {
    key: 'late-return', category: 'Usage Limits', name: 'Late return',
    rule: 'The booking model carries a delayedBy field intended for late returns.',
    source: 'code',
    location: 'booking.delayedBy',
    review: 'No policy exists: delayedBy is never computed or charged anywhere. There is no grace '
          + 'period and no late fee.',
  },
  {
    key: 'fuel-difference', category: 'Usage Limits', name: 'Fuel difference',
    rule: 'Fuel level is captured at pickup and return.',
    source: 'code',
    review: 'No policy exists: the readings are stored but never compared or charged.',
  },
  {
    key: 'cleaning-fee', category: 'Usage Limits', name: 'Cleaning fee',
    rule: 'Hosts track unclean returns (totalUncleanRides on the host and vehicle rows).',
    source: 'per-record',
    review: 'No policy exists: there is no cleaning fee anywhere in the pricing or settlement code.',
  },

  // ── Host ────────────────────────────────────────────────────────
  {
    key: 'host-commission', category: 'Host & Payouts', name: 'Host commission',
    rule: 'A commission percentage is stored per host with an effective date range, so rates can differ '
        + 'between hosts and change over time.',
    source: 'per-record',
    location: 'hostCommission.commissionPercentage',
  },
  {
    key: 'payout-bank-verification', category: 'Host & Payouts', name: 'Payout account verification',
    rule: 'Host bank accounts are verified by a name-match check against the bank record. An admin can '
        + 'override manually, which is recorded separately from a provider-verified account.',
    source: 'code',
    location: 'hostService.js / documentService.js',
  },

  // ── Listing & verification ──────────────────────────────────────
  {
    key: 'vehicle-approval', category: 'Listing & Verification', name: 'Vehicle approval before going live',
    rule: 'A newly listed vehicle stays unavailable until an admin approves it.',
    source: 'code',
    location: 'vehicle.isAdminApproved',
    review: 'There is no reject action and no rejection-reason field — an admin can only approve. '
          + 'A host whose vehicle is not approved is never told why, so "edit and resubmit" is not possible.',
  },
  {
    key: 'rc-verification', category: 'Listing & Verification', name: 'RC verification',
    rule: 'The registration certificate is verified against the official record during onboarding, and '
        + 'vehicle details are taken from that record rather than typed by the host.',
    source: 'code',
    location: 'hostService.js — onboardVehicleFromRc',
  },
  {
    key: 'rider-verification', category: 'Listing & Verification', name: 'Rider KYC / licence requirement',
    rule: 'Riders can submit KYC (Aadhaar), PAN and a driving licence, each verifiable by an admin.',
    source: 'code',
    review: 'Verification is informational only — it is NOT enforced anywhere in the booking flow. '
          + 'An unverified rider with no licence on file can complete a booking.',
  },
];

const CATEGORY_ORDER = [
  'Cancellation', 'Fees & Charges', 'Wallet & Rewards', 'Rides',
  'Damage', 'Usage Limits', 'Host & Payouts', 'Listing & Verification',
];

// Merges the live configured value into every settings-backed policy, so the
// review screen shows what is actually in force rather than just the rule text.
async function listPolicies() {
  let settingsByType = {};
  let protectionPlan = null;

  try {
    const rows = await Settings.findAll();
    settingsByType = Object.fromEntries(rows.map((r) => [r.type, r]));
  } catch (error) {
    // A settings read failure must not blank the whole catalogue — the rules
    // are still worth showing without their current values.
    console.error('[policies] could not read settings:', error.message);
  }

  try {
    protectionPlan = await ProtectionPlan.findOne({ order: [['createdAt', 'DESC']] });
  } catch (error) {
    console.error('[policies] could not read protection plan:', error.message);
  }

  const policies = POLICIES.map((p) => {
    const row = p.settingsKey ? settingsByType[p.settingsKey] : null;
    return {
      ...p,
      configured: p.source === 'settings' ? !!row : null,
      currentValue: row ? row.value : null,
      label: row ? row.label : null,
    };
  });

  const byCategory = CATEGORY_ORDER.map((category) => ({
    category,
    policies: policies.filter((p) => p.category === category),
  })).filter((g) => g.policies.length);

  return {
    categories: byCategory,
    summary: {
      total: policies.length,
      configurable: policies.filter((p) => p.source === 'settings').length,
      hardcoded: policies.filter((p) => p.source === 'code').length,
      perRecord: policies.filter((p) => p.source === 'per-record').length,
      needsReview: policies.filter((p) => p.review).length,
      unconfigured: policies.filter((p) => p.source === 'settings' && !p.configured).length,
    },
    protectionPlan: protectionPlan
      ? { basicPlanPrice: protectionPlan.basicPlanPrice, note: 'Price is per 12 hours.' }
      : null,
  };
}

module.exports = { listPolicies, POLICIES };
