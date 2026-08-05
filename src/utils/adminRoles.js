// Roles per the Admin Panel Access Matrix & Module Specification.
//
// IMPORTANT — integer values 1-4 are preserved from the previous 4-role
// scheme so existing `admins.role` rows keep their meaning after this
// upgrade. Renumbering would have silently re-roled every existing admin
// (e.g. a Super Admin becoming Support), so the spec's ordering is NOT the
// stored ordering. New roles are appended from 5.
//
//   1 was "Admin"       -> Platform Administrator (closest equivalent)
//   2 was "Super Admin" -> Super Administrator    (unchanged meaning)
//   3 was "Support"     -> Support Executive      (unchanged meaning)
//   4 was "Accountant"  -> Finance Manager        (unchanged meaning)
const ADMIN_ROLES = {
  PLATFORM_ADMIN: 1,
  SUPER_ADMIN: 2,
  SUPPORT_EXECUTIVE: 3,
  FINANCE_MANAGER: 4,
  OPERATIONS_MANAGER: 5,
  KYC_COMPLIANCE: 6,
  FLEET_MANAGER: 7,
  MARKETING_MANAGER: 8,
  ANALYTICS_VIEWER: 9,
  DEVELOPER_DEVOPS: 10,
};

const ADMIN_ROLE_LABELS = {
  [ADMIN_ROLES.SUPER_ADMIN]: 'Super Administrator',
  [ADMIN_ROLES.PLATFORM_ADMIN]: 'Platform Administrator',
  [ADMIN_ROLES.OPERATIONS_MANAGER]: 'Operations Manager',
  [ADMIN_ROLES.SUPPORT_EXECUTIVE]: 'Support Executive',
  [ADMIN_ROLES.FINANCE_MANAGER]: 'Finance Manager',
  [ADMIN_ROLES.KYC_COMPLIANCE]: 'KYC & Compliance',
  [ADMIN_ROLES.FLEET_MANAGER]: 'Fleet Manager',
  [ADMIN_ROLES.MARKETING_MANAGER]: 'Marketing Manager',
  [ADMIN_ROLES.ANALYTICS_VIEWER]: 'Analytics Viewer',
  [ADMIN_ROLES.DEVELOPER_DEVOPS]: 'Developer / DevOps',
};

const ADMIN_ROLE_DESCRIPTIONS = {
  [ADMIN_ROLES.SUPER_ADMIN]: 'Full platform access including RBAC, settings, security and production operations.',
  [ADMIN_ROLES.PLATFORM_ADMIN]: 'Daily platform operations excluding RBAC/security.',
  [ADMIN_ROLES.OPERATIONS_MANAGER]: 'Bookings, vehicles, hosts, users and disputes.',
  [ADMIN_ROLES.SUPPORT_EXECUTIVE]: 'Customer support with read/update limited operations.',
  [ADMIN_ROLES.FINANCE_MANAGER]: 'Payments, payouts, refunds, invoices, reports.',
  [ADMIN_ROLES.KYC_COMPLIANCE]: 'KYC, licence, fraud, document verification.',
  [ADMIN_ROLES.FLEET_MANAGER]: 'Vehicle approvals, schedules, maintenance.',
  [ADMIN_ROLES.MARKETING_MANAGER]: 'Offers, memberships, banners, notifications.',
  [ADMIN_ROLES.ANALYTICS_VIEWER]: 'Read-only reports and dashboards.',
  [ADMIN_ROLES.DEVELOPER_DEVOPS]: 'Logs, deployments, feature flags, integrations.',
};

// Display order follows the spec document, not the stored integer order.
const ADMIN_ROLE_ORDER = [
  ADMIN_ROLES.SUPER_ADMIN,
  ADMIN_ROLES.PLATFORM_ADMIN,
  ADMIN_ROLES.OPERATIONS_MANAGER,
  ADMIN_ROLES.SUPPORT_EXECUTIVE,
  ADMIN_ROLES.FINANCE_MANAGER,
  ADMIN_ROLES.KYC_COMPLIANCE,
  ADMIN_ROLES.FLEET_MANAGER,
  ADMIN_ROLES.MARKETING_MANAGER,
  ADMIN_ROLES.ANALYTICS_VIEWER,
  ADMIN_ROLES.DEVELOPER_DEVOPS,
];

module.exports = { ADMIN_ROLES, ADMIN_ROLE_LABELS, ADMIN_ROLE_DESCRIPTIONS, ADMIN_ROLE_ORDER };
