// services/cityService.js

const { Op } = require('sequelize');
const City = require('../models/city');

const getAllCities = async (searchTerm, sortBy) => {
    const whereClause = searchTerm
      ? { name: { [Op.iLike]: `%${searchTerm}%` } }
      : {};
  
    let order = [];
  
    if (sortBy) {
      const sortOrderSign = sortBy.startsWith('-') ? 'DESC' : 'ASC';
      order = [[sortBy.replace('-', ''), sortOrderSign]];
    } else {
      order = [['name', 'ASC']];
    }
  
    return City.findAll({ where: whereClause, order });
  };

const getCityById = async (id) => {
  return City.findByPk(id);
};

const createCity = async (cityData) => {
    try {
      // Check if the city name already exists
      const existingCity = await City.findOne({ where: { name: cityData.name,lat:cityData.lat,lng:cityData.lng,availableSoon:cityData.availableSoon ? cityData.availableSoon : false} });
  
      if (existingCity) {
        throw new Error('City name already exists');
      }
  
      return City.create(cityData);
    } catch (error) {
        console.log('error',error)
      throw error;
    }
  };

const updateCity = async (id, updatedCityData) => {
    try {
      // Check if the updated city name already exists in other rows
      const existingCity = await City.findOne({
        where: {
          name: updatedCityData.name,
          lat:updatedCityData.lat,
          availableSoon:updatedCityData.availableSoon ? updatedCityData.availableSoon : false,
          active:updatedCityData.active  ? updatedCityData.active : false,
          lng:updatedCityData.lng,
          id: { [Op.not]: id }
        },
      })
  
      if (existingCity) {
        throw new Error('City name already exists');
      }
      
      const city = await City.findByPk(id);
      
      if (city) {
        await city.update(updatedCityData);
        console.log('existing')
        return city;
      }
      return null;
    } catch (error) {
      console.log('errpr',error)
      throw error;
    }
  };

const deleteCity = async (id) => {
  const city = await City.findByPk(id);
  if (city) {
    await city.destroy();
    return true;
  }
  return false;
};

// Major Indian cities seeded on boot so the city picker (frontend + app) has a
// consistent list with valid ids. Idempotent: only inserts names not present.
const DEFAULT_CITIES = [
  { name: 'Hyderabad', lat: '17.3850', lng: '78.4867' },
  { name: 'Bengaluru', lat: '12.9716', lng: '77.5946' },
  { name: 'Chennai', lat: '13.0827', lng: '80.2707' },
  { name: 'Mumbai', lat: '19.0760', lng: '72.8777' },
  { name: 'Delhi', lat: '28.7041', lng: '77.1025' },
  { name: 'Pune', lat: '18.5204', lng: '73.8567' },
  { name: 'Kolkata', lat: '22.5726', lng: '88.3639' },
  { name: 'Ahmedabad', lat: '23.0225', lng: '72.5714' },
  { name: 'Jaipur', lat: '26.9124', lng: '75.7873' },
  { name: 'Kochi', lat: '9.9312', lng: '76.2673' },
  { name: 'Chandigarh', lat: '30.7333', lng: '76.7794' },
  { name: 'Vijayawada', lat: '16.5062', lng: '80.6480' },
  { name: 'Visakhapatnam', lat: '17.6868', lng: '83.2185' },
  { name: 'Coimbatore', lat: '11.0168', lng: '76.9558' },
  { name: 'Lucknow', lat: '26.8467', lng: '80.9462' },
  { name: 'Indore', lat: '22.7196', lng: '75.8577' },
  { name: 'Nagpur', lat: '21.1458', lng: '79.0882' },
  { name: 'Warangal', lat: '17.9689', lng: '79.5941' },
  { name: 'Surat', lat: '21.1702', lng: '72.8311' },
  { name: 'Bhopal', lat: '23.2599', lng: '77.4126' },
];

const addDefaultCities = async () => {
  for (const city of DEFAULT_CITIES) {
    // Per-item so one failure (e.g. a transient lock while db.sync runs)
    // doesn't abort the whole seed. Idempotent, so it self-heals on reboot.
    try {
      await City.findOrCreate({
        where: { name: city.name },
        defaults: { ...city, active: true, availableSoon: false },
      });
    } catch (err) {
      console.error(`Failed to seed city ${city.name}:`, err.message);
    }
  }
};

module.exports = {
  getAllCities,
  getCityById,
  createCity,
  updateCity,
  deleteCity,
  addDefaultCities,
};
