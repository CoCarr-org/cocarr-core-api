// settings.router.js
const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');

// Define routes
router.get('/:type', settingsController.getSettingByType);
router.get('/', settingsController.getAllSettings);
router.get('/:id', settingsController.getSettingById);
router.post('/:type', settingsController.createOrUpdateSetting);

module.exports = router;
