const express = require('express');
const router = express.Router();
const membershipController = require('../controllers/membershipController');
const { authenticateUser, authenticateAdmin } = require('../middlewares/authMiddleware');
console.log('running')
router.post('/initiate',authenticateUser, membershipController.initiateMembership);
router.post('/confirm',authenticateUser, membershipController.confirmMembership);
router.get('/',authenticateAdmin,membershipController.getAllMembership)
router.get('/history',authenticateUser,membershipController.getUserMembership)
// router.get('/:id',membershipController.getBookingById)

module.exports = router;
