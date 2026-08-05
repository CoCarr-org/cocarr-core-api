const express = require('express');
const router = express.Router();
const offerController = require('../controllers/offerController');
const { authenticateUserOptional, authenticateAdmin, authenticateUser } = require('../middlewares/authMiddleware');

router.post('/', authenticateAdmin, offerController.createOffer);
router.get('/', offerController.getOffers);
router.get('/validate/:offerId',authenticateUserOptional ,offerController.validateOffer);
router.get('/booking/:vehicleId',authenticateUserOptional ,offerController.getBookingOffer);
module.exports = router; 