const { Op } = require('sequelize');
const RazorpayInstance = require('../helper/payment');
const Transaction = require('../models/transaction');
const User = require('../models/user');

class TransactionService {
  async getAllTransactions({filters, sort, offset, search, limit,userId}) {
    try {
      // Construct query based on filters
      let queryOptions = {
        include: [
          {
            model: User,
            as: 'user',
          },
        ],
      };
  
      queryOptions.order = [['createdAt', 'DESC']];
      // Handle sorting
      if (sort) {
        queryOptions.order = [sort.split(':')];
      }
  
      // Handle offset
      if (offset) {
        queryOptions.offset = parseInt(offset);
      }
  
      if (userId) {
        queryOptions.where = { userId: userId };
      }
      // Handle search
      if (search) {
        queryOptions.where = {
          ...queryOptions.where,
          [Op.or]: [
            { 'amount': { [Op.like]: `%${search}%` } },
            { 'type': { [Op.like]: `%${search}%` } },
            // Add more fields to search here
          ],
        };
      }
  
      // Handle limit
      if (limit) {
        queryOptions.limit = parseInt(limit);
      }
  
      // Fetch all transactions with related information based on constructed query
      const transactions = await Transaction.findAll(queryOptions);
  
      // Count total number of transactions
      const totalCount = await Transaction.count(queryOptions);
  
      return { data: transactions, totalCount };
    } catch (error) {
      console.error('Error fetching user transactions:', error);
      throw error;
    }
  }
  
    // Iterate over each transaction and fetch payment information
    // const transactionsWithPayments = await Promise.all(transactions.map(async transaction => {
    //   let payment = {}
    //   if(transaction.paymentId) payment = await RazorpayInstance.payments.fetch(transaction.paymentId);
    //     return { ...transaction.toJSON(), payment };
    // }));

  async getTransactionById(id) {
    return await Transaction.findByPk(id);
  }

  async createTransaction(transactionData) {
    return await Transaction.create(transactionData);
  }


  async getUserTransactions(userId) {
    try {
        // Fetch all transactions for the given userId
        const transactions = await Transaction.findAll({
            where: { userId },
        });

        // Iterate over each transaction and fetch payment information
        const transactionsWithPayments = await Promise.all(transactions.map(async transaction => {
            const payment = await RazorpayInstance.payments.fetch(transaction.paymentId);
            return { ...transaction.toJSON(), payment };
        }));

        return transactionsWithPayments;
    } catch (error) {
        console.error('Error fetching user transactions:', error);
        throw error;
    }
}

  async isVehicleAvailable(vehicleId, startTime, endTime) {
    try {
      const overlappingTransaction = await Transaction.findOne({
        where: {
          vehicleId: vehicleId,
          [Op.or]: [
            {
              startTime: { [Op.between]: [startTime, endTime] },
            },
            {
              endTime: { [Op.between]: [startTime, endTime] },
            },
            {
              [Op.and]: [
                { startTime: { [Op.lte]: startTime } },
                { endTime: { [Op.gte]: endTime } },
              ],
            },
          ],
        },
      });

      return !overlappingTransaction;
    } catch (error) {
      throw error;
    }
  }
  

}

module.exports = new TransactionService();
