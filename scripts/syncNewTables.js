#!/usr/bin/env node
// Creates any MISSING tables without touching existing ones.
//
//   railway run node scripts/syncNewTables.js
//   railway run node scripts/syncNewTables.js --dry-run
//
// Why this exists: index.js runs db.sync({alter:true}), which rewrites every
// table on every boot. When that throws partway (MySQL's 64-key-per-table
// limit is the usual culprit — repeated alter runs accumulate indexes), every
// model after the failure point silently never gets created, and the server
// boots looking healthy until something queries the missing table.
//
// This uses plain sync() per model, which is CREATE TABLE IF NOT EXISTS. It
// will not alter, drop or reindex anything that already exists.
const db = require('../src/configs/db');
require('../src/models/association');

const MODELS = [
  'settlement', 'refundRequest', 'campaign', 'dispute', 'ticket', 'ticketMessage',
  'kycDocument', 'panCard', 'drivingLicence', 'vehicleRcDocument', 'otherDocument',
  'banner', 'faq', 'page', 'featureFlag', 'apiKey', 'ipWhitelist',
  'loginHistory', 'webhookLog', 'messageTemplate', 'mediaAsset',
  'announcement', 'pushCampaign', 'apiLog', 'platformSetting',
  'activityLog', 'rolePermission',
  'referral', 'referral_reward', 'referral_campaign', 'referral_code',
];

const dryRun = process.argv.includes('--dry-run');

(async () => {
  try {
    await db.authenticate();
    console.log('Connected.\n');

    const [existing] = await db.query('SHOW TABLES');
    const have = new Set(existing.map((r) => Object.values(r)[0]));

    let created = 0;
    let failed = 0;

    for (const name of MODELS) {
      let model;
      try {
        model = require(`../src/models/${name}`);
      } catch (error) {
        console.log(`  SKIP    ${name.padEnd(18)} (model file not found)`);
        continue;
      }

      const table = model.getTableName();
      if (have.has(table)) {
        console.log(`  ok      ${String(table).padEnd(18)} already exists`);
        continue;
      }

      if (dryRun) {
        console.log(`  WOULD   ${String(table).padEnd(18)} create`);
        created += 1;
        continue;
      }

      try {
        await model.sync();          // CREATE TABLE IF NOT EXISTS — never alters
        console.log(`  CREATED ${String(table).padEnd(18)}`);
        created += 1;
      } catch (error) {
        console.error(`  FAILED  ${String(table).padEnd(18)} ${error?.parent?.sqlMessage || error.message}`);
        failed += 1;
      }
    }

    console.log(`\n${dryRun ? 'Would create' : 'Created'}: ${created}${failed ? `, failed: ${failed}` : ''}`);
    process.exit(failed ? 1 : 0);
  } catch (error) {
    console.error('Failed:', error?.parent?.sqlMessage || error.message);
    process.exit(1);
  }
})();
