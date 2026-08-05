const pickupService = require('../services/pickupService');

async function createPickup(req, res) {
  const { name, cityId, address, lat, long } = req.body;
  try {
    const pickup = await pickupService.createPickup(name, cityId, address, lat, long);
    res.status(201).json(pickup);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getAllPickups(req, res) {
  const { search, filter, sort, page, pageSize,hostAdded } = req.query;
  try {
    const pickups = await pickupService.getAllPickups({ search, filter, sort, page, pageSize ,hostAdded});
    res.status(200).json(pickups);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getPickupById(req, res) {
  const { id } = req.params;
  try {
    const pickup = await pickupService.getPickupById(id);
    res.status(200).json(pickup);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

async function updatePickup(req, res) {
  const { id } = req.params;
  const data = req.body;
  try {
    const updatedPickup = await pickupService.updatePickup(id, data);
    res.status(200).json(updatedPickup);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

async function deletePickup(req, res) {
  const { id } = req.params;
  try {
    await pickupService.deletePickup(id);
    res.status(204).end();
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

module.exports = { createPickup, getAllPickups, getPickupById, updatePickup, deletePickup };
