const dueService = require('../services/dueService');

async function createDue(req, res) {
  const { bookingId, userId,amount,reason,remarks } = req.body;
  try {
    const due = await dueService.createDue({bookingId, userId,amount,reason,remarks });
    res.status(201).json(due);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getAllDues(req, res) {
  const { search, sort, bookingId, userId, status, limit, offset } = req.query;
  try {
    const dues = await dueService.getAllDues({ searchText:search, sort, bookingId, userId, status, limit, offset });
    res.status(200).json(dues);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getDueById(req, res) {
  const { id } = req.params;
  try {
    const pickup = await dueService.getDueById(id);
    res.status(200).json(pickup);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

async function getDueByUser(req, res) {
  const { userId } = req.body;
  try {
    const pickup = await dueService.getUserDues(userId);
    res.status(200).json(pickup);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

async function updateDue(req, res) {
  const { userId, bookingId, dateTime,amount } = req.body;
  const { id} = req.params;
  try {
    const updatedPickup = await dueService.updateDue({id,userId, bookingId, dateTime,amount});
    res.status(200).json(updatedPickup);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

async function confirmDue(req, res) {
  const { signature, orderId, paymentId, userId  } = req.body;
  const { id} = req.params;
  try {
    const updatedPickup = await dueService.confirmDue({signature, orderId, paymentId, userId });
    res.status(200).json(updatedPickup);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

async function initiateDue(req, res) {
  const { userId  } = req.body;
  const { id} = req.params;
  try {
    const dueInfo = await dueService.initiateDue({id, userId });
    res.status(200).json(dueInfo);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

async function cancelDue(req, res) {
  const { reason } = req.body;
  const { id} = req.params;
  try {
    const updatedPickup = await dueService.cancelDue({id,reason});
    res.status(200).json(updatedPickup);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

async function deleteDue(req, res) {
  const { id } = req.params;
  try {
    await dueService.deleteDue(id);
    res.status(204).end();
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

module.exports = { createDue, getAllDues, getDueById, getDueByUser,updateDue, deleteDue,cancelDue,confirmDue,initiateDue };
