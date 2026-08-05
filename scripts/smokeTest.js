/**
 * Read-only smoke test. Calls the service functions the admin panel and the
 * apps hit, against the real database, and reports which ones throw.
 *
 * The point is to catch a query that would 500 — a missing table, a column an
 * `attributes` list still names, a bad association — WITHOUT having to click
 * through the UI. Every call here is a read.
 *
 *   railway run node scripts/smokeTest.js
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../src/configs/db');

const MODEL_DIR = path.join(__dirname, '..', 'src', 'models');
for (const f of fs.readdirSync(MODEL_DIR).filter((x) => x.endsWith('.js') && x !== 'association.js')) {
  require(path.join(MODEL_DIR, f));
}
require(path.join(MODEL_DIR, 'association.js'));

const results = [];
const check = async (label, fn) => {
  try {
    const out = await fn();
    let note = '';
    if (Array.isArray(out)) note = `${out.length} row(s)`;
    else if (out && typeof out === 'object') {
      if (Array.isArray(out.data)) note = `${out.data.length} row(s), total ${out.totalCount ?? '?'}`;
      else note = Object.keys(out).slice(0, 4).join(', ');
    } else note = String(out);
    results.push({ ok: true, label, note });
  } catch (error) {
    results.push({ ok: false, label, note: error?.parent?.sqlMessage || error.message });
  }
};

(async () => {
  await db.authenticate();

  const uv = require('../src/services/userVerificationService');
  const docSvc = require('../src/services/documentService');
  const adminExtra = require('../src/services/adminExtraService');
  const stl = require('../src/services/settlementService');
  const refund = require('../src/services/refundService');
  const audience = require('../src/services/audienceService');
  const policy = require('../src/services/policyService');
  const report = require('../src/services/reportBuilderService');
  const adminDamage = require('../src/services/adminDamageService');
  const campaign = require('../src/services/campaignService');

  // ── User Management (rebuilt this session) ──
  await check('userVerification.managementOverview', () => uv.managementOverview());
  await check('userVerification.statusCounts', () => uv.statusCounts());
  await check('userVerification.list (queue default)', () => uv.listForReview({}));
  await check('userVerification.list (status=all)', () => uv.listForReview({ status: 'all' }));
  await check('userVerification.list (status=active)', () => uv.listForReview({ status: 'active' }));
  await check('userVerification.list (search)', () => uv.listForReview({ status: 'all', search: 'zzz' }));

  // ── Documents ──
  await check('documentService.listUserDocuments', () => docSvc.listUserDocuments({}));
  await check('documentService.listVehicleRc', () => docSvc.listVehicleRc({}));
  await check('documentService.listHostBankAccounts', () => docSvc.listHostBankAccounts({}));

  // ── Money ──
  await check('settlement.getSettlementWindow', () => stl.getSettlementWindow());
  await check('settlement.list', () => stl.listSettlements({}));
  await check('settlement.runWeekly (dryRun)', () => stl.runWeeklySettlement({ dryRun: true }));
  await check('refund.buildRefundList (dryRun)', () => refund.buildRefundList({ dryRun: true }));

  // ── Admin dashboard widgets ──
  await check('adminExtra.disputes.list', () => adminExtra.disputes.list({}));
  await check('adminDamage.listDamages', () => adminDamage.listDamages({}));

  // ── Marketing / reporting ──
  await check('audience.segments', () => audience.SEGMENTS);
  await check('campaign.list', () => campaign.list({}));
  await check('campaign.getSegments', () => campaign.getSegments());
  await check('report.getDriverReport', () => report.getDriverReport({}));
  await check('report.getReportSchema', () => report.getReportSchema());
  await check('policy.list', () => policy.listPolicies());

  // ── Report the outcome ──
  const failed = results.filter((r) => !r.ok);
  console.log('');
  for (const r of results) {
    console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.label.padEnd(40)} ${r.note}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) {
    console.log(`\n${failed.length} FAILING:`);
    for (const r of failed) console.log(`  ${r.label}\n     ${r.note}`);
    console.log('');
  } else {
    console.log('');
  }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('Smoke test could not run:', e?.parent?.sqlMessage || e.message);
  process.exit(1);
});
