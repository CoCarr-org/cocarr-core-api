const express = require('express');
const { check } = require('express-validator');
const webhookController = require('../controllers/webhookController');
const razorpayWebhookMiddleware = require('../middlewares/webookMiddleware');

const router = express.Router();

// Define routes
router.post('/', razorpayWebhookMiddleware,webhookController.webhookHandler);

module.exports = router;