const { Op } = require('sequelize');
const { CustomError } = require('../middlewares/error');
const Offer = require('../models/offer');
const OfferUsage = require('../models/offerUsage');
const Vehicle = require('../models/vehicle');
const { bookingSummary } = require('./bookingService');
const { getVehicleById } = require('./vehicleService');

async function createOffer(offerData) {
  return await Offer.create(offerData);
}

async function getOffers() {
  return await Offer.findAll();
}

async function getOfferById(offerId) {
  return await Offer.findOne({ where: { id: offerId } });
}


async function getBookingOffer(userId, vehicleId, startTime, endTime, viewAll = false) {
  try {
    const vehicle = await Vehicle.findOne({ where: { [Op.or]: [{ vehicleId: vehicleId }, { id: vehicleId }] } });
    const bookingSummaryData = await bookingSummary({ userId, vehicleId: vehicle.vehicleId, startTime, endTime });
    
    // Get all offers
    const allOffers = await Offer.findAll({where:{isActive:true}});

    let offers = [];
    let unappliedOffers = [];

    for (const offer of allOffers) {
      let offerAmount = 0;
      let isApplicable = true;
      let reasons = [];


      const offerStartTime = new Date(startTime * 1000);
      const offerEndTime = new Date(endTime * 1000);
      if (offer.validFrom > offerStartTime || offer.validTo < offerEndTime) {
        isApplicable = false;
        reasons.push('Offer is not valid for the selected time');
      }

      if (!offer.offerApplicableOn.includes('all') && !offer.offerApplicableOn.includes(offerStartTime.toLocaleString('en-IN', { weekday: 'long' }).toLowerCase())) {
        isApplicable = false;
        reasons.push('Offer is not applicable on this day');
      }

      if (offer.discountType === 'percent') {
        offerAmount = (bookingSummaryData.rideAmount.amount * offer.discountValue) / 100;
        offerAmount = Math.min(offerAmount, offer.maxDiscountAmount);
      } else if (offer.discountType === 'flat') {
        offerAmount = offer.discountValue;
      }

      if (offerAmount === 0) {
        isApplicable = false;
        reasons.push('Discount amount is zero');
      }

      if (offer.minBookingAmount > bookingSummaryData.rideAmount.amount) {
        isApplicable = false;
        reasons.push(`minBookingAmount is ${offer.minBookingAmount}`);
      }

      if (offer.maxBookingAmount !== null && offer.maxBookingAmount < bookingSummaryData.rideAmount.amount) {
        isApplicable = false;
        reasons.push(`maxBookingAmount is ${offer.maxBookingAmount}`);
      }

      if (offer.minHours !== null && offer.minHours > bookingSummaryData.hours) {
        isApplicable = false;
        reasons.push(`minHours is ${offer.minHours}`);
      }

      if (offer.maxHours !== null && offer.maxHours < bookingSummaryData.hours) {
        isApplicable = false;
        reasons.push(`maxHours is ${offer.maxHours}`);
      }

      // if(offer.maxUses && offer.maxUses <= offerUsageCount){
      //   isApplicable = false;
      //   reasons.push(`Max uses is ${offer.maxUses}`);
      // }

      if (isApplicable) {
        offers.push({ ...offer.dataValues,offerAmount });
      } else if (viewAll) {
        unappliedOffers.push({ ...offer.dataValues, reasons});
      }
    }

    return viewAll ? { appliedOffers: offers, unappliedOffers } : offers;
  } catch (error) {
    console.log(error);
    throw new CustomError(error.message, 400);
  }
}

async function validateOffer(offerId, userId, vehicleId, startTime, endTime) {
  try {
    const offer = await getOfferById(offerId);
    const boolingSummary = await bookingSummary({ userId, vehicleId, startTime, endTime });
    let offerAmount = 0;
    if (offer.discountType === 'percent') {
      offerAmount = (boolingSummary.rideAmount.amount * offer.discountValue) / 100;
      offerAmount = Math.min(offerAmount, offer.maxDiscountAmount);
    } else if (offer.discountType === 'flat') {
      offerAmount = Math.min(offer.discountValue, offer.maxDiscountAmount);
    }

    const currentTime = new Date();
    if (offer.validFrom > currentTime || offer.validTo < currentTime) {
      throw new CustomError('Offer is not valid for the current time', 400);
    }

    boolingSummary.rideAmount.amount -= offerAmount;
    boolingSummary.rideAmount.offerAmount = offerAmount;
    boolingSummary.rideAmount.offerPercentage = offer.discountType === 'percent' ? `${offer.discountValue}%` : 0;

    return { offerAmount, offerId: offerId };
  } catch (error) {
    console.log(error);
    throw new CustomError(error.message, 400);
  }
}

async function useOffer(offerId, userId, bookingId) {
  return await OfferUsage.create({
    offerId,
    userId,
    bookingId
  });
}

async function getOfferByCode(code) {
  return await Offer.findOne({ where: { code } });
}

module.exports = {
  createOffer,
  getOffers,
  getBookingOffer,
  getOfferByCode,
  getOfferById,
  validateOffer,
  useOffer
};