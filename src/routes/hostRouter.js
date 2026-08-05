const express = require('express');
const router = express.Router();
const multer = require('multer');
const hostController = require('../controllers/hostController');
const { authenticateUser, authenticateAdmin } = require('../middlewares/authMiddleware');

// RC card upload for vehicle onboarding — kept in memory and forwarded to the
// OCR provider, never written to disk. multer runs before auth so req.body
// exists for authenticateUser to attach userId.
const rcUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.get('/', authenticateAdmin, hostController.getAllHosts);
router.post('/',authenticateUser, hostController.createHost);
router.get('/check', authenticateUser, hostController.checkHost);
router.get('/vehicles', authenticateUser, hostController.getMyVehicles);
router.post('/vehicles/rc-ocr', rcUpload.single('rc'), authenticateUser, hostController.onboardVehicleFromRc);
router.post('/vehicles/verify', authenticateUser, hostController.verifyVehicle);
router.post('/vehicles/listing', authenticateUser, hostController.createVehicleListing);
router.post('/vehicles', authenticateUser, hostController.createVehicle);
router.put('/vehicles/:id', authenticateUser, hostController.updateVehicle);
router.get('/vehicles/:id', authenticateUser, hostController.getMyVehicleById);
router.get('/bookings', authenticateUser, hostController.getHostBookings);
router.get('/bookings/:id', authenticateUser, hostController.getHostBookingById);
router.post('/bookings/start/:id', authenticateUser, hostController.startBooking);
router.post('/bookings/end/:id', authenticateUser, hostController.endBooking);
router.post('/bookings/cancel/:id', authenticateUser, hostController.cancelBooking);
router.post('/bookings/review/:id', authenticateUser, hostController.createHostReview);
router.get('/schedule', authenticateUser, hostController.getSchedules);
router.get('/schedule/:id', authenticateUser, hostController.getScheduleById);
router.post('/schedule', authenticateUser, hostController.createSchedule);
router.delete('/schedule/:id', authenticateUser, hostController.deleteSchedule);
router.delete('/schedule-block/:id', authenticateUser, hostController.deleteScheduleBlock);
router.post('/schedule-block', authenticateUser, hostController.createScheduleBlock);
router.get('/bank', authenticateUser, hostController.getHostPayoutBankAccount);
router.post('/bank', authenticateUser, hostController.createHostPayoutBankAccount);
router.get('/commissions', authenticateUser, hostController.getHostCommissions);
router.get('/commissions/active', authenticateUser, hostController.getActiveHostCommission);
router.post('/commissions', authenticateUser, hostController.addHostCommission);
router.put('/commissions/:id', authenticateUser, hostController.updateHostCommission);
router.get('/:id', authenticateAdmin, hostController.getHost);

module.exports = router; 