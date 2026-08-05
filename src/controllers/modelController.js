const express = require('express');
const router = express.Router();
const Model = require('../models/model'); // Import your Sequelize Model

// Route to retrieve all models
router.get('/models', async (req, res) => {
  try {
    const models = await Model.findAll();
    res.json(models);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route to create a new model
router.post('/models', async (req, res) => {
  try {
    const model = await Model.create(req.body);
    res.status(201).json(model);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route to retrieve a specific model by ID
router.get('/models/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const model = await Model.findByPk(id);
    if (!model) {
      res.status(404).json({ error: 'Model not found' });
    } else {
      res.json(model);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route to update a specific model by ID
router.put('/models/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const model = await Model.findByPk(id);
    if (!model) {
      res.status(404).json({ error: 'Model not found' });
    } else {
      await model.update(req.body);
      res.json(model);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route to delete a specific model by ID
router.delete('/models/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const model = await Model.findByPk(id);
    if (!model) {
      res.status(404).json({ error: 'Model not found' });
    } else {
      await model.destroy();
      res.status(204).send();
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
