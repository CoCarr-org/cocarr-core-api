const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');
const { authenticateAdmin } = require('../middlewares/authMiddleware');

router.get('',authenticateAdmin, transactionController.getAllTransactions);
router.get('/:id', transactionController.getTransactionById);
router.post('', transactionController.createTransaction);
router.get('/user/:id',authenticateAdmin,transactionController.getUserTransactions)

module.exports = router;
