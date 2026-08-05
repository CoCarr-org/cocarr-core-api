// controllers/cityController.js

const { validationResult } = require('express-validator');
const CityService = require('../services/cityService');

const getAllCities = async (req, res) => {
    try {
      const { search, sortBy } = req.query;
      const cities = await CityService.getAllCities(search, sortBy);
      res.json(cities);
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };
  

const getCityById = async (req, res) => {
  const { id } = req.params;
  try {
    const city = await CityService.getCityById(id);
    if (city) {
      res.json(city);
    } else {
      res.status(404).json({ error: 'City not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

const createCity = async (req, res) => {
  // Validate and sanitize input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const cityData = req.body;
  try {
    const newCity = await CityService.createCity(cityData);
    res.status(201).json(newCity);
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: error });
  }
};

const updateCity = async (req, res) => {
  // Validate and sanitize input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const updatedCityData = req.body;
  try {
    const updatedCity = await CityService.updateCity(id, updatedCityData);
    if (updatedCity) {
      res.json(updatedCity);
    } else {
      res.status(404).json({ error: 'City not found' });
    }
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: error});
  }
};

const deleteCity = async (req, res) => {
  const { id } = req.params;
  try {
    const deleted = await CityService.deleteCity(id);
    if (deleted) {
      res.json({ message: 'City deleted successfully' });
    } else {
      res.status(404).json({ error: 'City not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

module.exports = {
  getAllCities,
  getCityById,
  createCity,
  updateCity,
  deleteCity,
};
