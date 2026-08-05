const walletService = require('../services/walletService');

class WalletController {

    async getWallet(req, res) {
        try {
            const { sort = 'id', offset = 0, limit = 10, filter = {}, search = '' } = req.query;
            const { totalCount, wallets } = await walletService.getWallet({ sort, offset, limit, filter, search });
            res.status(200).json({ totalCount, wallets });
        } catch (error) {
            console.log(error);
            res.status(400).json({ error: error.message });
        }
    }

    async getWalletByUserId(req, res) {
        try {
            const { userId } = req.body;
            const wallet = await walletService.getWalletByUserId(userId);
            res.status(200).json(wallet);
        } catch (error) {
            console.log(error);
            res.status(400).json({ error: error.message });
        }
    }

    async createWallet(req, res) {
        try {
            const { userId, name } = req.body;
      const wallet = await walletService.createWallet(userId, name);
      res.status(201).json(wallet);
    } catch (error) {
      console.log(error);
      res.status(400).json({ error: error.message });
    }
  }

  async updateWallet(req, res) {
    try {
      const { userId } = req.params;
      const updateData = req.body;
      const wallet = await walletService.updateWallet(userId, updateData);
      res.status(200).json(wallet);
    } catch (error) {
      console.log(error);
      res.status(400).json({ error: error.message });
    }
  }

  async deleteWallet(req, res) {
    try {
      const { userId } = req.params;
      const wallet = await walletService.deleteWallet(userId);
      res.status(200).json(wallet);
    } catch (error) {
      console.log(error);
      res.status(400).json({ error: error.message });
    }
  }

  async inactiveWallet(req, res) {
    try {
      const { userId } = req.params;
      const wallet = await walletService.inactiveWallet(userId);
      res.status(200).json(wallet);
    } catch (error) {
      console.log(error);
      res.status(400).json({ error: error.message });
    }
  }

  async getAllWalletTransaction(req, res) {
    try {
      const { sort = 'id', offset = 0, limit = 10, filter = {}, search = '' } = req.query;
      const { totalCount, walletTransactions } = await walletService.getAllWalletTransaction({ sort, offset, limit, filter, search });
      res.status(200).json({ totalCount, walletTransactions });
    } catch (error) {
      console.log(error);
      res.status(400).json({ error: error.message });
    }
  }

  async getUserWalletTransaction(req, res) {
    try {
      const { userId } = req.body;
      const wallet = await walletService.getUserWalletTransaction(userId);
      res.status(200).json(wallet);
    } catch (error) {
      console.log(error);
      res.status(400).json({ error: error.message });
    }
  }
}

module.exports = new WalletController();
