const transactionService = require('../services/transactionService');

class TransactionController {
  async getAllTransactions(req, res) {
    try {
      const {search,limit,sort,offset,filters,userId} = req.query;
      const transactions = await transactionService.getAllTransactions({filters, sort, offset, search, limit,userId});
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getTransactionById(req, res) {
    const { id } = req.params;
    try {
      const transaction = await transactionService.getTransactionById(id);
      res.json(transaction);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async createTransaction(req, res) {
    const transactionData = req.body;
    try {
      const newTransaction = await transactionService.createTransaction(transactionData);
      res.status(201).json(newTransaction);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }


  async getUserTransactions(req, res) {
    try {
      const { id } = req.params;
      const transactions = await transactionService.getUserTransactions(id);
      res.status(200).json(transactions);
    } catch (error) {
        console.log(error)
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

}

module.exports = new TransactionController();
