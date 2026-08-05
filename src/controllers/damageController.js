const { validationResult } = require('express-validator');
const damageService = require('../services/damageService');
const { CustomError } = require('../middlewares/error');

class DamageController {
  async createDamage(req, res, next) {
    try {
      const { bookingId, damageType, damageDescription, damagedPart,damageImage } = req.body;
      
      const damage = await damageService.createDamage({
        bookingId,
        damageType,
        damageDescription,
        damageImage,
        damagedPart,
        damageDate: new Date()
      });

      res.status(201).json(damage);
    } catch (error) {
      next(error);
    }
  }

  async getDamageById(req, res, next) {
    try {
      const { id } = req.params;
      const damage = await damageService.getDamageById(id);
      res.status(200).json(damage);
    } catch (error) {
      next(error);
    }
  }

  async updateDamageStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { damageStatus } = req.body;
      
      const damage = await damageService.updateDamageStatus(id, damageStatus);
      res.status(200).json(damage);
    } catch (error) {
      next(error);
    }
  }

  async getDamagesByBooking(req, res, next) {
    try {
      const { bookingId } = req.params;
      const damages = await damageService.getDamagesByBooking(bookingId);
      res.status(200).json(damages);
    } catch (error) {
      next(error);
    }
  }

  async updateDamagePayment(req, res, next) {
    try {
      const { id } = req.params;
      const { transactionId } = req.body;

      const damage = await damageService.updateDamagePayment(id, transactionId);
      res.status(200).json(damage);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new DamageController();
