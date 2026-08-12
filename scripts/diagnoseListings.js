#!/usr/bin/env node
// Why are the ops Hosts / Vehicles lists empty?
//
//   node scripts/diagnoseListings.js
//
// READ-ONLY. Counts only — no rows, no personal data, nothing written.
//
// WHY THIS EXISTS. "The list is empty" has three completely different causes
// and they are indistinguishable from the browser:
//
//   1. the table really is empty          -> a data problem
//   2. rows exist but a JOIN drops them   -> a query bug
//   3. the request failed and the toast   -> a client bug
//      rendered blank
//
// Guessing between them wasted a debugging session already: reference data
// (cities, brands) is re-seeded on every boot, so a database missing its
// business data still LOOKS half-populated, and an empty vehicle list reads as
// "the rebuild lost everything" when it may be one bad join.
//
// This answers 1 and 2 directly. For 3, the lists now surface the real error
// instead of an empty toast (see apiErrorMessage in @cocarr/notifications).
const db = require('../src/configs/db');

const Vehicle = require('../src/models/vehicle');
const Host = require('../src/models/host');
const User = require('../src/models/user');
const Pickup = require('../src/models/pickuppoint');
require('../src/models/association');

const pad = (n) => String(n).padStart(6);

(async () => {
  await db.authenticate();
  console.log(`\nDatabase: ${db.config.database}  @ ${db.config.host}\n`);

  const [vehicles, notDeleted, hosts, users, pickups] = await Promise.all([
    Vehicle.count(),
    Vehicle.count({ where: { deleted: false } }),
    Host.count(),
    User.count(),
    Pickup.count(),
  ]);

  console.log('ROW COUNTS');
  console.log(`  vehicles          ${pad(vehicles)}   (${notDeleted} not deleted)`);
  console.log(`  hosts             ${pad(hosts)}`);
  console.log(`  users             ${pad(users)}`);
  console.log(`  pickups           ${pad(pickups)}`);

  // THE BUG THIS WAS WRITTEN FOR. getAllVehicles used `where: {}` on the
  // pickupPoint include. Sequelize decides `required` from whether a `where`
  // key is PRESENT, not whether it constrains anything — so `{}` made it an
  // INNER JOIN and every vehicle with no pickup row vanished from the list.
  // Vehicles get their pickup at the wizard's Location step, so anything
  // mid-listing had none. This is the number that was being hidden.
  const withPickup = await Vehicle.count({
    where: { deleted: false },
    include: [{ model: Pickup, as: 'pickupPoint', required: true }],
  });
  const hiddenByJoin = notDeleted - withPickup;

  console.log('\nWHAT THE OLD VEHICLES QUERY RETURNED');
  console.log(`  with a pickup row ${pad(withPickup)}   <- all the old list could ever show`);
  console.log(`  WITHOUT one       ${pad(hiddenByJoin)}   <- silently dropped by the INNER JOIN`);
  if (hiddenByJoin > 0 && withPickup === 0) {
    console.log('\n  >> Every vehicle lacks a pickup row, so the list was ALWAYS empty.');
    console.log('     Nothing is missing from the database — this was the join.');
  }

  // The user's own reasoning: a vehicle implies a host. Check it, because if it
  // does NOT hold, the hosts list being empty is a data problem and no query
  // change will fill it.
  const vehiclesWithHost = await Vehicle.count({
    where: { deleted: false },
    include: [{ model: Host, as: 'host', required: true }],
  });

  console.log('\nDOES EVERY VEHICLE REACH A HOST?');
  console.log(`  vehicles -> host  ${pad(vehiclesWithHost)} of ${notDeleted}`);
  if (notDeleted > 0 && vehiclesWithHost < notDeleted) {
    console.log(`  >> ${notDeleted - vehiclesWithHost} vehicle(s) have a hostId matching no hosts row.`);
    console.log('     Orphaned rows — the hosts table lost data the vehicles table kept.');
  }

  console.log('\nVERDICT');
  if (hosts === 0 && vehicles > 0) {
    console.log('  Vehicles exist but there are NO hosts. The Hosts list is empty because');
    console.log('  the table is empty — a query change cannot fix it. Check whether the');
    console.log('  data sits under another schema on this instance before assuming loss:');
    console.log('    node scripts/ensureDatabase.js --dry-run    # prints SHOW DATABASES');
  } else if (hosts > 0) {
    console.log(`  ${hosts} host(s) present, and getAllHosts has no joins — so the API`);
    console.log('  returns them. An empty Hosts screen is then a CLIENT-side failure:');
    console.log('  open the network tab, the request is erroring and the toast was blank.');
  } else {
    console.log('  No vehicles and no hosts. This database has no business data at all.');
    console.log('    node scripts/ensureDatabase.js --dry-run    # is it under another schema?');
  }
  console.log('');

  await db.close();
})().catch(async (e) => {
  console.error(`\nFAILED: ${e.message}`);
  console.error('Set DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS for the environment you mean.\n');
  await db.close().catch(() => {});
  process.exit(1);
});
