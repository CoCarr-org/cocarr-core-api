// controllers/brandController.js

const { validationResult } = require('express-validator');
const brandService = require('../services/brandService');

const getAllBrands = async (req, res) => {
  try {
    const brands = await brandService.getAllBrands();
    res.json(brands);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

const getBrandById = async (req, res) => {
  const { id } = req.params;
  try {
    const brand = await brandService.getBrandById(id);
    if (brand) {
      res.json(brand);
    } else {
      res.status(404).json({ error: 'Brand not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

const createBrand = async (req, res) => {
  // Validate and sanitize input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const brandData = req.body;
  try {
    const newBrand = await brandService.createBrand(brandData);
    res.status(201).json(newBrand);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

const updateBrand = async (req, res) => {
  // Validate and sanitize input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const updatedBrandData = req.body;
  try {
    const updatedBrand = await brandService.updateBrand(id, updatedBrandData);
    if (updatedBrand) {
      res.json(updatedBrand);
    } else {
      res.status(404).json({ error: 'Brand not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

const deleteBrand = async (req, res) => {
  const { id } = req.params;
  try {
    const deleted = await brandService.deleteBrand(id);
    if (deleted) {
      res.json({ message: 'Brand deleted successfully' });
    } else {
      res.status(404).json({ error: 'Brand not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

module.exports = {
  getAllBrands,
  getBrandById,
  createBrand,
  updateBrand,
  deleteBrand,
};
