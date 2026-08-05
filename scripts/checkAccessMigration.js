#!/usr/bin/env node
/**
 * Read-only pre-flight for the access-resolution hardening.
 *
 * Two of those changes can lock people out if the data isn't what we assume,
 * so this reports the blast radius BEFORE anything is deployed. It writes
 * nothing and takes no arguments.
 *
 *   node scripts/checkAccessMigration.js
 *
 * What it checks, and why each one matters:
 *
 *   1. Admins with `role = SUPER_ADMIN` who are NOT on the super-admin team.
 *      The old code short-circuited on that column before looking at the team,
 *      so these accounts have had full access via a route that no longer
 *      exists. After the change they get exactly what their team allows —
 *      which is correct, and is the whole point, but somebody should know
 *      whose access is about to change and agree to it.
 *
 *   2. Admins with no team at all. They fall to the legacy role matrix, which
 *      still works — but it is meant to be temporary, and a growing number
 *      here means the boot migration is not doing its job.
 *
 *   3. Admins on an INACTIVE team. Their access used to silently revert to the
 *      legacy matrix; now it is a deny. Anyone here is about to lose access,
 *      which is presumably what deactivating the team meant — but it will look
 *      like a regression if nobody was expecting it.
 *
 *   4. Teams with no levels. Nobody on them can be granted anything.
 *
 * Orphaned Firebase users (a login with no `admins` row) are NOT checked here:
 * that needs the Firebase admin SDK and a full user listing, which is a
 * different kind of operation. Do it separately before deploying the
 * no-admin-row denial.
 */
require('dotenv').config();

const { Op } = require('sequelize');
const db = require('../src/configs/db');
const Admin = require('../src/models/admin');
const AdminTeam = require('../src/models/adminTeam');
const AdminTeamLevel = require('../src/models/adminTeamLevel');
const { ADMIN_ROLES, ADMIN_ROLE_LABELS } = require('../src/utils/adminRoles');

const line = (n = 72) => console.log('─'.repeat(n));

async function main() {
  await db.authenticate();
  console.log('\nAccess-resolution pre-flight\n');
  line();

  const teams = await AdminTeam.findAll();
  const byId = new Map(teams.map((t) => [t.id, t]));
  const superTeam = teams.find((t) => t.key === 'super-admin');

  let problems = 0;

  // ── 1. role=SUPER_ADMIN but not on the super-admin team ──
  const roleSupers = await Admin.findAll({ where: { role: ADMIN_ROLES.SUPER_ADMIN } });
  const mismatched = roleSupers.filter((a) => !superTeam || a.teamId !== superTeam.id);
  console.log(`\n1. Admins with role=SUPER_ADMIN: ${roleSupers.length}`);
  if (mismatched.length) {
    problems += 1;
    console.log(`   ⚠ ${mismatched.length} of them are NOT on the super-admin team.`);
    console.log('     They lose full access when the legacy override is removed:');
    for (const a of mismatched) {
      const t = a.teamId ? byId.get(a.teamId) : null;
      console.log(`       · ${a.email} — team: ${t ? t.name : 'NONE'}`);
    }
    console.log('     Fix: move them onto the super-admin team, or confirm the');
    console.log('     downgrade is intended, BEFORE deploying.');
  } else {
    console.log('   ✓ All of them are on the super-admin team. Removing the override');
    console.log('     changes nothing for them.');
  }

  // ── 2. Admins with no team ──
  const noTeam = await Admin.findAll({ where: { teamId: null } });
  console.log(`\n2. Admins with no team: ${noTeam.length}`);
  if (noTeam.length) {
    console.log('   These still resolve through the legacy role matrix (allowed, but');
    console.log('   meant to be temporary). The panel will warn them.');
    for (const a of noTeam) {
      console.log(`       · ${a.email} — legacy role: ${ADMIN_ROLE_LABELS[a.role] || a.role}`);
    }
  } else {
    console.log('   ✓ Everyone is on a team.');
  }

  // ── 3. Admins on an inactive team ──
  const inactive = teams.filter((t) => !t.isActive);
  if (inactive.length) {
    const affected = await Admin.findAll({
      where: { teamId: { [Op.in]: inactive.map((t) => t.id) } },
    });
    console.log(`\n3. Inactive teams: ${inactive.map((t) => t.name).join(', ')}`);
    if (affected.length) {
      problems += 1;
      console.log(`   ⚠ ${affected.length} admin(s) on them. They currently fall back to the`);
      console.log('     legacy matrix; after the change they are DENIED:');
      for (const a of affected) console.log(`       · ${a.email}`);
      console.log('     That is the intended behaviour of deactivating a team — just');
      console.log('     make sure it is what was meant.');
    } else {
      console.log('   ✓ No admins on them.');
    }
  } else {
    console.log('\n3. Inactive teams: none.');
  }

  // ── 4. Teams with no levels ──
  const levels = await AdminTeamLevel.findAll();
  const levelled = new Set(levels.map((l) => l.teamId));
  const levelless = teams.filter((t) => !levelled.has(t.id));
  console.log(`\n4. Teams with no levels: ${levelless.length}`);
  if (levelless.length) {
    problems += 1;
    for (const t of levelless) console.log(`       ⚠ ${t.name} — nobody on it can be granted anything`);
  } else {
    console.log('   ✓ Every team has at least one level.');
  }

  line();
  console.log(problems
    ? `\n${problems} thing(s) to resolve before deploying.\n`
    : '\nNothing blocking. Safe to deploy the access hardening.\n');

  await db.close();
}

main().catch(async (error) => {
  console.error('\nCheck failed:', error.message);
  try { await db.close(); } catch { /* already closed */ }
  process.exit(1);
});
