// Import Express
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const hostPayoutAccountModel = require('./src/models/hostPayoutAccount.js')
const hostCommissionModel = require('./src/models/hostCommission.js')
const bookingModel = require('./src/models/booking.js')
const ProtectionPlan = require('./src/models/protectionplan.js');
const damageModel = require('./src/models/damage.js')
const rescheduleModel = require('./src/models/reschedule.js')
const settingsModel = require('./src/models/settings.js')
const transactionModel = require('./src/models/transaction.js')
const vehicleModel = require('./src/models/vehicle.js')
const vehiclePhysicalVerificationModel = require('./src/models/vehiclePhysicalVerification.js')
const fcmTokenModel = require('./src/models/fcmTokens.js')
const imageModel = require('./src/models/image')
const vehiclePreferenceModel = require('./src/models/vehiclePreference.js');
const scheduleModel = require('./src/models/schedule.js')
const scheduleBlockModel = require('./src/models/scheduleBlock.js')
const membershipModel = require('./src/models/membership.js')
const membershipTypeModel = require('./src/models/membershiptype.js')
const walletTransactionModel = require('./src/models/wallettransaction.js')
const walletModel = require('./src/models/wallet.js')
const offerModel = require('./src/models/offer.js')
const offerUsageModel = require('./src/models/offerUsage.js')
const pickupModel = require('./src/models/pickuppoint')
const userModel = require('./src/models/user')
const cityModel = require('./src/models/city.js')
const vendorModel = require('./src/models/vendor')
const adminModel = require('./src/models/admin')
const brandModel = require('./src/models/brand')
const modelModel = require('./src/models/model')
const vehicleplanModel = require('./src/models/vehicleplan')
const refundModel = require('./src/models/refund.js')
const reviewModel = require('./src/models/review.js')
const dueModel = require('./src/models/due.js')
const hostReviewModel = require('./src/models/hostReview.js')
const hostModel = require('./src/models/host.js')
const associationModel = require('./src/models/association.js')
// Models added after the original set. Required explicitly so they are
// registered on the sequelize instance BEFORE db.sync runs below — relying on
// a service-require chain to pull them in is fragile, and a model that isn't
// registered simply never gets its table created.
const settlementModel = require('./src/models/settlement.js')
const refundRequestModel = require('./src/models/refundRequest.js')
const kycDocumentModel = require('./src/models/kycDocument.js')
const panCardModel = require('./src/models/panCard.js')
const drivingLicenceModel = require('./src/models/drivingLicence.js')
const vehicleRcDocumentModel = require('./src/models/vehicleRcDocument.js')
const otherDocumentModel = require('./src/models/otherDocument.js')
const campaignModel = require('./src/models/campaign.js')
const disputeModel = require('./src/models/dispute.js')
const ticketModel = require('./src/models/ticket.js')
const ticketMessageModel = require('./src/models/ticketMessage.js')
const bannerModel = require('./src/models/banner.js')
const faqModel = require('./src/models/faq.js')
const pageModel = require('./src/models/page.js')
const featureFlagModel = require('./src/models/featureFlag.js')
const apiKeyModel = require('./src/models/apiKey.js')
const ipWhitelistModel = require('./src/models/ipWhitelist.js')
const loginHistoryModel = require('./src/models/loginHistory.js')
const webhookLogModel = require('./src/models/webhookLog.js')
const messageTemplateModel = require('./src/models/messageTemplate.js')
const mediaAssetModel = require('./src/models/mediaAsset.js')
const announcementModel = require('./src/models/announcement.js')
const pushCampaignModel = require('./src/models/pushCampaign.js')
const apiLogModel = require('./src/models/apiLog.js')
const platformSettingModel = require('./src/models/platformSetting.js')
const activityLogModel = require('./src/models/activityLog.js')
const rolePermissionModel = require('./src/models/rolePermission.js')
const adminTeamModel = require('./src/models/adminTeam.js')
const adminTeamLevelModel = require('./src/models/adminTeamLevel.js')
const adminTeamPermissionModel = require('./src/models/adminTeamPermission.js')

const { loadEmailListeners } = require('./src/subscribers/emailSubscriber.js');
const { loadNotificationListeners, sendBookingConfirmationNotification } = require('./src/subscribers/notificationSubscriber.js');
const { loadReferralListeners } = require('./src/subscribers/referralSubscriber.js');
const eventEmitter = require('./src/utils/eventEmitter.js');
const { initializePayoutScheduler } = require('./src/utils/payoutScheduler.js');
const { initializeSettlementScheduler } = require('./src/utils/settlementScheduler.js');
const { initializeRefundScheduler } = require('./src/utils/refundScheduler.js');

