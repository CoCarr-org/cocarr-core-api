const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');

// One row per (role, module) pair, storing the spec's C/R/U/D flags
// independently. A missing row means "fall back to the seeded default for
// that role+module" (see adminPermissions.js DEFAULT_PERMISSIONS), NOT
// "no access" — defaults come from the spec's Permission Matrix, and only
// deviations from them are persisted here.
//
// NOTE: this replaced an earlier single `access` ('none'|'read'|'write')
// column. `db.sync({alter:true})` adds the four boolean columns on boot; the
// old `access` column may still exist in an already-deployed DB but is no
// longer read or written.
const RolePermission = db.define('rolePermission', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
    defaultValue: () => uuidv4(),
  },
  role: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  module: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  canCreate: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  canRead:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  canUpdate: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  canDelete: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  indexes: [
    { unique: true, fields: ['role', 'module'] },
  ],
});

module.exports = RolePermission;
