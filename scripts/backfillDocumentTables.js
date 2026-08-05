#!/usr/bin/env node
// Copies the inline document columns on `users` and `vehicles` into the new
// per-document tables.
//
//   railway run node scripts/backfillDocumentTables.js --dry-run
//   railway run node scripts/backfillDocumentTables.js
//
// SAFE TO RE-RUN: a row is only created when the owner has no current document
// of that type, so a second run inserts nothing. It never deletes or modifies
// the inline columns — dropping those is a separate, later step
// (scripts/dropLegacyDocumentColumns.js), deliberately not automatic.
const db = require('../src/configs/db');
require('../src/models/association');
const User = require('../src/models/user');
const Vehicle = require('../src/models/vehicle');
const KycDocument = require('../src/models/kycDocument');
const PanCard = require('../src/models/panCard');
const DrivingLicence = require('../src/models/drivingLicence');
const VehicleRcDocument = require('../src/models/vehicleRcDocument');

const dryRun = process.argv.includes('--dry-run');

// The inline flags are booleans; the tables use a three-state status. An
// unverified-but-submitted document is 'pending', not 'rejected' — there was
// never a rejection recorded, so inventing one would be wrong.
const statusFrom = (verified) => (verified === true ? 'verified' : 'pending');

(async () => {
  try {
    await db.authenticate();
    console.log(dryRun ? 'DRY RUN — nothing will be written\n' : 'Backfilling document tables\n');

    const created = { kyc: 0, pan: 0, licence: 0, rc: 0 };
    const skipped = { kyc: 0, pan: 0, licence: 0, rc: 0 };

    // ── Users ──
    const users = await User.findAll({
      attributes: [
        'id', 'name', 'kycNumber', 'kycRef', 'kycName', 'kycImage', 'kycVerified',
        'panNumber', 'panName', 'panImage', 'panVerified',
        'panProviderStatus', 'panProviderName', 'panProviderCheckedAt', 'panNameMatch',
        'licenseNumber', 'licenseName', 'licenseFrontImage', 'licenseBackImage', 'licenseVerified',
      ],
    });
    console.log(`Scanning ${users.length} users…`);

    for (const u of users) {
      // Aadhaar / KYC
      if (u.kycNumber || u.kycImage) {
        const exists = await KycDocument.findOne({ where: { userId: u.id, isCurrent: true } });
        if (exists) { skipped.kyc++; }
        else {
          created.kyc++;
          if (!dryRun) {
            await KycDocument.create({
              userId: u.id,
              documentNumber: u.kycNumber || null,
              referenceId: u.kycRef || null,
              holderName: u.kycName || null,
              imageKey: u.kycImage || null,
              status: statusFrom(u.kycVerified),
              verifiedAt: u.kycVerified ? new Date() : null,
              isCurrent: true,
            });
          }
        }
      }

      // PAN
      if (u.panNumber || u.panImage) {
        const exists = await PanCard.findOne({ where: { userId: u.id, isCurrent: true } });
        if (exists) { skipped.pan++; }
        else {
          created.pan++;
          if (!dryRun) {
            await PanCard.create({
              userId: u.id,
              panNumber: u.panNumber || null,
              holderName: u.panName || null,
              imageKey: u.panImage || null,
              status: statusFrom(u.panVerified),
              verifiedAt: u.panVerified ? new Date() : null,
              providerStatus: u.panProviderStatus || null,
              providerName: u.panProviderName || null,
              providerCheckedAt: u.panProviderCheckedAt || null,
              nameMatch: u.panNameMatch ?? null,
              isCurrent: true,
            });
          }
        }
      }

      // Driving licence
      if (u.licenseNumber || u.licenseFrontImage || u.licenseBackImage) {
        const exists = await DrivingLicence.findOne({ where: { userId: u.id, isCurrent: true } });
        if (exists) { skipped.licence++; }
        else {
          created.licence++;
          if (!dryRun) {
            await DrivingLicence.create({
              userId: u.id,
              licenceNumber: u.licenseNumber || null,
              holderName: u.licenseName || null,
              frontImageKey: u.licenseFrontImage || null,
              backImageKey: u.licenseBackImage || null,
              status: statusFrom(u.licenseVerified),
              verifiedAt: u.licenseVerified ? new Date() : null,
              isCurrent: true,
            });
          }
        }
      }
    }

    // ── Vehicles ──
    const vehicles = await Vehicle.findAll({
      attributes: [
        'id', 'vehicleRcNumber', 'vehicleRcImage', 'vehicleRcVerified',
        'rcVerified', 'rcVerificationId', 'ownerName', 'vehicleMaker', 'model',
        'vehicleYear', 'vehicleColor', 'vehicleFuelType',
        'vehicleEngineNumber', 'vehicleChassisNumber',
      ],
    });
    console.log(`Scanning ${vehicles.length} vehicles…`);

    for (const v of vehicles) {
      if (!v.vehicleRcNumber && !v.vehicleRcImage) continue;
      const exists = await VehicleRcDocument.findOne({ where: { vehicleId: v.id, isCurrent: true } });
      if (exists) { skipped.rc++; continue; }

      created.rc++;
      if (!dryRun) {
        await VehicleRcDocument.create({
          vehicleId: v.id,
          rcNumber: v.vehicleRcNumber || null,
          imageKey: v.vehicleRcImage || null,
          ownerName: v.ownerName || null,
          makerModel: v.model || null,
          makerDescription: v.vehicleMaker || null,
          manufacturedYear: v.vehicleYear ? String(v.vehicleYear) : null,
          colour: v.vehicleColor || null,
          fuelType: v.vehicleFuelType || null,
          engineNumber: v.vehicleEngineNumber || null,
          chassisNumber: v.vehicleChassisNumber || null,
          // vehicleRcVerified is the ADMIN flag; rcVerified is the provider's.
          status: statusFrom(v.vehicleRcVerified),
          verifiedAt: v.vehicleRcVerified ? new Date() : null,
          providerStatus: v.rcVerified ? 'VERIFIED' : null,
          verificationId: v.rcVerificationId || null,
          isCurrent: true,
        });
      }
    }

    const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    console.log(`\n${dryRun ? 'Would create' : 'Created'}:`);
    Object.entries(created).forEach(([k, n]) => console.log(`  ${k.padEnd(9)} ${n}`));
    console.log(`  ${'TOTAL'.padEnd(9)} ${total(created)}`);
    if (total(skipped)) {
      console.log('\nAlready had a current document (skipped):');
      Object.entries(skipped).forEach(([k, n]) => n && console.log(`  ${k.padEnd(9)} ${n}`));
    }
    console.log(`\nInline columns were NOT modified. Verify the data, then run
scripts/dropLegacyDocumentColumns.js --dry-run when you are ready to drop them.`);
    process.exit(0);
  } catch (error) {
    console.error('Backfill failed:', error?.parent?.sqlMessage || error.message);
    process.exit(1);
  }
})();
