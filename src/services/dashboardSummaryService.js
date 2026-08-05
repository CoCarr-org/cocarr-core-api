const { Op } = require('sequelize');
const teamService = require('./adminTeamService');
const User = require('../models/user');
const Host = require('../models/host');
const Vehicle = require('../models/vehicle');
const Booking = require('../models/booking');
const Dispute = require('../models/dispute');
const Damage = require('../models/damage');
const Ticket = require('../models/ticket');
const RefundRequest = require('../models/refundRequest');
const Settlement = require('../models/settlement');
const HostPayoutLedger = require('../models/hostPayoutLedger');
const KycDocument = require('../models/kycDocument');
const DrivingLicence = require('../models/drivingLicence');
const WebhookLog = require('../models/webhookLog');
const Referral = require('../models/referral');

// The dashboard, computed per block and scoped to the caller.
//
// ── Why this is not one big aggregate ──
// Every block declares the module it belongs to, and a block is computed ONLY if
// the caller can read that module. Gating the endpoint as a whole on
// `dashboard.read` would let anyone who can see a dashboard receive counts drawn
// from modules they cannot open — leaking exactly what a per-team portal exists
// to partition. A Support agent should not learn the settlement backlog from a
// tile.
//
// The client asks for its team's layout and renders what comes back. It never
// decides what to hide: a second copy of the permission rules in the UI would
// drift from this one, and the drift is silent.
//
// Blocks are cheap counts by design. This endpoint is hit on every dashboard
// load by every admin, so anything here that needs a join across a large table
// belongs on its own screen instead.

