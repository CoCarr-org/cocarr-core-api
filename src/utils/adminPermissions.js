const { ADMIN_ROLES } = require('./adminRoles');

// The 18 modules from the Admin Panel Access Matrix & Module Specification.
// `key` is what's stored in `rolePermission.module` and referenced by the
// enforcement middleware; `label`/`description` are for the admin UI.
//
// `built` = this module has a real model + endpoints behind it. All 18 do
// now. Note that "built" means the admin-side CRUD works — a few modules
// store data that nothing downstream consumes yet (feature flags aren't read
// by any client, templates aren't used by the senders, API keys don't
// authenticate anything). Those caveats are surfaced in the UI itself.
const ADMIN_MODULE_LIST = [
  { key: 'dashboard',    label: 'Dashboard',          description: 'KPIs, live activity, alerts.',                 built: true },
  { key: 'users',        label: 'Users',              description: 'Customers, KYC, wallet, bookings.',            built: true },
  { key: 'hosts',        label: 'Hosts',              description: 'Host lifecycle, payouts, vehicles.',           built: true },
  { key: 'vehicles',     label: 'Vehicles',           description: 'Approvals, documents, pricing, schedules.',    built: true },
  { key: 'bookings',     label: 'Bookings',           description: 'Manage lifecycle, cancellations, disputes.',   built: true },
  { key: 'payments',     label: 'Payments',           description: 'Transactions, refunds, dues.',                 built: true },
  { key: 'payouts',      label: 'Payouts',            description: 'Host settlements and invoices.',               built: true },
  { key: 'support',      label: 'Support Center',     description: 'Tickets, live chat, escalation.',              built: true },
  { key: 'cms',          label: 'Content Management', description: 'Banners, FAQs, blogs, pages.',                 built: true },
  { key: 'marketing',    label: 'Marketing',          description: 'Coupons, memberships, referrals, notifications.', built: true },
  { key: 'reports',      label: 'Reports & Analytics', description: 'Revenue, bookings, utilisation.',             built: true },
  { key: 'auditLogs',    label: 'Audit Logs',         description: 'Every admin action.',                          built: true },
  { key: 'settings',     label: 'Settings',           description: 'Platform configuration.',                      built: true },
  { key: 'adminAccounts', label: 'Admin Accounts',    description: 'Admin users, roles, permissions.',             built: true },
  { key: 'roles',        label: 'Roles & Permissions', description: 'Role based access matrix.',                   built: true },
  { key: 'security',     label: 'Security',           description: 'Sessions, IP whitelist, MFA, API keys.',       built: true },
  { key: 'systemHealth', label: 'System Health',      description: 'Jobs, queues, webhooks, logs.',                built: true },
  { key: 'integrations', label: 'Integrations',       description: 'Payment, Firebase, Maps, Email, SMS.',         built: true },
];

const ADMIN_MODULES = ADMIN_MODULE_LIST.map((m) => m.key);

// Spec's access legend: C=Create, R=Read, U=Update, D=Delete.
const ACTIONS = ['create', 'read', 'update', 'delete'];

const NONE = { create: false, read: false, update: false, delete: false };
const R    = { create: false, read: true,  update: false, delete: false };
const RU   = { create: false, read: true,  update: true,  delete: false };
const CRUD = { create: true,  read: true,  update: true,  delete: true };

