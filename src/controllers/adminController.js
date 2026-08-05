// user.controller.js
const { validationResult } = require('express-validator');
const adminService = require('../services/adminService');
const { getPermissionMatrix, updatePermissionMatrix } = require('../services/permissionService');
const { ADMIN_ROLE_LABELS, ADMIN_ROLE_DESCRIPTIONS, ADMIN_ROLE_ORDER } = require('../utils/adminRoles');
// const { getVehicleById } = require('./vehicleController');

// Controller to handle creating a new user
const createAdmin = async (req, res) => {
  try {
    // Validate and sanitize input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userData = req.body; // Assuming user data is sent in the request body
    const user = await adminService.createAdmin(userData, req.admin);
    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createUser = async (req, res) => {
  try {
    // Validate and sanitize input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userData = req.body; // Assuming user data is sent in the request body
    const user = await adminService.createUser(userData);
    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const exportUsers = async (req, res) => {
  try {
    // Get the workbook from the service
    const csvContent = await adminService.exportUsers();

    // Set headers for downloading the CSV file
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');

    // Send the CSV content as the response
    res.send(csvContent);
  } catch (error) {
    res.status(500).send('Error generating Excel file: ' + error.message);
  }
};

const getAlladmins = async (req, res) => {
  try {
    const users = await adminService.getAllAdmins();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getUserInfo = async (req, res) => {
  try {
    const { id } = req.params;
    const users = await adminService.getUserInfo(id);
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getUserKycInfo = async (req, res) => {
  try {
    const { id } = req.params;
    const users = await adminService.getKycInformation(id);
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const verifyKycManual = async (req, res) => {
  try {
    const { id } = req.params;
    const users = await adminService.verifyKycManual(id);
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const verifyLicense = async (req, res) => {
  try {
    const { id } = req.params;
    const users = await adminService.verifyLicense(id);
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getAllVehicles = async (req, res) => {
  try {
    const {searchTerm,  sortBy='vehicleName', filters, startTime, endTime, status = true, approved, limit = 10, offset=0,hostId} = req.query
    const vehicles = await adminService.getAllVehicles({searchTerm,  sortBy, filters, startTime, endTime, status, approved, limit, offset,hostId});
    res.status(200).json(vehicles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getVehicleById = async (req, res) => {
  try {
    const vehicle = await adminService.getVehicleById(req.params.id,req.query.rc);
    res.status(200).json(vehicle);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

const approveVehicle = async (req, res) => {
  try {
    const vehicle = await adminService.approveVehicle(req.params.id, req.admin);
    res.status(200).json(vehicle);
  } catch (error) {
    res.status(Number(error.statusCode) || 500).json({ error: error.message });
  }
}

const suspendVehicle = async (req, res) => {
  try {
    const vehicle = await adminService.setVehicleSuspension(
      req.params.id, req.body.suspended !== false, req.body.reason, req.admin,
    );
    res.status(200).json(vehicle);
  } catch (error) {
    res.status(Number(error.statusCode) || 500).json({ error: error.message });
  }
}

const rejectVehicle = async (req, res) => {
  try {
    const vehicle = await adminService.rejectVehicle(req.params.id, req.body.reason, req.admin);
    res.status(200).json(vehicle);
  } catch (error) {
    res.status(Number(error.statusCode) || 500).json({ error: error.message });
  }
}

const getSchedules = async (req, res) => {
  try {
    const {vehicleId,sort,offset,limit,status,hostId} = req.query
    const availability = await adminService.getSchedules({userId:req.body.userId,vehicleId,sort,offset,limit,status,hostId});
    res.json(availability);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getScheduleById = async (req, res) => {
  try {
    const schedule = await adminService.getScheduleById(req.params.id);
    res.json(schedule);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getAllBookings = async (req, res) => {
  try {
    const {search,sort,offset,limit,userId,vehicleId,status,cityId,hostId} = req.query
    const bookings = await adminService.getAllBookings({search,sort,offset,limit,userId,vehicleId,status,cityId,hostId});
    res.json(bookings);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getBookingById = async (req, res) => {
  try {
    const booking = await adminService.getBookingById(req.params.id);
    res.json(booking);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getHostCommissionsByHostId = async (req, res) => {
  try {
    const commissions = await adminService.getHostCommissionsByHostId(req.params.hostId);
    res.json(commissions);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const addHostCommissionByAdmin = async (req, res) => {
  try {
    const commission = await adminService.addHostCommissionByAdmin(req.params.hostId, req.body);
    res.status(201).json(commission);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const updateHostCommissionByAdmin = async (req, res) => {
  try {
    const commission = await adminService.updateHostCommissionByAdmin(req.params.id, req.body);
    res.json(commission);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const updateAdminAccess = async (req, res) => {
  try {
    const admin = await adminService.updateAdminAccess(req.params.id, req.body, req.admin);
    res.status(200).json(admin);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const deleteAdmin = async (req, res) => {
  try {
    const result = await adminService.deleteAdmin(req.params.id, req.admin);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getActivityLogs = async (req, res) => {
  try {
    const { offset, limit, entityType } = req.query;
    const result = await adminService.getActivityLogs({ offset, limit, entityType });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getPermissions = async (req, res) => {
  try {
    const result = await getPermissionMatrix();
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updatePermissions = async (req, res) => {
  try {
    const result = await updatePermissionMatrix(req.body.permissions, req.admin);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Role reference list (id, label, description) in the spec's display order —
// used by the admin UI's role dropdowns and the Roles & Permissions view so
// the labels live in one place (the backend) rather than being duplicated.
const getRoles = async (req, res) => {
  try {
    res.status(200).json({
      roles: ADMIN_ROLE_ORDER.map((role) => ({
        role,
        name: ADMIN_ROLE_LABELS[role],
        description: ADMIN_ROLE_DESCRIPTIONS[role],
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createAdmin,
  createUser,
  getAlladmins,
  getUserInfo,
  getUserKycInfo,
  verifyKycManual,
  verifyLicense,
  exportUsers,
  getAllVehicles,
  getVehicleById,
  getSchedules,
  getScheduleById,
  getAllBookings,
  getBookingById,
  approveVehicle,
  rejectVehicle,
  suspendVehicle,
  getHostCommissionsByHostId,
  addHostCommissionByAdmin,
  updateHostCommissionByAdmin,
  updateAdminAccess,
  deleteAdmin,
  getActivityLogs,
  getPermissions,
  updatePermissions,
  getRoles
};
