// controllers/vehicleController.js

const { validationResult } = require('express-validator');
const VehicleService = require('../services/vehicleService');

const getAllVehicles = async (req, res) => {
  try {
    const { search, sortBy, type, brand, fuel, seats,startTime,endTime,city,status,maxPrice,minPrice,maxDistance,userRating,deliveryType,vehicleType,vehicleFuelType,vehicleSeats,vehicleTransmissionType,limit,offset,lat,lng } = req.query;
    const filters = { type, brand, fuel, seats,city,maxPrice,minPrice,maxDistance,userRating,deliveryType,vehicleType,vehicleFuelType,vehicleSeats,vehicleTransmissionType };
    let geo = {lat,lng}
    const vehicles = await VehicleService.getAllVehicles({search, sortBy, filters,startTime,endTime,status,limit,offset,geo});
    res.json(vehicles);
  } catch (error) {
    console.log(error)
    res.status(400).json({ error: error.message });
  }
};

const getVehicleById = async (req, res) => {
  const { id } = req.params;
  const {startTime,endTime } = req.query;
  try {
    const vehicle = await VehicleService.getVehicleById(id,startTime,endTime);
    if (vehicle) {
      res.json(vehicle);
    } else {
      res.status(404).json({ error: 'Vehicle not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

const createVehicle = async (req, res) => {
  // Validate and sanitize input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const vehicleData = req.body;
  try {
    const newVehicle = await VehicleService.createVehicle(vehicleData);
    res.status(201).json(newVehicle);
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: error });
  }
};

const addVehicleImage = async (req, res) => {
  // Validate and sanitize input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const updatedVehicleData = req.body;
  try {
    const updatedVehicle = await VehicleService.addVehicleImage(id, updatedVehicleData);
    res.json(updatedVehicle);
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

const removeVehicleImage = async (req, res) => {
  // Validate and sanitize input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  try {
    const updatedVehicle = await VehicleService.removeVehicleImage(id);
    res.json(updatedVehicle);
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

const updateVehicleCover = async (req, res) => {
  // Validate and sanitize input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id ,vehicleId} = req.params;
  try {
    const updatedVehicle = await VehicleService.changeCoverImage(id,vehicleId);
    res.json(updatedVehicle);
  } catch (error) {
    res.status(500).json({ error: error });
  }
};


const updateVehicle = async (req, res) => {
  // Validate and sanitize input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const updatedVehicleData = req.body;
  try {
    const updatedVehicle = await VehicleService.updateVehicle(id, updatedVehicleData);
    if (updatedVehicle) {
      res.json(updatedVehicle);
    } else {
      res.status(404).json({ error: 'Vehicle not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

const deleteVehicle = async (req, res) => {
  const { id } = req.params;
  try {
    const deleted = await VehicleService.deleteVehicle(id);
    if (deleted) {
      res.json({ message: 'Vehicle deleted successfully' });
    } else {
      res.status(404).json({ error: 'Vehicle not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};


const verifyRc = async (req,res)=>{
  try 
  {
    const {rcNumber,userId} = req.body;
    const verified = await VehicleService.verifyRc(rcNumber,userId);
    res.json(verified);
  } catch (error) {
    if(error instanceof CustomError)
    {
      res.status(500).json({ error: error.message });
    }
    else
    {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}

module.exports = {
  getAllVehicles,
  getVehicleById,
  addVehicleImage,
  updateVehicleCover,
  removeVehicleImage,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  verifyRc
};
