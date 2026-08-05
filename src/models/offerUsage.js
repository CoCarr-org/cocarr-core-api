const { DataTypes } = require('sequelize');
const sequelize = require('../configs/db');

const OfferUsage = sequelize.define('offerUsage', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  // Every one of these was declared INTEGER against a UUID/STRING key. The
  // offerId one is the worst: MySQL rejects the foreign key outright, and a
  // rejected FK ABORTS the whole `db.sync({alter:true})` pass — which is why
  // `users` kept losing its onboarding columns on boot even after the schema
  // had been built correctly. One bad FK here undid the whole thing.
  offerId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'offers',
      key: 'id'
    }
  },
  offerAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  // users.id is the Firebase uid — a STRING, not an integer.
  userId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  // booking.id (the UUID PK), matching every other bookingId in the schema.
  bookingId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  usedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
});

module.exports = OfferUsage; 