const { Op } = require('sequelize');
const ProtectionPlan = require('../models/protectionplan');
const { CustomError } = require('../middlewares/error');

async function createProtectionPlan({
  basicPlanPrice,
  silverPlanPrice, 
  basicPlanAccidentAmount,
  silverPlanAccidentAmount,
  goldPlanPrice,
  goldPlanAccidentAmount,
  basicPlanExtraHourPrice,
  silverPlanExtraHourPrice,
  goldPlanExtraHourPrice,
  minHours,
  startDate,  
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
}) {
  try {

    // Check if all required fields are provided
    if (!basicPlanPrice || !silverPlanPrice || !goldPlanPrice || 
        !basicPlanAccidentAmount || !silverPlanAccidentAmount || !goldPlanAccidentAmount ||
        !basicPlanExtraHourPrice || !silverPlanExtraHourPrice || !goldPlanExtraHourPrice ||
        !basicPlanLuxuryPrice || !silverPlanLuxuryPrice || !goldPlanLuxuryPrice ||
        !basicPlanLuxuryExtraHourPrice || !silverPlanLuxuryExtraHourPrice || !goldPlanLuxuryExtraHourPrice ||
        !basicPlanLuxuryAccidentAmount || !silverPlanLuxuryAccidentAmount || !goldPlanLuxuryAccidentAmount) {
      throw new CustomError('All protection plan fields are required', 400);
    }
    // Check if there's an active plan
    const activePlan = await ProtectionPlan.findOne({
      where: {
        endDate: null,
        deleted: false
      }
    });

    if (activePlan) {
      // If startDate is provided, set previous day's end (23:59:59) as endDate
      if (startDate) {
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() - 1);
        endDate.setHours(23, 59, 59, 999);
        
        await activePlan.update({
          endDate: endDate
        });
      } else {
        throw new CustomError('An active protection plan already exists', 400);
      }
    }

    const plan = await ProtectionPlan.create({
      startDate: startDate ? new Date(startDate).setHours(0,0,0,0) : null,
      basicPlanPrice,
      silverPlanPrice,
      goldPlanPrice,
      basicPlanAccidentAmount,
      silverPlanAccidentAmount,
      goldPlanAccidentAmount,
      basicPlanExtraHourPrice,
      silverPlanExtraHourPrice,
      goldPlanExtraHourPrice,
      basicPlanLuxuryPrice,
      silverPlanLuxuryPrice,
      goldPlanLuxuryPrice,
      basicPlanLuxuryExtraHourPrice,
      silverPlanLuxuryExtraHourPrice,
      goldPlanLuxuryExtraHourPrice,
      basicPlanLuxuryAccidentAmount,
      silverPlanLuxuryAccidentAmount,
      goldPlanLuxuryAccidentAmount,
      minHours,
      maxHours
    });

    return plan;
  } catch (error) {
    throw error;
  }
}

async function updateProtectionPlan(id, {
  basicPlanPrice,
  silverPlanPrice,
  goldPlanPrice, 
  minHours,
  maxHours
}) {
  try {
    const currentPlan = await ProtectionPlan.findByPk(id);
    
    if (!currentPlan) {
      throw new CustomError('Protection plan not found', 404);
    }

    if (currentPlan.deleted) {
      throw new CustomError('Cannot update deleted protection plan', 400);
    }

    const now = new Date();

    // Set end date of current plan
    await currentPlan.update({
      endDate: now
    });

    // Create new plan with updated values
    const newPlan = await ProtectionPlan.create({
      startDate: now,
      basicPlanPrice: basicPlanPrice || currentPlan.basicPlanPrice,
      silverPlanPrice: silverPlanPrice || currentPlan.silverPlanPrice,
      goldPlanPrice: goldPlanPrice || currentPlan.goldPlanPrice,
      minHours: minHours || currentPlan.minHours,
      maxHours: maxHours || currentPlan.maxHours
    });

    return newPlan;
  } catch (error) {
    throw error;
  }
}

async function getProtectionPlan(id) {
  try {
    const plan = await ProtectionPlan.findByPk(id);
    if (!plan) {
      throw new CustomError('Protection plan not found', 404);
    }
    return plan;
  } catch (error) {
    throw error;
  }
}

async function getActiveProtectionPlan() {
  try {
    const plan = await ProtectionPlan.findOne({
      where: {
        endDate: null,
        deleted: false
      }
    });
    return plan;
  } catch (error) {
    throw error;
  }
}

async function getAllProtectionPlans() {
  try {
    const plans = await ProtectionPlan.findAll({
      where: {
        deleted: false
      },
      order: [['startDate', 'DESC']]
    });
    return plans;
  } catch (error) {
    throw error;
  }
}

async function deleteProtectionPlan(id) {
  try {
    const plan = await ProtectionPlan.findByPk(id);
    
    if (!plan) {
      throw new CustomError('Protection plan not found', 404);
    }

    await plan.update({ 
      deleted: true,
      endDate: new Date()
    });

    return { message: 'Protection plan deleted successfully' };
  } catch (error) {
    throw error;
  }
}

// Seeds one active plan if none exists.
//
// This is CONFIG, not data — and nothing else creates it. Without an active
// plan `initiateBooking` throws, because every booking must be priced against
// one, so a fresh database has no bookable state at all until this runs.
//
// "Active" means `endDate: null` AND `startDate <= the booking's start`, which
// is what bookingService queries for. startDate is backdated a day so a booking
// made immediately after seeding still matches.
//
// The amounts are placeholders in rupees, deliberately round so it is obvious
// they are defaults an admin is expected to replace in Configurations →
// Protection Plans. The *AccidentAmount fields are the per-tier damage COVER
// (the cap the refund calculation absorbs before charging the rider), not a
// price — getting those two confused would silently change what riders owe.
async function addDefaultProtectionPlan() {
  const existing = await ProtectionPlan.findOne({ where: { endDate: null, deleted: false } });
  if (existing) return existing;

  const yesterday = new Date(Date.now() - 24 * 3600 * 1000);

  return ProtectionPlan.create({
    startDate: yesterday,
    endDate: null,

    // Fee for the 12-hour base window, and per extra hour beyond it.
    basicPlanPrice: 199,
    basicPlanLuxuryPrice: 399,
    basicPlanExtraHourPrice: 20,
    basicPlanLuxuryExtraHourPrice: 40,

    silverPlanPrice: 399,
    silverPlanLuxuryPrice: 799,
    silverPlanExtraHourPrice: 35,
    silverPlanLuxuryExtraHourPrice: 70,

    goldPlanPrice: 699,
    goldPlanLuxuryPrice: 1399,
    goldPlanExtraHourPrice: 60,
    goldPlanLuxuryExtraHourPrice: 120,

    // Damage cover per tier — the cap, not a charge.
    basicPlanAccidentAmount: 5000,
    basicPlanLuxuryAccidentAmount: 10000,
    silverPlanAccidentAmount: 15000,
    silverPlanLuxuryAccidentAmount: 30000,
    goldPlanAccidentAmount: 50000,
    goldPlanLuxuryAccidentAmount: 100000,

    minHours: 12,
    maxHours: 720,
    deleted: false,
  });
}

module.exports = {
  addDefaultProtectionPlan,
  createProtectionPlan,
  updateProtectionPlan,
  getProtectionPlan,
  getActiveProtectionPlan,
  getAllProtectionPlans,
  deleteProtectionPlan
};
