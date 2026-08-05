// routes/cityRoutes.js

const express = require('express');
const { check } = require('express-validator');
const PickupController = require('../controllers/pickupController');
const { authenticateAdmin } = require('../middlewares/authMiddleware');

const router = express.Router();

// Get all cities
router.get('/', PickupController.getAllPickups);

// Get a specific city by ID
router.get('/:id', PickupController.getPickupById);

// Create a new city
router.post(
  '/',
  [
    authenticateAdmin,
    check('name').notEmpty().withMessage('Name cannot be empty'),
    check('lat').notEmpty().withMessage('Latitude cannot be empty'),
    check('long').notEmpty().withMessage('Longitude cannot be empty'),
    check('cityId').notEmpty().withMessage('City cannot be empty'),
    check('address').notEmpty().withMessage('Address cannot be empty'),
  ],
  PickupController.createPickup
);

// Update an existing city by ID
router.put(
  '/:id',
  [
    check('name').notEmpty().withMessage('Name cannot be empty'),
    check('lat').notEmpty().withMessage('Latitude cannot be empty'),
    check('long').notEmpty().withMessage('Longitude cannot be empty'),
    check('cityId').notEmpty().withMessage('City cannot be empty'),
    check('address').notEmpty().withMessage('Address cannot be empty'),
  ],
  PickupController.updatePickup
);

// Delete a city by ID
router.delete('/:id', PickupController.deletePickup);


module.exports = router