const express = require('express');
const { check } = require('express-validator');
const VehicleController = require('../controllers/vehicleController');
const { authenticateUserOptional, authenticateAdmin } = require('../middlewares/authMiddleware');

const router = express.Router();

// Define routes
router.get('', authenticateUserOptional,VehicleController.getAllVehicles);
router.get('/:id', VehicleController.getVehicleById);
router.post('', authenticateAdmin,VehicleController.createVehicle);
router.put('/add-photo/:id', authenticateAdmin,VehicleController.addVehicleImage);
router.delete('/remove-photo/:id', authenticateAdmin,VehicleController.removeVehicleImage);
router.post('/update-cover/:vehicleId/:id', authenticateAdmin,VehicleController.updateVehicleCover);
router.put('/:id', authenticateAdmin,VehicleController.updateVehicle);
router.delete('/:id',authenticateAdmin, VehicleController.deleteVehicle);

module.exports = router;