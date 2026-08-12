const express = require('express');
const { authenticateAdmin } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const c = require('../controllers/adminModulesController');
const e = require('../controllers/adminExtraController');
const tc = require('../controllers/adminTeamController');

const router = express.Router();

// ── Dashboard ──
// Gated on `dashboard.read` for ACCESS to the endpoint; each block inside is
// then gated on its OWN module, so a caller never receives counts drawn from a
// module they cannot open. Gating only here would leak exactly what a per-team
// portal exists to partition.
const dashboardSummary = require('../services/dashboardSummaryService');
router.get('/dashboard/summary', authenticateAdmin, requirePermission('dashboard', 'read'),
  async (req, res) => {
    try {
      res.status(200).json(await dashboardSummary.getSummary(req.admin));
    } catch (error) {
      console.error('[dashboard/summary]', error);
      res.status(500).json({ error: 'Could not load the dashboard' });
    }
  });

// ── Who am I? ──
// Deliberately NOT behind requirePermission: every authenticated admin must be
// able to ask what they may do, and gating that on a module would mean an admin
// with no permissions could not even be told so.
const adminMe = require('../controllers/adminMeController');
router.get('/me', authenticateAdmin, adminMe.me);

// ── Teams & Access (RBAC management by Super Admin) ──
// Gated on the `roles` module — by default only Super Admin has it. Literal
// paths (/teams/modules) are declared before /teams/:id so they aren't matched
// as an id.
router.get   ('/teams/modules',                          authenticateAdmin, requirePermission('roles','read'),   tc.modules);
router.get   ('/teams',                                  authenticateAdmin, requirePermission('roles','read'),   tc.list);
router.post  ('/teams',                                  authenticateAdmin, requirePermission('roles','create'), tc.create);
router.get   ('/teams/:id',                              authenticateAdmin, requirePermission('roles','read'),   tc.get);
router.put   ('/teams/:id',                              authenticateAdmin, requirePermission('roles','update'), tc.update);
router.delete('/teams/:id',                              authenticateAdmin, requirePermission('roles','delete'), tc.remove);
router.post  ('/teams/:id/levels',                       authenticateAdmin, requirePermission('roles','update'), tc.addLevel);
router.put   ('/teams/:id/levels/:levelId',              authenticateAdmin, requirePermission('roles','update'), tc.updateLevel);
router.delete('/teams/:id/levels/:levelId',              authenticateAdmin, requirePermission('roles','update'), tc.deleteLevel);
router.put   ('/teams/:id/levels/:levelId/permissions',  authenticateAdmin, requirePermission('roles','update'), tc.setPermissions);

// The modules from the Access Matrix spec that had no backend before.
//
// Mounted at /admin BEFORE adminRouter (see rootRouter.js) — adminRouter
// ends with catch-all '/:id' handlers that would otherwise swallow every
// path below.
//
// Each route is gated on the same permission matrix as the rest of /admin;
// enforcement stays governed by RBAC_ENFORCE.

// ── Support Center ──
router.get   ('/tickets',              authenticateAdmin, requirePermission('support','read'),   c.listTickets);
router.post  ('/tickets',              authenticateAdmin, requirePermission('support','create'), c.createTicket);
router.get   ('/tickets/:id',          authenticateAdmin, requirePermission('support','read'),   c.getTicket);
router.put   ('/tickets/:id',          authenticateAdmin, requirePermission('support','update'), c.updateTicket);
router.delete('/tickets/:id',          authenticateAdmin, requirePermission('support','delete'), c.deleteTicket);
router.post  ('/tickets/:id/messages', authenticateAdmin, requirePermission('support','update'), c.addTicketMessage);

// ── Content Management ──
router.get   ('/banners',      authenticateAdmin, requirePermission('cms','read'),   c.banners.list);
router.post  ('/banners',      authenticateAdmin, requirePermission('cms','create'), c.banners.create);
router.get   ('/banners/:id',  authenticateAdmin, requirePermission('cms','read'),   c.banners.get);
router.put   ('/banners/:id',  authenticateAdmin, requirePermission('cms','update'), c.banners.update);
router.delete('/banners/:id',  authenticateAdmin, requirePermission('cms','delete'), c.banners.remove);

router.get   ('/faqs',         authenticateAdmin, requirePermission('cms','read'),   c.faqs.list);
router.post  ('/faqs',         authenticateAdmin, requirePermission('cms','create'), c.faqs.create);
router.get   ('/faqs/:id',     authenticateAdmin, requirePermission('cms','read'),   c.faqs.get);
router.put   ('/faqs/:id',     authenticateAdmin, requirePermission('cms','update'), c.faqs.update);
router.delete('/faqs/:id',     authenticateAdmin, requirePermission('cms','delete'), c.faqs.remove);