// Defaults transcribed directly from the spec's Permission Matrix table.
// Only Super/Platform/Ops/Support/Finance have columns in that table; the
// other five roles are marked DERIVED below — they are my reading of each
// role's one-line description, NOT something the spec states. Worth a review
// pass before relying on them.
const DEFAULT_PERMISSIONS = {
  // ---- From the spec table ----
  [ADMIN_ROLES.SUPER_ADMIN]: {
    dashboard: CRUD, users: CRUD, hosts: CRUD, vehicles: CRUD, bookings: CRUD,
    payments: CRUD, payouts: CRUD, support: CRUD, marketing: CRUD, settings: CRUD,
    adminAccounts: CRUD, roles: CRUD, auditLogs: CRUD,
    cms: CRUD, reports: CRUD, security: CRUD, systemHealth: CRUD, integrations: CRUD,
  },
  [ADMIN_ROLES.PLATFORM_ADMIN]: {
    dashboard: R, users: CRUD, hosts: CRUD, vehicles: CRUD, bookings: CRUD,
    payments: R, payouts: R, support: CRUD, marketing: CRUD, settings: RU,
    adminAccounts: NONE, roles: NONE, auditLogs: R,
    cms: CRUD, reports: R, security: NONE, systemHealth: R, integrations: R,
  },
  [ADMIN_ROLES.OPERATIONS_MANAGER]: {
    dashboard: R, users: CRUD, hosts: CRUD, vehicles: CRUD, bookings: CRUD,
    payments: R, payouts: R, support: CRUD, marketing: R, settings: NONE,
    adminAccounts: NONE, roles: NONE, auditLogs: R,
    cms: R, reports: R, security: NONE, systemHealth: NONE, integrations: NONE,
  },
  [ADMIN_ROLES.SUPPORT_EXECUTIVE]: {
    dashboard: R, users: RU, hosts: R, vehicles: R, bookings: RU,
    payments: R, payouts: R, support: CRUD, marketing: R, settings: NONE,
    adminAccounts: NONE, roles: NONE, auditLogs: R,
    cms: R, reports: R, security: NONE, systemHealth: NONE, integrations: NONE,
  },
  [ADMIN_ROLES.FINANCE_MANAGER]: {
    dashboard: R, users: R, hosts: R, vehicles: R, bookings: R,
    payments: CRUD, payouts: CRUD, support: R, marketing: R, settings: NONE,
    adminAccounts: NONE, roles: NONE, auditLogs: R,
    cms: NONE, reports: R, security: NONE, systemHealth: NONE, integrations: NONE,
  },

  // ---- DERIVED (not in the spec table) ----
  [ADMIN_ROLES.KYC_COMPLIANCE]: {
    dashboard: R, users: RU, hosts: RU, vehicles: R, bookings: R,
    payments: NONE, payouts: NONE, support: R, marketing: NONE, settings: NONE,
    adminAccounts: NONE, roles: NONE, auditLogs: R,
    cms: NONE, reports: R, security: NONE, systemHealth: NONE, integrations: NONE,
  },
  [ADMIN_ROLES.FLEET_MANAGER]: {
    dashboard: R, users: NONE, hosts: R, vehicles: CRUD, bookings: R,
    payments: NONE, payouts: NONE, support: R, marketing: NONE, settings: NONE,
    adminAccounts: NONE, roles: NONE, auditLogs: R,
    cms: NONE, reports: R, security: NONE, systemHealth: NONE, integrations: NONE,
  },
  [ADMIN_ROLES.MARKETING_MANAGER]: {
    dashboard: R, users: R, hosts: NONE, vehicles: NONE, bookings: NONE,
    payments: NONE, payouts: NONE, support: NONE, marketing: CRUD, settings: NONE,
    adminAccounts: NONE, roles: NONE, auditLogs: NONE,
    cms: CRUD, reports: R, security: NONE, systemHealth: NONE, integrations: NONE,
  },
  [ADMIN_ROLES.ANALYTICS_VIEWER]: {
    dashboard: R, users: R, hosts: R, vehicles: R, bookings: R,
    payments: R, payouts: R, support: R, marketing: R, settings: NONE,
    adminAccounts: NONE, roles: NONE, auditLogs: R,
    cms: R, reports: R, security: NONE, systemHealth: NONE, integrations: NONE,
  },
  [ADMIN_ROLES.DEVELOPER_DEVOPS]: {
    dashboard: R, users: NONE, hosts: NONE, vehicles: NONE, bookings: NONE,
    payments: NONE, payouts: NONE, support: NONE, marketing: NONE, settings: R,
    adminAccounts: NONE, roles: NONE, auditLogs: R,
    cms: NONE, reports: NONE, security: CRUD, systemHealth: CRUD, integrations: CRUD,
  },
};

const defaultsFor = (role, module) => DEFAULT_PERMISSIONS[role]?.[module] || NONE;

module.exports = {
  ADMIN_MODULE_LIST,
  ADMIN_MODULES,
  ACTIONS,
  DEFAULT_PERMISSIONS,
  defaultsFor,
};
