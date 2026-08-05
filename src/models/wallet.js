const { DataTypes } = require('sequelize');
const sequelize = require('../configs/db');

const Wallet = sequelize.define('wallet', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  userId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  walletPoints: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  walletPointsUsed: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  referralPoints: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  maxWalletPoints: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  status: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
});



module.exports = Wallet; 