// Pages covers both CMS pages and Settings > Legal Pages (?type=legal).
router.get   ('/pages',        authenticateAdmin, requirePermission('cms','read'),   c.pages.list);
router.post  ('/pages',        authenticateAdmin, requirePermission('cms','create'), c.pages.create);
router.get   ('/pages/:id',    authenticateAdmin, requirePermission('cms','read'),   c.pages.get);
router.put   ('/pages/:id',    authenticateAdmin, requirePermission('cms','update'), c.pages.update);
router.delete('/pages/:id',    authenticateAdmin, requirePermission('cms','delete'), c.pages.remove);

// ── Reports & Analytics ──
router.get('/reports', authenticateAdmin, requirePermission('reports','read'), c.getReports);

// ── System Health ──
router.get('/system-health', authenticateAdmin, requirePermission('systemHealth','read'), c.getSystemHealth);
router.get('/webhook-logs',  authenticateAdmin, requirePermission('systemHealth','read'), c.listWebhookLogs);

// ── Integrations ──
router.get('/integrations', authenticateAdmin, requirePermission('integrations','read'), c.getIntegrations);

// ── Security ──
router.get   ('/api-keys',            authenticateAdmin, requirePermission('security','read'),   c.listApiKeys);
router.post  ('/api-keys',            authenticateAdmin, requirePermission('security','create'), c.createApiKey);
router.delete('/api-keys/:id',        authenticateAdmin, requirePermission('security','delete'), c.revokeApiKey);
router.get   ('/ip-whitelist',        authenticateAdmin, requirePermission('security','read'),   c.ipWhitelist.list);
router.post  ('/ip-whitelist',        authenticateAdmin, requirePermission('security','create'), c.ipWhitelist.create);
router.put   ('/ip-whitelist/:id',    authenticateAdmin, requirePermission('security','update'), c.ipWhitelist.update);
router.delete('/ip-whitelist/:id',    authenticateAdmin, requirePermission('security','delete'), c.ipWhitelist.remove);
router.get   ('/login-history',       authenticateAdmin, requirePermission('security','read'),   c.listLoginHistory);

// ── Platform settings groups ──
router.get('/platform-settings/:group', authenticateAdmin, requirePermission('settings','read'),   c.getSettingsGroup);
router.put('/platform-settings/:group', authenticateAdmin, requirePermission('settings','update'), c.updateSettingsGroup);

// ── Settings-backed modules ──
router.get   ('/feature-flags',       authenticateAdmin, requirePermission('settings','read'),   c.featureFlags.list);
router.post  ('/feature-flags',       authenticateAdmin, requirePermission('settings','create'), c.featureFlags.create);
router.put   ('/feature-flags/:id',   authenticateAdmin, requirePermission('settings','update'), c.featureFlags.update);
router.delete('/feature-flags/:id',   authenticateAdmin, requirePermission('settings','delete'), c.featureFlags.remove);

router.get   ('/templates',           authenticateAdmin, requirePermission('settings','read'),   c.messageTemplates.list);
router.post  ('/templates',           authenticateAdmin, requirePermission('settings','create'), c.messageTemplates.create);
router.put   ('/templates/:id',       authenticateAdmin, requirePermission('settings','update'), c.messageTemplates.update);
router.delete('/templates/:id',       authenticateAdmin, requirePermission('settings','delete'), c.messageTemplates.remove);


// ── Bookings > Disputes ──
router.get   ('/disputes',     authenticateAdmin, requirePermission('bookings','read'),   e.disputes.list);
router.post  ('/disputes',     authenticateAdmin, requirePermission('bookings','create'), e.disputes.create);
router.get   ('/disputes/:id', authenticateAdmin, requirePermission('bookings','read'),   e.disputes.get);
router.put   ('/disputes/:id', authenticateAdmin, requirePermission('bookings','update'), e.disputes.update);
router.delete('/disputes/:id', authenticateAdmin, requirePermission('bookings','delete'), e.disputes.remove);

