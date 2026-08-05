const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4 } = require('uuid');

const Damage = db.define('damage', {
    id: {
      type: DataTypes.STRING,
      defaultValue: () => v4(),
      primaryKey: true,
    },
    bookingId: {
      // Must match bookings.id (DataTypes.UUID / CHAR(36)) — it's the FK
      // target via Damage.belongsTo(Booking, { foreignKey: 'bookingId' }).
      // Using STRING here made MySQL reject the FK (ER_FK_INCOMPATIBLE_COLUMNS).
      type: DataTypes.UUID,
    },
    damageType: {
      type: DataTypes.STRING,
    },
    damagedPart:{
      type:DataTypes.STRING
    },
    damageDescription: {
      type: DataTypes.STRING,
    },
    damageImage: {
      type: DataTypes.STRING,
    },
    // Lifecycle:
    //   pending   — host reported it; awaiting admin verification of the photos
    //   approved  — admin compared start/end/damage photos and accepted it;
    //               now with the assessment team for an estimate
    //   assessed  — assessment complete and damageAmount set; ready to feed
    //               into the rider's refund calculation
    //   rejected  — not a valid claim
    //   paid      — settled through a transaction
    damageStatus: {
      type: DataTypes.ENUM,
      values: ['pending', 'approved', 'assessed', 'rejected', 'paid'],
      defaultValue: 'pending',
    },
    // Set when the admin verifies the photos, distinct from the assessment.
    verifiedByAdminId: { type: DataTypes.UUID },
    verifiedAt: { type: DataTypes.DATE },
    rejectionReason: { type: DataTypes.TEXT },
    // The assessment team's estimate. damageAmount is the figure actually
    // charged; this records what the assessor put on it and why.
    assessedAmount: { type: DataTypes.INTEGER },
    assessmentNotes: { type: DataTypes.TEXT },
    assessedByAdminId: { type: DataTypes.UUID },
    assessedAt: { type: DataTypes.DATE },
    damageAmount: {
      type: DataTypes.INTEGER,
    },
    transactionId: {
      // Must match transactions.id (DataTypes.UUID / CHAR(36)) — it's the FK
      // target via Damage.belongsTo(Transaction, { foreignKey: 'transactionId' }).
      type: DataTypes.UUID,
      allowNull: true,
    },
    damageDate: {
      type: DataTypes.DATE,
    },
  });


module.exports = Damage;
