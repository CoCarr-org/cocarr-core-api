const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../configs/db');

const WalletTransaction = sequelize.define('wallettransaction', {
    id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    walletId: {
        type: DataTypes.UUID,
        allowNull: false
    },
    points: {
        type: DataTypes.FLOAT,
        allowNull: false
    },
    description: {
        type: DataTypes.STRING,
        allowNull: false
    },
    status: {
        type: DataTypes.STRING, // success, cancelled
        allowNull: false,
        defaultValue: 'success'
    },
    isCredit: {
        type: DataTypes.BOOLEAN,
        allowNull: false
    },
    // ── Provenance ─────────────────────────────────────────────────────────
    // Why this row exists, in machine-readable form. `description` is prose for
    // the user; these are what let an admin trace a credit back to the thing
    // that caused it, and from there to the people involved.
    //
    // Before this, a referral credit was a wallet row whose only clue was the
    // string "Referral reward (sign-up)" — you could see that points moved but
    // not which referral, which campaign, or who the other side was. Answering
    // "why does this user have these points?" meant guessing from timestamps.
    //
    // referral | booking | refund | admin | signup — kept open rather than an
    // ENUM, because MySQL cannot drop an ENUM value that rows still hold and
    // every new credit source would need a migration.
    referenceType: {
        type: DataTypes.STRING,
        allowNull: true
    },
    // The id of that thing: a referral id, a booking id, and so on. Deliberately
    // not a foreign key — it points at different tables depending on
    // referenceType, and an FK cannot express that.
    referenceId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    // The other person involved, when there is one. On a referral credit this is
    // the referee (on the referrer's row) or the referrer (on the referee's), so
    // one hop reaches both sides.
    counterpartyUserId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    // Everything else worth keeping about this specific credit — the reward
    // stage, the campaign, the code that was used, the balance before and after.
    // Read by the admin trace screen; nothing branches on it.
    metadata: {
        type: DataTypes.JSON,
        allowNull: true
    }
}, {
    indexes: [
        { fields: ['userId'] },
        // The trace query: "everything that came from this referral".
        { fields: ['referenceType', 'referenceId'] },
    ],
});

module.exports = WalletTransaction;