// ── Finance > Settlements ──
const stl = require('../services/settlementService');
const settle = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) console.error('[settlement]', error);
    res.status(status).json({ error: error.message });
  }
};
router.get ('/settlements',            authenticateAdmin, requirePermission('payouts','read'),   settle((req) => stl.listSettlements(req.query)));
router.get ('/settlements/window',     authenticateAdmin, requirePermission('payouts','read'),   settle(() => stl.getSettlementWindow()));
router.get ('/settlements/:id',        authenticateAdmin, requirePermission('payouts','read'),   settle((req) => stl.getSettlement(req.params.id)));
router.post('/settlements/:id/retry',  authenticateAdmin, requirePermission('payouts','update'), settle((req) => stl.retrySettlement(req.params.id, req.admin)));
// Manual trigger. dryRun=true reports what WOULD be paid without creating
// records or moving money — always run that first.
router.post('/settlements/run',        authenticateAdmin, requirePermission('payouts','update'),
  settle((req) => stl.runWeeklySettlement({
    reference: req.body.reference, dryRun: req.body.dryRun === true, admin: req.admin,
  })));

// ── Users > KYC Verification queue (PRD: Signup & KYC) ──
const uv = require('../services/userVerificationService');
// Declared here rather than lower down: the user-verification routes below
// reference it, and relying on the closure to defer evaluation past a later
// const is a TDZ trap waiting for someone to inline one of these handlers.
const docs = require('../services/documentService');
const verify = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) console.error('[user-verification]', error);
    res.status(status).json({ error: error.message });
  }
};
// Registered ABOVE '/user-verification/:id' — otherwise Express matches
// "overview" as an id and hands it to getForReview, which 404s.
router.get ('/user-management/overview',         authenticateAdmin, requirePermission('users','read'),   verify(() => uv.managementOverview()));
// User Management > Referrals — who referred whom, and points earned.
router.get ('/user-referrals',                   authenticateAdmin, requirePermission('users','read'),   e.listUserReferrals);
// A single user's full referral picture (code, referred users + state, wallet txns).
router.get ('/user-referrals/:userId',           authenticateAdmin, requirePermission('users','read'),   e.getUserReferralDetail);

// ── Finance > Wallet Transactions ──
// The ledger, plus the trace behind any one row: which user, which referral,
// which campaign, and who the other side was. Gated on `payments` because this
// is money movement, not user administration.
//
// The two `/wallet/user/:userId/...` paths are registered ABOVE
// '/wallet-transactions/:id' purely because they read better; they cannot
// actually collide (different prefixes), unlike the ordering hazards elsewhere
// in this file.
const walletAdmin = require('../controllers/walletAdminController');
router.get('/wallet/user/:userId',           authenticateAdmin, requirePermission('payments','read'), walletAdmin.getUserWallet);
router.get('/wallet/user/:userId/referrals', authenticateAdmin, requirePermission('users','read'),    walletAdmin.getUserReferrals);
router.get('/wallet-transactions',           authenticateAdmin, requirePermission('payments','read'), walletAdmin.listTransactions);
router.get('/wallet-transactions/:id',       authenticateAdmin, requirePermission('payments','read'), walletAdmin.getTransaction);
router.get ('/user-verification',                authenticateAdmin, requirePermission('users','read'),   verify((req) => uv.listForReview(req.query)));
router.post('/user-verification/:id/approve',    authenticateAdmin, requirePermission('users','update'), verify((req) => uv.approve(req.params.id, req.admin)));
router.post('/user-verification/:id/reject',     authenticateAdmin, requirePermission('users','update'), verify((req) => uv.reject(req.params.id, req.body.reason, req.admin)));
router.post('/user-verification/:id/searchable', authenticateAdmin, requirePermission('users','update'), verify((req) => uv.setSearchable(req.params.id, req.body.searchable, req.admin)));
// Suspend / reactivate — an access decision, not a re-review.
router.post('/user-verification/:id/suspend', authenticateAdmin, requirePermission('users','update'),
  verify((req) => uv.setSuspension(req.params.id, req.body.suspended !== false, req.body.reason, req.admin)));
// Per-user review screen: full detail, provider re-check, and per-document decisions.
router.get ('/user-verification/:id',                   authenticateAdmin, requirePermission('users','read'),   verify((req) => uv.getForReview(req.params.id)));
router.post('/user-verification/:id/recheck/:type',     authenticateAdmin, requirePermission('users','update'), verify((req) => uv.recheckDocument(req.params.id, req.params.type, req.admin)));
// Re-reads the stored SCAN through OCR. Different from /recheck/:type, which
// re-queries the licence registry by number.
const onboardingDocs = require('../services/onboardingDocumentService');
router.post('/user-verification/:id/ocr/:kind', authenticateAdmin, requirePermission('users','update'),
  verify((req) => onboardingDocs.reRunOcr(req.params.id, req.params.kind)));
