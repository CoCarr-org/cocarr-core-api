const express = require('express');
const { authenticateUser } = require('../middlewares/authMiddleware');
const referralController = require('../controllers/referralController');

const router = express.Router();

// The user's referral dashboard. `/history` is the path the mobile & web
// clients already call; `/` is a convenience alias.
router.get('/', authenticateUser, referralController.overview);
router.get('/history', authenticateUser, referralController.overview);

// Validate a referral code. No auth — the referee may not have an account yet
// (used on the signup screen before OTP verification).
router.post('/validate', referralController.validate);

// Whether the referral programme is currently open. No auth — the signup screen
// checks this before showing the referral-code entry.
router.get('/status', referralController.status);

module.exports = router;
