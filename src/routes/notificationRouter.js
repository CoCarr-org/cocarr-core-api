const express = require('express');
const router = express.Router();
const fcmController = require('../controllers/fcmController');
const { authenticateUser } = require('../middlewares/authMiddleware');

router.post('/',authenticateUser,fcmController.saveFcmToken);
// router.post('/sendNotification',authenticateUser,fcmController.sendNotification);
module.exports = router;