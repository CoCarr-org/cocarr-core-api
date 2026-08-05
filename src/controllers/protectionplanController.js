// settings.controller.js
const protectionPlanService = require('../services/protectionPlanService');

async function createProtectionPlan(req, res, next) {
  try {
    const { basicPlanPrice, silverPlanPrice, goldPlanPrice, minHours, maxHours, basicPlanExtraHourPrice, silverPlanExtraHourPrice, goldPlanExtraHourPrice, basicPlanAccidentAmount, silverPlanAccidentAmount, goldPlanAccidentAmount, startDate, basicPlanLuxuryPrice, silverPlanLuxuryPrice, goldPlanLuxuryPrice, basicPlanLuxuryExtraHourPrice, silverPlanLuxuryExtraHourPrice, goldPlanLuxuryExtraHourPrice, basicPlanLuxuryAccidentAmount, silverPlanLuxuryAccidentAmount, goldPlanLuxuryAccidentAmount } = req.body;
    const plan = await protectionPlanService.createProtectionPlan({
      basicPlanPrice,
      silverPlanPrice,
      goldPlanPrice,
      minHours,
      startDate,
      basicPlanExtraHourPrice,
      silverPlanExtraHourPrice,
      goldPlanExtraHourPrice,
      basicPlanAccidentAmount,
      silverPlanAccidentAmount,
      goldPlanAccidentAmount,
      maxHours,
      basicPlanLuxuryPrice,
      silverPlanLuxuryPrice,
      goldPlanLuxuryPrice,
      basicPlanLuxuryExtraHourPrice,
      silverPlanLuxuryExtraHourPrice,
      goldPlanLuxuryExtraHourPrice,
      basicPlanLuxuryAccidentAmount,
      silverPlanLuxuryAccidentAmount,
      goldPlanLuxuryAccidentAmount,
    });
    res.status(201).json(plan);
  } catch (error) {
    next(error);
  }
}

async function updateProtectionPlan(req, res, next) {
  try {
    const { id } = req.params;
    const { basicPlanPrice, silverPlanPrice, goldPlanPrice, minHours, maxHours } = req.body;
    const plan = await protectionPlanService.updateProtectionPlan(id, {
      basicPlanPrice,
      silverPlanPrice,
      goldPlanPrice,
      minHours,
      maxHours
    });
    res.json(plan);
  } catch (error) {
    next(error);
  }
}

async function getProtectionPlan(req, res, next) {
  try {
    const { id } = req.params;
    const plan = await protectionPlanService.getProtectionPlan(id);
    res.json(plan);
  } catch (error) {
    next(error);
  }
}

async function getActiveProtectionPlan(req, res, next) {
  try {
    const plan = await protectionPlanService.getActiveProtectionPlan();
    res.json(plan);
  } catch (error) {
    next(error);
  }
}

async function getActiveProtectionPlan(req, res, next) {
  try {
    const plan = await protectionPlanService.getActiveProtectionPlan();
    res.json(plan);
  } catch (error) {
    next(error);
  }
}

async function getAllProtectionPlans(req, res, next) {
  try {
    const plans = await protectionPlanService.getAllProtectionPlans();
    res.json(plans);
  } catch (error) {
    next(error);
  }
}

async function deleteProtectionPlan(req, res, next) {
  try {
    const { id } = req.params;
    const result = await protectionPlanService.deleteProtectionPlan(id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createProtectionPlan,
  updateProtectionPlan,
  getProtectionPlan,
  getActiveProtectionPlan,
  getAllProtectionPlans,
  deleteProtectionPlan
};






