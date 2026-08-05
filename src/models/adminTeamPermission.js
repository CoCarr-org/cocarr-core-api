const { DataTypes } = require('sequelize');
const db = require('../configs/db');

// One row per (team, level, module) — the C/R/U/D a given level of a given team
// has on a module. Unlike the legacy `rolePermission` (which stored only
// deviations from a hardcoded default), these rows are the source of truth: the
// seeder writes a full grid per level and the Super Admin edits it directly.
const AdminTeamPermission = db.define('adminTeamPermission', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  teamId: { type: DataTypes.INTEGER, allowNull: false },
  levelId: { type: DataTypes.INTEGER, allowNull: false },
  module: { type: DataTypes.STRING, allowNull: false },
  // The COMPONENT within that module, or NULL for the module-level default.
  //
  // A module is a section of the panel (`users`); a submodule is one screen
  // inside it (`/dashboard/users/verification`). The route is the key: it is
  // already unique, already stable, and already what navConfig uses — inventing
  // a parallel slug vocabulary would mean two lists to keep in step, and they
  // would drift.
  //
  // NULL is the default row and is what every existing row already is, so this
  // column needs no migration: a team with no submodule rows behaves exactly as
  // it did, inheriting the module grid everywhere.
  //
  // Resolution is: submodule row if one exists, else the module row. Deliberately
  // NOT an intersection — an explicit submodule row is an override, so a Super
  // Admin can grant a single screen inside a module the team otherwise cannot
  // read, which is the main thing people actually want this for.
  submodule: { type: DataTypes.STRING, allowNull: true },
  canCreate: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  canRead: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  canUpdate: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  canDelete: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  indexes: [
    // MySQL treats NULLs as distinct in a unique index, so the module-level row
    // (submodule NULL) cannot collide with itself — but two NULL rows for the
    // same module would also not collide, which is why every write goes through
    // findOrCreate on the exact tuple rather than a blind create.
    { unique: true, fields: ['teamId', 'levelId', 'module', 'submodule'] },
  ],
});

module.exports = AdminTeamPermission;
