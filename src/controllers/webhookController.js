// controllers/vehicleController.js

const { validationResult } = require('express-validator');
const WebhookService = require('../services/webhookService');

const webhookHandler = async (req, res) => {
  try {
    // const { search, sortBy, type, brand, fuel, seats,startTime,endTime } = req.body;
    console.log('controller bosdy',req.body)
    await WebhookService.webhookHandler(req.body);
    res.status(200).json('Received');
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

module.exports = {
  webhookHandler
};
