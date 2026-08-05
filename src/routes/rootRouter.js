// Import Express
const express = require('express');
const path = require('path')
const router = express.Router()
// router.use('/image', express.static('uploads'));
console.log('path',path.join(__dirname, '..', '..', 'uploads'))
router.use('/uploads', express.static(path.join(__dirname, '..', '..', 'uploads')));

router.use('/image', require('./imageRouter'));
router.use('/damage', require('./damageRouter'));
// Public admin auth (forgot-password) — no auth middleware. First so the
// literal /admin/forgot-password path isn't caught by any '/:id' handler below.
router.use('/admin',require('./adminAuthRouter'))
// MUST come before adminRouter: that router ends with catch-all '/:id'
// handlers which would otherwise match /admin/tickets, /admin/banners, etc.
router.use('/admin',require('./adminModulesRouter'))
router.use('/admin',require('./adminRouter'))
router.use('/city',require('./cityRouter'))
router.use('/brand',require('./brandRouter'))
router.use('/pickup-point',require('./pickupRouter'))
router.use('/user',require('./userRouter'))
router.use('/transaction',require('./transactionRouter'))
router.use('/booking',require('./bookingRouter'))
router.use('/vendor',require('./vendorRouter'))
router.use('/vehicle',require('./vehicleRouter'))
router.use('/hook',require('./webhookRouter'))
router.use('/membership-type',require('./membershipTypeRouter'))
router.use('/membership',require('./membershipRouter'))
router.use('/due',require('./dueRouter'))
router.use('/settings',require('./settingsRouter'))
router.use('/offers', require('./offerRouter'));
router.use('/host', require('./hostRouter'));
router.use('/utility', require('./utilityRouter'));
router.use('/wallet', require('./walletRouter'));
router.use('/notification',require('./notificationRouter'));
router.use('/protection-plan',require('./protectionplanrouter'));
router.use('/payout', require('./payoutRouter'));
router.use('/referral', require('./referralRouter'));

module.exports = router;