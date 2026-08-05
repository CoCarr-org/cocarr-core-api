const db = require('../configs/db');
const { CustomError } = require('../middlewares/error');
const User = require('../models/user');
const Wallet = require('../models/wallet');
const WalletTransaction = require('../models/wallettransaction');
const { Op } = require('sequelize'); // Importing Sequelize operators

async function createWallet(userId, name) {
  try {
    let wallet = await Wallet.findOne({ where: { userId } });
    if (!wallet) {
      wallet = await Wallet.create({ userId, name });
    }
    return wallet;
  } catch (error) {
    throw new CustomError('Error creating wallet', 500);
  }
}

async function getWalletByUserId(userId) {
  try {
    const wallet = await Wallet.findOne({ where: { userId } });
    return wallet;
  } catch (error) {
    throw new CustomError(error.message, 500);
  }
}

async function getWallet({ sort = 'id', offset = 0, limit = 10, filter = {}, search = '' }) {
  try {
    let order;
    if (sort.startsWith('-')) {
      order = [[sort.substring(1), 'DESC']];
    } else {
      order = [[sort, 'ASC']];
    }

    const { count: totalCount, rows: wallets } = await Wallet.findAndCountAll({
      where: filter,
      order: order,
      offset: parseInt(offset, 10),
      limit: parseInt(limit, 10),
      include: [{
        association: 'user', // Assuming 'user' is the association name
        where: {
          [Op.or]: [
            { [Op.and]: [db.where(db.fn('LOWER', db.col('contactNumber')), 'LIKE', `%${search.toLowerCase()}%`)] },
            { [Op.and]: [db.where(db.fn('LOWER', db.col('email')), 'LIKE', `%${search.toLowerCase()}%`)] },
            { [Op.and]: [db.where(db.fn('LOWER', db.col('name')), 'LIKE', `%${search.toLowerCase()}%`)] }
          ]
        }
      }]
    });
    return { totalCount, wallets };
  } catch (error) {
    console.log(error);
    throw new CustomError('Error getting wallets', 500);
  }
}

async function updateWallet(userId, updateData) {
  try {
    const wallet = await Wallet.findOne({ where: { userId } });
    if (!wallet) {
      throw new CustomError('Wallet not found', 404);
    }
    await wallet.update(updateData);
    return wallet;
  } catch (error) {
    throw new CustomError('Error updating wallet', 500);
  }
}

async function deleteWallet(userId) {
  try {
    const wallet = await Wallet.findOne({ where: { userId } });
    if (!wallet) {
      throw new CustomError('Wallet not found', 404);
    }
    await wallet.update({ deleted: true });
    return wallet;
  } catch (error) {
    throw new CustomError('Error deleting wallet', 500);
  }
}

async function inactiveWallet(userId) {
  try {
    const wallet = await Wallet.findOne({ where: { userId } });
    if (!wallet) {
      throw new CustomError('Wallet not found', 404);
    }
    await wallet.update({ isActive: false });
    return wallet;
  } catch (error) {
    throw new CustomError('Error inactivating wallet', 500);
  }
}

async function getAllWalletTransaction({ sort = 'id', offset = 0, limit = 10, filter = {}, search = '' }) {
  try {
    if(filter.userId) {
      filter.userId = filter.userId.split(',');
    }
    if(filter.walletId) {
      filter.walletId = filter.walletId.split(',');
    }
    if(filter.status) {
      filter.status = filter.status.split(',');
    }
    if(search) {
      filter.description = { [Sequelize.Op.like]: `%${search}%` };
    }

    if(sort.startsWith('-')) {
      order = [[sort.substring(1), 'DESC']];
    } else {
      order = [[sort, 'ASC']];
    }

    const { count: totalCount, rows: walletTransactions } = await WalletTransaction.findAndCountAll({ 
      where: filter,
      order: order, 
      offset: parseInt(offset, 10),
      limit: parseInt(limit, 10),
      include: [
        {
          model: Wallet,
          as: 'wallet'
        },
        {
          model: User,
          as: 'user'
        }
      ]
    });
    return { totalCount, walletTransactions };
  } catch (error) {
    console.log(error);
    throw new CustomError('Error getting all wallet transactions', 500);
  }
}

async function getUserWalletTransaction(userId) {
  try {
    const walletTransactions = await WalletTransaction.findAll({ where: { userId } });
    return walletTransactions;
  } catch (error) {
    throw new CustomError('Error getting user wallet transactions', 500);
  }
}

module.exports = {
  createWallet,
  getWalletByUserId,
  getWallet,
  updateWallet,
  deleteWallet,
  inactiveWallet,
  getUserWalletTransaction,
  getAllWalletTransaction
};
