const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');


const City = db.define('city', {
    id: {
        type: DataTypes.UUID,
        defaultValue: () => uuidv4(),
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
      },
      icon: {
        type: DataTypes.STRING,
      },
      active: {
        type: DataTypes.BOOLEAN,
        defaultValue:true
      },
      lat: {
        type: DataTypes.STRING,
        defaultValue:''
      },
      lng: {
        type: DataTypes.STRING,
        defaultValue:''
      },
      active:{
        type:DataTypes.BOOLEAN,
        defaultValue:true
      },
      availableSoon: {
        type: DataTypes.BOOLEAN,
        defaultValue:false
      },
  });

  module.exports = City