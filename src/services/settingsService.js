// settings.service.js
const { DRIVER_FEE, CONVENIENCE_FEE, DEPOSIT_AMOUNT, FIRST_TIME_OFFER, MAX_POINTS_USAGE, RESCHEDULE_FEE } = require('../configs/constants');
const Settings = require('../models/settings');


async function addDefaultSettings() {
    const defaultSettings = [
      { type: DRIVER_FEE,label:'Driver Fee', value: '0' },
      { type: CONVENIENCE_FEE,label:'Convenience Fee', value: '0' },
      { type: DEPOSIT_AMOUNT,label:'Deposit Amount', value: '0' },
      { type: FIRST_TIME_OFFER,label:'First Time Offer', value: '20' },
      { type: MAX_POINTS_USAGE,label:'Max Wallet Points Usage', value: '10' },
      { type: RESCHEDULE_FEE,label:'Reschedule Fee', value: '1000' },
    ];
  
    for (const setting of defaultSettings) {
    let settingInfo = await getSettingByType(setting.type);
    if (!settingInfo) {
        settingInfo = await Settings.create({ type:setting.type,label:setting.label,value: setting.value });
    }
    }
  }

async function getSettingByType(type) {
return Settings.findOne({ where: { type } });
}

async function createOrUpdateSetting(type,label, value) {
let setting = await getSettingByType(type);
if (!setting) {
    setting = await Settings.create({ type,label, value });
} else {
    await setting.update({ value });
}
return setting;
}

async function getAllSettings() {
  return Settings.findAll();
}

async function getSettingById(id) {
  return Settings.findByPk(id);
}


module.exports = {
  getAllSettings,
  getSettingById,
  createOrUpdateSetting,
  addDefaultSettings,
  getSettingByType
};
