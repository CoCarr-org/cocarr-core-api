// routes/cityRoutes.js

const express = require('express');
const { check } = require('express-validator');
const CityController = require('../controllers/cityController');
const { authenticateAdmin } = require('../middlewares/authMiddleware');

const router = express.Router();

// Get all cities
router.get('/', CityController.getAllCities);

// Get a specific city by ID
router.get('/:id', CityController.getCityById);

// Create a new city
router.post(
  '/',
  [
    authenticateAdmin,
    check('name').notEmpty().withMessage('Name cannot be empty'),
  ],
  CityController.createCity
);

// Update an existing city by ID
router.put(
  '/:id',
  [
    check('name').notEmpty().withMessage('Name cannot be empty'),
    // check('icon').notEmpty().withMessage('Icon cannot be empty'),
  ],
  CityController.updateCity
);

// Delete a city by ID
router.delete('/:id', CityController.deleteCity);


module.exports = router