const db = require('./src/configs/db.js');
const bodyParser = require('body-parser');
const { errorHandlerMiddleware } = require('./src/middlewares/error.js');
const { addDefaultSettings } = require('./src/services/settingsService.js');
const { addDefaultCities } = require('./src/services/cityService.js');
const { addDefaultBrands } = require('./src/services/brandService.js');
const { addDefaultProtectionPlan } = require('./src/services/protectionPlanService.js');
const { addDefaultMembershipType } = require('./src/services/membershipTypeService.js');
const { sendNotification } = require('./src/services/fcmService.js');
const { logOutboundIp } = require('./src/utils/kycHttp.js');
const { ensureBootstrapSuperAdmin } = require('./src/services/bootstrapAdminService.js');
const { seedAdminTeams } = require('./src/services/adminTeamService.js');
const app = express();

// Keep the server alive if the DB (or another async dependency) fails.
// A failed DB connection should degrade the service, not crash-loop it.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

// Run schema sync first, then seed — so seeding doesn't race db.sync({alter}).
//
// IMPORTANT: this used to swallow the error with console.log, which made a
// FAILED sync look like a normal boot. When alter-sync throws partway through,
// every model after the failure point never gets its table — that is exactly
// how "Table 'railway.settlements' doesn't exist" happens at runtime while the
// server appears healthy. Fail loudly instead.
// Classify the connection BEFORE sync. `Unknown database 'cocarr_core'` is a
// completely different problem from a partial alter-sync, and reporting it as
// the latter sends whoever reads the log looking for a bad model. Never throws.
const { mountVersions } = require('./src/routes/apiVersions');
const { preflight } = require('./src/configs/dbPreflight');

const { status: migrationStatus } = require('./src/db/migrator');

// THE SERVICE NO LONGER CHANGES THE SCHEMA. Migrations do, as a release step
// (`npm run migrate:up`), before the new revision takes traffic.
//
// This is the largest schema on the platform — 75 tables, 64 foreign keys — and
// the one with the most to lose. db.sync({alter:true}) rewrote every one of them
// on every boot: dropping any column no longer declared on a model, aborting the
// whole pass on one bad foreign key (leaving every later model with no table),
// and accumulating indexes toward MySQL's 64-key limit. All three have caused
// incidents here.
//
// Boot now only REPORTS drift, and `dbReady` still gates the seeding steps below
// so they never race an unmigrated schema. Development can use DB_SYNC=true.
const dbReady = preflight(db, console)
  .then(async ({ ok }) => {
    if (!ok) return; // already reported, in detail, by the preflight

    if (process.env.DB_SYNC === 'true' && process.env.NODE_ENV !== 'production') {
      console.warn('DB_SYNC=true — using db.sync({alter:true}). Development only; never in production.');
      await db.sync({ alter: true });
      console.log('Schema sync done (DB_SYNC).');
      return;
    }

    const { executed, pending } = await migrationStatus();
    if (pending.length) {
      console.error('!!! PENDING MIGRATIONS — THIS REVISION IS RUNNING AGAINST AN OLD SCHEMA !!!');
      console.error(`  pending (${pending.length}): ${pending.join(', ')}`);
      console.error('  Run `npm run migrate:up` as a release step BEFORE this revision takes traffic.');
      return;
    }
    console.log(`Schema up to date — ${executed.length} migration(s) applied.`);
  })
  .catch((err) => {
    console.error(`Could not determine migration status: ${err?.parent?.sqlMessage || err?.message || err}`);
  });

// Each step is independent: a failure in one must not skip the others.
async function runStep(label, fn) {
  try {
    await fn();
    console.log(`${label} done.`);
  } catch (error) {
    console.error(`${label} failed:`, error);
  }
}

