// user.controller.js
const { validationResult } = require('express-validator');
const vendorService = require('../services/vendorService');

// Controller to handle creating a new user
const createVendor = async (req, res) => {
  try {
    // Validate and sanitize input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userData = req.body; // Assuming user data is sent in the request body
    const user = await vendorService.createVendor(userData);
    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Controller to handle getting all users
const getAllVendors = async (req, res) => {
  try {
    const users = await vendorService.getAllVendors();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createVendor,
  getAllVendors,
  // Add other controller functions as needed
};