router.post('/user-verification/:id/document/:docType', authenticateAdmin, requirePermission('users','update'),
  verify((req) => docs.setUserDocumentStatus(req.params.id, req.params.docType, req.body.verified, req.admin, req.body.reason)));

// ── Verification sections: one vocabulary for all three chains ─────────────
//
// `POST .../section/:section` with `{ decision, reason }` where decision is
// verified | unverified | rejected. See services/verificationSections.js.
//
// This SUPERSEDES the boolean `/document/:docType` route above, which is left in
// place because the current ops UI still calls it. That one cannot express an
// unverify: it maps `verified: false` onto a REJECTION carrying the filler reason
// "Verification withdrawn by admin", so an admin undoing a mis-click sends the
// user a rejection they then have to act on. Point new UI at this route and
// retire that one once nothing calls it.
const sections = require('../services/verificationSections');
const hostVerification = require('../services/hostVerificationService');

router.get('/user-verification/:id/sections', authenticateAdmin, requirePermission('users','read'),
  verify((req) => sections.chainState('user', req.params.id)));
router.post('/user-verification/:id/section/:section', authenticateAdmin, requirePermission('users','update'),
  verify((req) => sections.applyDecision('user', req.params.id, req.params.section, req.body.decision, req.admin, req.body.reason)));

// ── Host verification (its own chain: PAN + bank + KYC) ────────────────────
//
// Gated on `payouts` rather than `users`: this decides whether somebody can be
// PAID, which is a finance judgement, and the team that reviews a driving licence
// is not necessarily the team that should be clearing a bank account.
router.get('/host-verification/:id', authenticateAdmin, requirePermission('payouts','read'),
  verify((req) => hostVerification.getReviewState(req.params.id)));
router.post('/host-verification/:id/section/:section', authenticateAdmin, requirePermission('payouts','update'),
  verify((req) => hostVerification.reviewSection(req.params.id, req.params.section, req.body.decision, req.admin, req.body.reason)));
router.post('/host-verification/:id/decision', authenticateAdmin, requirePermission('payouts','update'),
  verify((req) => hostVerification.setVerification(req.params.id, req.body.decision, req.admin, req.body.reason)));

// ── Vehicle verification sections (photos + RC + physical visit) ───────────
//
// The physical visit is deliberately NOT settleable through this route — it is
// recorded item by item with photographs on the existing physical-check
// endpoint, because a single "visit verified" button would let somebody tick off
// a site visit they never made.
router.get('/vehicle-verification/:id/sections', authenticateAdmin, requirePermission('vehicles','read'),
  verify((req) => sections.chainState('vehicle', req.params.id)));
router.post('/vehicle-verification/:id/section/:section', authenticateAdmin, requirePermission('vehicles','update'),
  verify((req) => sections.applyDecision('vehicle', req.params.id, req.params.section, req.body.decision, req.admin, req.body.reason)));

// ── Policies (read-only review catalogue) ──
// Descriptive, not a config store: it reports where each rule actually lives
// and flags the ones that are inconsistent or unenforced.
const policies = require('../services/policyService');
router.get('/policies', authenticateAdmin, requirePermission('settings','read'), async (req, res) => {
  try { res.json(await policies.listPolicies()); }
  catch (error) { console.error('[policies]', error); res.status(500).json({ error: error.message }); }
});

// ── Operations > Damage Claims ──
// Hosts file these from the app; there was no admin-side view of them before,
// only per-booking lookups behind authenticateUser.
const dmg = require('../services/adminDamageService');
const damage = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) console.error('[damage]', error);
    res.status(status).json({ error: error.message });
  }
};
router.get('/damages',     authenticateAdmin, requirePermission('bookings','read'),   damage((req) => dmg.listDamages(req.query)));
router.get('/damages/:id', authenticateAdmin, requirePermission('bookings','read'),   damage((req) => dmg.getDamage(req.params.id)));
router.put('/damages/:id', authenticateAdmin, requirePermission('bookings','update'), damage((req) => dmg.updateDamage(req.params.id, req.body, req.admin)));
// Two-step flow: verify the photos, then the assessment team prices it.
router.post('/damages/:id/verify', authenticateAdmin, requirePermission('bookings','update'),
  damage((req) => dmg.verifyDamage(req.params.id, req.body, req.admin)));
router.post('/damages/:id/assess', authenticateAdmin, requirePermission('bookings','update'),
  damage((req) => dmg.assessDamage(req.params.id, req.body, req.admin)));

