// Import Express
const express = require('express');
const { authenticateAdmin } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const adminController = require('../controllers/adminController');
const vehicleController = require('../controllers/vehicleController');
const router = express.Router()

// Every route below is gated on the Roles & Permissions matrix
// (Settings > Administration). Enforcement is opt-in via RBAC_ENFORCE=true —
// see permissionMiddleware.js for why, and read that before enabling it.
//
// Route order matters: the literal paths (/permissions, /activity-logs)
// must stay above the '/:id' params or Express matches them as an id.

// --- Admin accounts ---
router.post('/',authenticateAdmin,requirePermission('adminAccounts','create'),adminController.createAdmin)
router.get('/',authenticateAdmin,requirePermission('adminAccounts','read'),adminController.getAlladmins)

// --- Audit + RBAC ---
router.get('/activity-logs',authenticateAdmin,requirePermission('auditLogs','read'),adminController.getActivityLogs)
router.get('/permissions',authenticateAdmin,requirePermission('roles','read'),adminController.getPermissions)
router.put('/permissions',authenticateAdmin,requirePermission('roles','update'),adminController.updatePermissions)
router.get('/roles',authenticateAdmin,requirePermission('roles','read'),adminController.getRoles)

// --- Users ---
router.post('/user',authenticateAdmin,requirePermission('users','create'),adminController.createUser)
router.get('/export-user',authenticateAdmin,requirePermission('users','read'),adminController.exportUsers)
// Gated on adminAccounts, not users — pulling staff accounts is a different
// privilege from refreshing the customer list.
router.get('/user/kyc-info/:id',authenticateAdmin,requirePermission('users','read'),adminController.getUserKycInfo)
router.get('/user/verify-kyc/:id',authenticateAdmin,requirePermission('users','update'),adminController.verifyKycManual)
router.get('/user/verify-license/:id',authenticateAdmin,requirePermission('users','update'),adminController.verifyLicense)
router.get('/user/:id',authenticateAdmin,requirePermission('users','read'),adminController.getUserInfo)

// --- Vehicles / schedules ---
router.get('/schedule', authenticateAdmin,requirePermission('vehicles','read'),adminController.getSchedules);
router.get('/schedule/:id', authenticateAdmin,requirePermission('vehicles','read'),adminController.getScheduleById);
router.get('/vehicle', authenticateAdmin,requirePermission('vehicles','read'),adminController.getAllVehicles);
router.get('/vehicle/:id', authenticateAdmin,requirePermission('vehicles','read'),adminController.getVehicleById);
router.post('/vehicle/:id/approve', authenticateAdmin,requirePermission('vehicles','update'),adminController.approveVehicle)
router.post('/vehicle/:id/reject', authenticateAdmin,requirePermission('vehicles','update'),adminController.rejectVehicle);
router.post('/vehicle/:id/suspend', authenticateAdmin,requirePermission('vehicles','update'),adminController.suspendVehicle);

// --- Bookings ---
router.get('/booking', authenticateAdmin,requirePermission('bookings','read'),adminController.getAllBookings);
router.get('/booking/:id', authenticateAdmin,requirePermission('bookings','read'),adminController.getBookingById);

// --- Hosts ---
router.get('/host/:hostId/commissions', authenticateAdmin,requirePermission('hosts','read'),adminController.getHostCommissionsByHostId);
router.post('/host/:hostId/commissions', authenticateAdmin,requirePermission('hosts','create'),adminController.addHostCommissionByAdmin);
router.put('/commission/:id', authenticateAdmin,requirePermission('hosts','update'),adminController.updateHostCommissionByAdmin);

// --- Admin accounts by id (kept last: '/:id' would otherwise swallow the
//     literal paths above) ---
router.put('/:id',authenticateAdmin,requirePermission('adminAccounts','update'),adminController.updateAdminAccess)
router.delete('/:id',authenticateAdmin,requirePermission('adminAccounts','delete'),adminController.deleteAdmin)

module.exports = router;
