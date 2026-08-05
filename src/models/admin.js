const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4:uuidv4 } = require('uuid');
const City = require('./city');

const Admin = db.define('admin', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
    defaultValue:()=>uuidv4()
  },
  uid:{
    type:DataTypes.STRING,
    allowNull:false,
    // unique:true
  },
  name: {
    type: DataTypes.STRING,
    allowNull:false
  },
  mobile:{
    type:DataTypes.STRING,
    allowNull:false
  },
  email:{
    type:DataTypes.STRING,
    allowNull:false
  },
  cityId: {
    type: DataTypes.UUID
  },
  lastActivity: {
    type: DataTypes.DATE,
    allowNull:true,
    defaultValue:null
  },
  role: {
    type: DataTypes.INTEGER,
    defaultValue:1
  },
  // The data-driven team + level this admin belongs to (see adminTeam /
  // adminTeamLevel). Nullable so pre-existing admins keep working until the
  // boot migration maps their legacy `role` onto the matching team.
  teamId: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  teamLevelId: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue:true
  },
});

// Admin.belongsTo(City,{foreignKey:'cityId'})

module.exports = Admin;