// ── Finance > Refunds (rider) ──
// Distinct from /settlements, which pays hosts. This returns rider deposits.
const rfd = require('../services/refundService');
const refund = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) console.error('[refund]', error);
    res.status(status).json({ error: error.message });
  }
};
router.get ('/refunds',              authenticateAdmin, requirePermission('payments','read'),   refund((req) => rfd.listRefundRequests(req.query)));
router.get ('/refunds/:id',          authenticateAdmin, requirePermission('payments','read'),   refund((req) => rfd.getRefundRequest(req.params.id)));
router.put ('/refunds/:id',          authenticateAdmin, requirePermission('payments','update'), refund((req) => rfd.reviewRefundRequest(req.params.id, req.body, req.admin)));
router.post('/refunds/:id/reject',   authenticateAdmin, requirePermission('payments','update'), refund((req) => rfd.rejectRefundRequest(req.params.id, req.body.reason, req.admin)));
// Irreversible: sends the money.
router.post('/refunds/:id/process',  authenticateAdmin, requirePermission('payments','update'), refund((req) => rfd.processRefund(req.params.id, req.admin)));
// Manual trigger for the daily eligibility job; dryRun reports without writing.
router.post('/refunds/build',        authenticateAdmin, requirePermission('payments','update'),
  refund((req) => rfd.buildRefundList({ reference: req.body.reference, dryRun: req.body.dryRun === true, admin: req.admin })));

// ── Content > Media Library ──
router.get   ('/media',        authenticateAdmin, requirePermission('cms','read'),   e.media.list);
router.post  ('/media',        authenticateAdmin, requirePermission('cms','create'), e.media.create);
router.put   ('/media/:id',    authenticateAdmin, requirePermission('cms','update'), e.media.update);
router.delete('/media/:id',    authenticateAdmin, requirePermission('cms','delete'), e.media.remove);

// ── Marketing ──
router.get   ('/announcements',      authenticateAdmin, requirePermission('marketing','read'),   e.announcements.list);
router.post  ('/announcements',      authenticateAdmin, requirePermission('marketing','create'), e.announcements.create);
router.put   ('/announcements/:id',  authenticateAdmin, requirePermission('marketing','update'), e.announcements.update);
router.delete('/announcements/:id',  authenticateAdmin, requirePermission('marketing','delete'), e.announcements.remove);

router.get   ('/push-campaigns',          authenticateAdmin, requirePermission('marketing','read'),   e.pushCampaigns.list);
router.post  ('/push-campaigns',          authenticateAdmin, requirePermission('marketing','create'), e.pushCampaigns.create);
router.put   ('/push-campaigns/:id',      authenticateAdmin, requirePermission('marketing','update'), e.pushCampaigns.update);
router.delete('/push-campaigns/:id',      authenticateAdmin, requirePermission('marketing','delete'), e.pushCampaigns.remove);
router.post  ('/push-campaigns/:id/send', authenticateAdmin, requirePermission('marketing','update'), e.sendPushCampaign);

router.get('/referrals', authenticateAdmin, requirePermission('marketing','read'), e.listReferrals);

// ── Marketing > Referral module (analytics, campaign config, moderation) ──
// Specific paths before '/referrals/:id/...' so they aren't shadowed.
const ref = require('../controllers/referralAdminController');
router.get ('/referral-analytics',      authenticateAdmin, requirePermission('marketing','read'),   ref.analytics);
router.get ('/referral-campaigns',      authenticateAdmin, requirePermission('marketing','read'),   ref.listCampaigns);
router.post('/referral-campaigns',      authenticateAdmin, requirePermission('marketing','create'), ref.createCampaign);
router.put ('/referral-campaigns/:id',  authenticateAdmin, requirePermission('marketing','update'), ref.updateCampaign);
router.post('/referrals/:id/block',     authenticateAdmin, requirePermission('marketing','update'), ref.blockReferral);
router.post('/referrals/:id/reverse',   authenticateAdmin, requirePermission('marketing','update'), ref.reverseReward);

