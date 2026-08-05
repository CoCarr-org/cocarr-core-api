const express = require('express');
const walletController = require('../controllers/walletController');

const router = express.Router();
const {authenticateUser,authenticateAdmin} = require('../middlewares/authMiddleware');

router.get('/',authenticateAdmin,walletController.getWallet);
router.get('/my-wallet',authenticateUser,walletController.getWalletByUserId);
router.get('/my-transaction',authenticateUser,walletController.getUserWalletTransaction);
router.get('/transaction/',authenticateAdmin,walletController.getAllWalletTransaction);
router.post('/create',authenticateUser, walletController.createWallet);
router.put('/update/:userId',authenticateAdmin, walletController.updateWallet);
router.delete('/delete/:userId',authenticateAdmin, walletController.deleteWallet);
router.put('/inactive/:userId',authenticateAdmin, walletController.inactiveWallet);

module.exports = router;