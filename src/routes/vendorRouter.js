// Import Express
const express = require('express');
const { authenticateAdmin } = require('../middlewares/authMiddleware');
const vendorController = require('../controllers/vendorController');
const router = express.Router()

router.post('/',authenticateAdmin,vendorController.createVendor)
router.get('/',authenticateAdmin,vendorController.getAllVendors)

module.exports = router;