// `action` defaults to 'read'. A block that offers to DO something declares
// 'update' instead, which is what makes level work without any per-level
// branching: an Agent (read-only) simply never receives the actionable blocks.
const BLOCKS = {
  // ── Users / KYC ──
  kycQueue: {
    module: 'users',
    action: 'update',
    label: 'KYC verification',
    run: async () => {
      const [pending, rejected] = await Promise.all([
        User.count({ where: { verificationStatus: 'pending' } }),
        User.count({ where: { verificationStatus: 'rejected' } }),
      ]);
      return {
        primary: { label: 'Awaiting review', value: pending, href: '/dashboard/users?status=pending' },
        secondary: [{ label: 'Rejected', value: rejected, href: '/dashboard/users?status=rejected' }],
        attention: pending > 0 ? `${pending} profile(s) awaiting verification` : null,
      };
    },
  },
  documentsPending: {
    module: 'users',
    action: 'read',
    label: 'Documents',
    run: async () => {
      const [kyc, licence] = await Promise.all([
        KycDocument.count({ where: { isCurrent: true, status: 'pending' } }),
        DrivingLicence.count({ where: { isCurrent: true, status: 'pending' } }),
      ]);
      return {
        primary: { label: 'Aadhaar pending', value: kyc, href: '/dashboard/users/documents' },
        secondary: [{ label: 'Licences pending', value: licence, href: '/dashboard/users/documents' }],
      };
    },
  },

  // ── Bookings ──
  bookingsQueue: {
    module: 'bookings',
    action: 'read',
    label: 'Bookings',
    run: async () => {
      const since = new Date(); since.setHours(0, 0, 0, 0);
      const [today, ongoing, stuck] = await Promise.all([
        Booking.count({ where: { createdAt: { [Op.gte]: since } } }),
        Booking.count({ where: { status: 'ongoing' } }),
        // 'initiated' means payment captured but confirm-booking never
        // completed — a real stuck state, not a transient one.
        Booking.count({ where: { status: 'initiated' } }),
      ]);
      return {
        primary: { label: 'Created today', value: today, href: '/dashboard/rides' },
        secondary: [
          { label: 'Ongoing', value: ongoing, href: '/dashboard/rides' },
          { label: 'Stuck at initiated', value: stuck, href: '/dashboard/rides' },
        ],
        attention: stuck > 0 ? `${stuck} booking(s) stuck at "initiated"` : null,
      };
    },
  },
  disputesOpen: {
    module: 'bookings',
    action: 'update',
    label: 'Disputes',
    run: async () => {
      const open = await Dispute.count({ where: { status: ['open', 'investigating'] } });
      return {
        primary: { label: 'Unresolved', value: open, href: '/dashboard/bookings/disputes' },
        attention: open > 0 ? `${open} unresolved dispute(s)` : null,
      };
    },
  },
  damageClaims: {
    module: 'bookings',
    action: 'update',
    label: 'Damage claims',
    run: async () => {
      // The column is `damageStatus`, not `status` — `status` does not exist on
      // this model and would have counted every row, or thrown.
      const [pending, approved] = await Promise.all([
        Damage.count({ where: { damageStatus: 'pending' } }),
        Damage.count({ where: { damageStatus: 'approved' } }),
      ]);
      return {
        primary: { label: 'Awaiting verification', value: pending, href: '/dashboard/bookings/damages' },
        // `approved` means the photos were verified and it is with assessment —
        // NOT "charge this". Labelled accordingly so nobody reads it as settled.
        secondary: [{ label: 'Awaiting assessment', value: approved, href: '/dashboard/bookings/damages' }],
        attention: pending > 0 ? `${pending} damage claim(s) to verify` : null,
      };
    },
  },

  // ── Vehicles / hosts ──
  vehicleApprovals: {
    module: 'vehicles',
    action: 'update',
    label: 'Vehicle approvals',
    run: async () => {
      const [pending, rejected] = await Promise.all([
        Vehicle.count({ where: { approvalStatus: 'pending', isDraft: false, deleted: false } }),
        Vehicle.count({ where: { approvalStatus: 'rejected', deleted: false } }),
      ]);
      return {
        primary: { label: 'Awaiting approval', value: pending, href: '/dashboard/vehicles/approvals' },
        secondary: [{ label: 'Rejected', value: rejected, href: '/dashboard/vehicles?approved=false' }],
        attention: pending > 0 ? `${pending} vehicle(s) awaiting approval` : null,
      };
    },
  },
  hostsOverview: {
    module: 'hosts',
    action: 'read',
    label: 'Hosts',
    run: async () => {
      const total = await Host.count();
      return { primary: { label: 'Total hosts', value: total, href: '/dashboard/hosts' } };
    },
  },

  // ── Finance ──
  payoutsDue: {
    module: 'payouts',
    action: 'read',
    label: 'Host payouts',
    run: async () => {
      const [unsettled, pendingSettlements] = await Promise.all([
        HostPayoutLedger.count({ where: { settlementId: null } }),
        Settlement.count({ where: { status: ['pending', 'submitted'] } }),
      ]);
      return {
        primary: { label: 'Unsettled ledger rows', value: unsettled, href: '/dashboard/finance/settlements' },
        secondary: [{ label: 'Settlements in flight', value: pendingSettlements, href: '/dashboard/finance/settlements' }],
      };
    },
  },
  refundsPending: {
    module: 'payments',
    action: 'update',
    label: 'Refunds',
    run: async () => {
      // 'approved' counts too: the figures are agreed but the money has not
      // moved, so it is still on someone's desk.
      const pending = await RefundRequest.count({ where: { status: ['pending_review', 'approved'] } });
      return {
        primary: { label: 'Awaiting action', value: pending, href: '/dashboard/finance/refunds' },
        attention: pending > 0 ? `${pending} refund(s) to review` : null,
      };
    },
  },

  // ── Support ──
  ticketsOpen: {
    module: 'support',
    action: 'read',
    label: 'Support tickets',
    run: async () => {
      // The ENUM is open|pending|resolved|closed. 'pending' here means waiting
      // on us or the customer, not "unopened" — both count as not-yet-resolved.
      const open = await Ticket.count({ where: { status: ['open', 'pending'] } });
      return {
        primary: { label: 'Open', value: open, href: '/dashboard/support/tickets' },
        attention: open > 0 ? `${open} open ticket(s)` : null,
      };
    },
  },

  // ── Marketing ──
  referralFunnel: {
    module: 'marketing',
    action: 'read',
    label: 'Referrals',
    run: async () => {
      const [pending, completed] = await Promise.all([
        Referral.count({ where: { status: ['pending', 'created'] } }),
        // The legacy spellings still exist on rows written before the rename.
        Referral.count({ where: { status: ['completed', 'rewarded', 'eligible'] } }),
      ]);
      return {
        primary: { label: 'Completed', value: completed, href: '/dashboard/users/referrals' },
        secondary: [{ label: 'Awaiting activation', value: pending, href: '/dashboard/users/referrals' }],
      };
    },
  },

  // ── Developer ──
  systemHealth: {
    module: 'systemHealth',
    action: 'read',
    label: 'System health',
    run: async () => {
      const failed = await WebhookLog.count({ where: { succeeded: false } });
      return {
        primary: { label: 'Failed webhooks', value: failed, href: '/dashboard/developer/webhooks' },
        attention: failed > 0 ? `${failed} failed webhook call(s)` : null,
      };
    },
  },
};

