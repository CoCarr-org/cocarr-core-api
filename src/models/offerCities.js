const { DataTypes } = require('sequelize');
const sequelize = require('../configs/db');

const OfferCities = sequelize.define('offerCities', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  cityId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  offerId: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
});


module.exports = OfferCities;