// ── Marketing > Email/SMS Campaigns ──
// '/campaigns/segments' and '/audience-preview' MUST stay above '/campaigns/:id',
// or Express matches 'segments' as an id.
const cmp = require('../controllers/campaignController');
router.get ('/campaigns/segments',      authenticateAdmin, requirePermission('marketing','read'),   cmp.segments);
router.post('/campaigns/audience-preview', authenticateAdmin, requirePermission('marketing','read'), cmp.preview);
router.get   ('/campaigns',             authenticateAdmin, requirePermission('marketing','read'),   cmp.list);
router.post  ('/campaigns',             authenticateAdmin, requirePermission('marketing','create'), cmp.create);
router.get   ('/campaigns/:id',         authenticateAdmin, requirePermission('marketing','read'),   cmp.get);
router.put   ('/campaigns/:id',         authenticateAdmin, requirePermission('marketing','update'), cmp.update);
router.delete('/campaigns/:id',         authenticateAdmin, requirePermission('marketing','delete'), cmp.remove);
// Sending is the irreversible one — gated on update, not read.
router.post  ('/campaigns/:id/send',    authenticateAdmin, requirePermission('marketing','update'), cmp.send);

// ── Finance ──
router.get('/refunds',  authenticateAdmin, requirePermission('payments','read'), e.listRefunds);
router.get('/payouts',  authenticateAdmin, requirePermission('payouts','read'),  e.listPayouts);
router.get('/invoices', authenticateAdmin, requirePermission('payments','read'), e.listInvoices);

// ── Identity documents & bank details ──
// Aadhaar/PAN numbers are masked server-side by documentService — these
// endpoints never return a full regulated identifier.
const doc = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) console.error('[documents]', error);
    res.status(status).json({ error: error.message });
  }
};

// Users > KYC & Documents (Aadhaar, PAN, licence)
router.get ('/user-documents', authenticateAdmin, requirePermission('users','read'),   doc((req) => docs.listUserDocuments(req.query)));
router.put ('/user-documents/:id/:docType', authenticateAdmin, requirePermission('users','update'),
  doc((req) => docs.setUserDocumentStatus(req.params.id, req.params.docType, req.body.verified, req.admin, req.body.reason)));

// Vehicles > RC Details
router.get ('/vehicle-rc',        authenticateAdmin, requirePermission('vehicles','read'),   doc((req) => docs.listVehicleRc(req.query)));
router.put ('/vehicle-rc/:id',    authenticateAdmin, requirePermission('vehicles','update'), doc((req) => docs.setVehicleRcStatus(req.params.id, req.body.verified, req.admin, req.body.reason)));

// Finance > Host Bank Accounts
router.get ('/host-bank-accounts',     authenticateAdmin, requirePermission('payouts','read'),   doc((req) => docs.listHostBankAccounts(req.query)));
router.put ('/host-bank-accounts/:id', authenticateAdmin, requirePermission('payouts','update'), doc((req) => docs.setHostBankVerification(req.params.id, req.body.verified, req.admin)));

// ── Vehicles / Hosts detail views ──
router.get('/vehicle-pricing',   authenticateAdmin, requirePermission('vehicles','read'), e.listVehiclePricing);
router.get('/vehicle-documents', authenticateAdmin, requirePermission('vehicles','read'), e.listVehicleDocuments);
router.get('/host-documents',    authenticateAdmin, requirePermission('hosts','read'),    e.listHostDocuments);

// ── Support > Feedback ──
router.get('/feedback', authenticateAdmin, requirePermission('support','read'), e.listFeedback);

// ── Dashboard / Reports / Developer (derived) ──
router.get('/system-alerts',       authenticateAdmin, requirePermission('dashboard','read'),    e.getSystemAlerts);
router.get('/reports/operational', authenticateAdmin, requirePermission('reports','read'),      e.getOperationalReport);
router.get('/reports/customer',    authenticateAdmin, requirePermission('reports','read'),      e.getCustomerReport);
router.get('/reports/exports',     authenticateAdmin, requirePermission('reports','read'),      e.getExportTargets);

// Driver + custom report builder.
const rb = require('../services/reportBuilderService');
const report = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) console.error('[reports]', error);
    res.status(status).json({ error: error.message });
  }
};
router.get ('/reports/driver',        authenticateAdmin, requirePermission('reports','read'), report((req) => rb.getDriverReport(req.query)));
router.get ('/reports/custom/schema', authenticateAdmin, requirePermission('reports','read'), report(() => rb.getReportSchema()));
router.post('/reports/custom/run',    authenticateAdmin, requirePermission('reports','read'), report((req) => rb.runCustomReport(req.body)));
router.get('/background-jobs',     authenticateAdmin, requirePermission('systemHealth','read'), e.getBackgroundJobs);
router.get('/api-logs',            authenticateAdmin, requirePermission('systemHealth','read'), e.listApiLogs);

module.exports = router;