async function initialize() {
  // Print the server's outbound IP up front — it's what Cashfree checks against
  // its allowlist, and on Railway it changes between deploys.
  await runStep('Outbound IP', logOutboundIp);

  await dbReady;

  // FIRST thing after the schema is ready: guarantee the break-glass super
  // admin exists and can be signed in to. Runs before seeding/schedulers so a
  // fresh deploy is administrable as early as possible, and so this critical
  // step can't be skipped by a failure in a later, unrelated step. This is NOT
  // a Firebase backfill — it touches exactly one row, the bootstrap super admin.
  await runStep('Bootstrap super admin', async () => {
    await db.authenticate();
    await ensureBootstrapSuperAdmin();
  });

  // Seed the admin teams (Super Admin, Admin, Customer Support, Operations,
  // Finance, Marketing, Developer) with their levels + permission grids, and
  // migrate any existing admin onto the team matching its legacy role.
  // Idempotent: never overwrites a Super Admin's grid edits.
  await runStep('Admin teams', async () => seedAdminTeams());

  // Boot-time seeding of reference data (fee settings, cities, brands).
  //
  // Idempotent (findOrCreate), so it never overwrites edits — but it DOES
  // re-insert anything deleted, which is why a wiped database quietly refills
  // with the default city/brand list on the next restart. Set
  // SEED_DEFAULTS=false to stop that.
  //
  // Careful: with seeding off AND the tables emptied, there are no cities (so
  // nothing is bookable) and no fee settings (so every fee reads as zero).
  if (process.env.SEED_DEFAULTS === 'false') {
    console.log('⏭️  Default seeding skipped (SEED_DEFAULTS=false) — no settings/cities/brands will be created.');
  } else {
    await runStep('Default settings', addDefaultSettings);
    await runStep('Default cities', addDefaultCities);
    await runStep('Default brands', addDefaultBrands);
    // Both are config that nothing else creates. Without an ACTIVE protection
    // plan `initiateBooking` throws, so a database with no plan is not
    // bookable at all — that is why this is seeded rather than left to an
    // admin to remember.
    await runStep('Default protection plan', addDefaultProtectionPlan);
    await runStep('Default membership type', addDefaultMembershipType);
    // Seeds the (default-off) vehicle physical-verification feature flag so it
    // is visible and toggleable in the Feature Flags screen from day one.
    await runStep('Vehicle feature flags', require('./src/services/vehicleReviewService.js').ensureDefaultFlag);
    // Seeds the KYC/OCR provider bypass flag, DEFAULT OFF, so it is visible and
    // switchable in the Feature Flags screen without anybody having to know the
    // key. findOrCreate — a redeploy never changes a flag an admin has set.
    await runStep('Verification bypass flag', require('./src/utils/verificationBypass.js').ensureBypassFlag);
  }
  await runStep('Payout scheduler', async () => initializePayoutScheduler());
  // Weekly host settlement. Gated behind SETTLEMENT_CRON_ENABLED so deploying
  // this code does not by itself start moving money on a timer.
  await runStep('Settlement scheduler', async () => initializeSettlementScheduler());
  // Daily refund eligibility. Safe to run by default — it only builds the
  // review list, it never moves money.
  await runStep('Refund scheduler', async () => initializeRefundScheduler());
}

// sendNotification({title:'Your Booking is Confirmed',body:'Your Audi X3 Car Booking is Confirmed with booking id #MYA5J8',payload:{test:'test'}},1);
// sendBookingConfirmationNotification({bookingId:'m8rfrpur'});

loadEmailListeners(eventEmitter);
loadNotificationListeners(eventEmitter);
loadReferralListeners(eventEmitter);
initialize();
// ── CORS ──
// `CORS_ORIGINS` is a comma-separated allowlist. Unset means allow everything,
// which is what this was before and what keeps a deploy from breaking the day
// this merges — but it logs loudly, because open CORS is not where this should
// stay.
//
// TWO THINGS TO KNOW BEFORE SETTING IT:
//
//   1. This API fronts the RIDER WEB APP as well as the admin panels. An
//      allowlist containing only admin origins would break the customer site.
//      List every browser origin: web app, console, portal.
//   2. CORS is a BROWSER control. It stops a page on another origin reading
//      responses; it does nothing about curl, a script, or a native app. It is
//      worth setting, but the boundary that actually holds is
//      `requirePermission` — do not treat this as the access control.
//
// Requests with no Origin (server-to-server, curl, the mobile apps) are allowed:
// browsers always send Origin cross-origin, so its absence is not a signal, and
// rejecting it would break the mobile clients.
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '')
  .split(',').map((o) => o.trim()).filter(Boolean);

if (CORS_ORIGINS.length === 0) {
  console.warn('[cors] CORS_ORIGINS is not set — allowing every origin. Set it to the '
    + 'browser origins that need this API (rider web app + each admin panel).');
  app.use(cors({ origin: '*' }));
} else {
  console.log(`[cors] restricted to ${CORS_ORIGINS.length} origin(s).`);
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (CORS_ORIGINS.includes(origin)) return callback(null, true);
      console.warn(`[cors] blocked origin: ${origin}`);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }));
}
// 12mb, not the 100kb default: onboarding posts document scans and the live
// selfie as base64 data URIs, and a phone camera photo base64-encodes to
// several megabytes. At the default limit every upload fails with a bare 413
// that reads like a server error.
app.use(bodyParser.json({ limit: '12mb' }));
app.use(bodyParser.urlencoded({ limit: '12mb', extended: true }));
// Every supported API version is mounted from one registry, which also emits
// the Deprecation/Sunset headers and serves GET /versions.
mountVersions(app, { log: console });
app.use(errorHandlerMiddleware);

// Start the server
const PORT = process.env.PORT || 3030;
// Bind with NO host argument, so Node listens on :: with dual-stack and accepts
// both IPv4 and IPv6. Railway's PRIVATE NETWORK IS IPv6-ONLY: a server bound to
// '0.0.0.0' is reachable from the public edge and completely unreachable from
// sibling services, which presents as the gateway 502-ing every upstream while
// each upstream looks perfectly healthy on its own.
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