// Which blocks each team's dashboard is made of, in display order.
//
// Curation, not a gate — a team not listed here falls back to every block it can
// read (see below), so a Super Admin creating a team at runtime gets a working
// dashboard immediately rather than an empty one waiting on a deploy.
const TEAM_LAYOUTS = {
  operations: ['bookingsQueue', 'vehicleApprovals', 'kycQueue', 'disputesOpen', 'damageClaims'],
  finance: ['payoutsDue', 'refundsPending', 'bookingsQueue', 'referralFunnel'],
  'customer-support': ['ticketsOpen', 'disputesOpen', 'bookingsQueue', 'documentsPending'],
  marketing: ['referralFunnel', 'hostsOverview', 'documentsPending'],
  admin: ['kycQueue', 'vehicleApprovals', 'bookingsQueue', 'ticketsOpen', 'hostsOverview'],
  developer: ['systemHealth'],
  'super-admin': ['kycQueue', 'vehicleApprovals', 'bookingsQueue', 'payoutsDue', 'ticketsOpen', 'systemHealth'],
};

// Everything this admin is allowed to see, in registry order. The fallback for
// an unlisted team, and the reason a new team is never staring at a blank page.
const defaultLayout = (permissions) => Object.keys(BLOCKS)
  .filter((key) => {
    const b = BLOCKS[key];
    return permissions[b.module] && permissions[b.module][b.action];
  });

async function getSummary(admin) {
  const access = await teamService.resolveAccess(admin);

  // `legacy` means the admin has no team and the backend is judging them by the
  // old role matrix. Rather than reimplement that here, give them the default
  // layout with no permissions — which yields an empty dashboard and a clear
  // reason, instead of a wrong one.
  const permissions = access.permissions || {};
  const teamKey = access.team?.key || null;

  const requested = (teamKey && TEAM_LAYOUTS[teamKey]) || defaultLayout(permissions);

  const results = [];
  for (const key of requested) {
    const block = BLOCKS[key];
    if (!block) continue;
    // The gate. A block is computed only if the caller can read its module at
    // the declared level — so an Operations Agent (read-only) receives the
    // bookings queue but never the blocks that offer to act on it.
    const grid = permissions[block.module];
    if (!grid || !grid[block.action]) continue;

    try {
      const data = await block.run();
      results.push({ key, module: block.module, label: block.label, ...data });
    } catch (error) {
      // One failing count must not blank the whole dashboard. Report the block
      // as errored so the UI can say which part is missing rather than silently
      // showing a shorter page — a missing tile looks like "you have no access".
      console.error(`[dashboard] block ${key} failed:`, error.message);
      results.push({ key, module: block.module, label: block.label, error: true });
    }
  }

  return {
    team: access.team,
    level: access.level,
    source: access.source,
    // Everything needing a human, lifted out of the blocks so the strip at the
    // top does not have to be assembled by the client.
    attention: results.filter((b) => b.attention).map((b) => ({
      key: b.key, message: b.attention, href: b.primary?.href || null,
    })),
    blocks: results,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { getSummary, BLOCKS, TEAM_LAYOUTS };
