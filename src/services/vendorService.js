const express = require('express');
const router = express.Router();
const Vendor = require('../models/vendor');
const City = require('../models/city');
const createVendor = async(userData) => {
  try {
    const adminInfo = await Vendor.create({name:userData.name,email:userData.email,mobile:userData.mobile,city:userData.city});
    return adminInfo;
  } catch (error) {
    console.error(error);
    throw new Error('Error creating vendor: ' + error.message);
  }
}

// Service to get all users
const getAllVendors = async () => {
  try {
    const vendors = await Vendor.findAll({
      include: [
        {
          model: City,
          as: 'cityName',
        },
      ],
    });
    return vendors;
  } catch (error) {
    throw new Error('Error getting users: ' + error.message);
  }
};


module.exports = {createVendor,getAllVendors}