// routes/cityRoutes.js

const express = require('express');
const { check } = require('express-validator');
const BrandController = require('../controllers/brandController');
const { authenticateAdmin } = require('../middlewares/authMiddleware');

const router = express.Router();

// Get all cities
router.get('/', BrandController.getAllBrands);

// Get a specific city by ID
router.get('/:id', BrandController.getBrandById);

// Create a new city
router.post(
  '/',
  [
    authenticateAdmin,
    check('name').notEmpty().withMessage('Name cannot be empty'),
  ],
  BrandController.createBrand
);

// Update an existing city by ID
router.put(
  '/:id',
  [
    check('name').notEmpty().withMessage('Name cannot be empty'),
  ],
  BrandController.updateBrand
);

// Delete a city by ID
router.delete('/:id', BrandController.deleteBrand);


module.exports = router