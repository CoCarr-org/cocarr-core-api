// settings.controller.js
const settingsService = require('../services/settingsService');


async function getSettingByType(req, res) {
    try {
      const { type } = req.params;
      console.log('type',type)
      const setting = await settingsService.getSettingByType(type);
      res.json(setting);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
  
  async function createOrUpdateSetting(req, res) {
    try {
      const { type } = req.params;
      const { value ,lable} = req.body;
      const setting = await settingsService.createOrUpdateSetting(type,lable, value);
      res.json(setting);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

async function getAllSettings(req, res) {
  try {
    const settings = await settingsService.getAllSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getSettingById(req, res) {
  try {
    const { id } = req.params;
    const setting = await settingsService.getSettingById(id);
    res.json(setting);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getAllSettings,
  getSettingById,
  getSettingByType,
  createOrUpdateSetting
};
