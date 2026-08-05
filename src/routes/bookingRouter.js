const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { authenticateUser, authenticateAdmin, authenticateUserOptional } = require('../middlewares/authMiddleware');
const { body } = require('express-validator');
router.get('/summary',authenticateUserOptional, bookingController.bookingSummary);
router.get('/last-booking',authenticateUser,bookingController.getLastBooking)
router.post('/admin/create',authenticateAdmin,bookingController.adminCreateBooking)
router.post('/initiate',authenticateUser, bookingController.initiateBooking);
router.post('/cancel/:id',authenticateUser, bookingController.userCancelBooking);
router.post('/refund-summary/:id',authenticateUser,bookingController.refundSummary)
router.post('/extension-summary/:id',authenticateUser,bookingController.extentionSummary)
router.post('/extension/confirm',authenticateUser, bookingController.confirmExtension);
router.post('/extension/:id',authenticateUser,bookingController.initiateExtensionBooking)
router.post('/start-ride/:id',authenticateUser,bookingController.startRide)
router.post('/end-ride/:id',authenticateUser,bookingController.endRide)
router.post('/review/:id',authenticateUser,
body('userId').notEmpty().withMessage('User Id cannot be empty'),
body('comment').optional().trim().isLength({max:255}).withMessage('Comment cannot be more than 255 Chars length'),
body('comfort').isInt({ min: 1, max: 5 }).toInt(),
  body('cleanliness').isInt({ min: 1, max: 5 }).toInt(),
  body('host').isInt({ min: 1, max: 5 }).toInt(),
 bookingController.createReview);
router.post('/confirm',authenticateUser, bookingController.confirmBooking);
router.get('/',authenticateAdmin,bookingController.getAllBookings)
router.get('/:id',bookingController.getBookingById)
router.get('/user/:id',authenticateUser,bookingController.getUserBookings)
router.post('/reschedule-summary/:id',authenticateUser,bookingController.rescheduleSummary)
router.post('/initiate-reschedule/:id',authenticateUser,bookingController.initiateReschedule)
router.post('/confirm-reschedule',authenticateUser,bookingController.confirmReschedule)
module.exports = router;
