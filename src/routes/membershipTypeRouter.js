const express = require('express');
const router = express.Router();
const { authenticateAdmin } = require('../middlewares/authMiddleware');
const membershipTypeController = require('../controllers/membershipTypeController');

router.put('/update',authenticateAdmin,membershipTypeController.updateMembership);
router.get('/',membershipTypeController.getAllMembership)
router.get('/info',membershipTypeController.getMembershipInfo)

module.exports = router;
