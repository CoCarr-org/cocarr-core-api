const { DataTypes } = require('sequelize');
const db = require('../configs/db');

// An access level within a team (e.g. Manager / Specialist / Agent). Members of
// the same team can hold different levels, and each level has its own module
// permission grid. Super Admin can add/rename/remove levels per team.
//
// `rank` is display/ordering only (higher = more access, by convention) — it is
// NOT privilege by itself; the actual access is whatever the grid says.
// `isDefault` is the level a new member of the team gets unless one is chosen.
const AdminTeamLevel = db.define('adminTeamLevel', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  teamId: { type: DataTypes.INTEGER, allowNull: false },
  key: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  rank: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  indexes: [{ unique: true, fields: ['teamId', 'key'] }],
});

module.exports = AdminTeamLevel;
