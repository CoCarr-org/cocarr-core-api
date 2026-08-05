const { DataTypes } = require('sequelize');
const db = require('../configs/db');

// A team (department) an admin belongs to. Data-driven so the Super Admin can
// add/edit teams at runtime rather than them being hardcoded roles.
//
// `isSystem` marks the seven seeded teams (Super Admin, Admin, Customer Support,
// Operations, Finance, Marketing, Developer) — they can be edited but not
// deleted. `key` is a stable slug; `legacyRole` links a seeded team to the old
// `admins.role` integer so existing admins migrate onto the matching team.
//
// No FK associations are declared on purpose (INTEGER PK, referenced by plain
// INTEGER columns) — the repo has a history of alter-sync aborting on FK type
// mismatches, so team lookups are stitched in the service instead.
const AdminTeam = db.define('adminTeam', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  key: { type: DataTypes.STRING, allowNull: false, unique: true },
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  isSystem: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  legacyRole: { type: DataTypes.INTEGER, allowNull: true },
});

module.exports = AdminTeam;
